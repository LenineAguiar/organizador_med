// Reúne as rotas da API, valida anexos e persiste registros nas pastas do servidor.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express from "express";
import multer from "multer";

// Define caminhos absolutos a partir da localização deste arquivo para persistir dados localmente.
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const storageDirectory = path.join(currentDirectory, "data");
const recordsPath = path.join(storageDirectory, "records.json");
const usersPath = path.join(storageDirectory, "users.json");
const filesDirectory = path.join(storageDirectory, "files");
const categories = ["receitas", "pedidos-exames", "relatorios", "atestados", "outros"];
const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const scrypt = promisify(crypto.scrypt);
const nativeOrigins = new Set(["http://localhost", "https://localhost", "capacitor://localhost"]);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
});

// Autoriza somente origens nativas do Capacitor e responde às verificações CORS do Android.
app.use((request, response, next) => {
  const origin = request.get("Origin");
  if (origin && nativeOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Organizador-Client, Authorization");
    response.setHeader("Access-Control-Max-Age", "600");
    response.setHeader("Vary", "Origin");
  } else if (origin && request.get("X-Organizador-Client") === "android") {
    response.status(403).end();
    return;
  }
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  next();
});

// Analisa o corpo JSON antes das rotas públicas de configuração e autenticação.
app.use(express.json({ limit: "1mb" }));

// Cria pastas e arquivos iniciais para os registros e as contas de acesso.
async function initializeStorage() {
  await fs.mkdir(filesDirectory, { recursive: true });
  for (const filePath of [recordsPath, usersPath]) {
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.writeFile(filePath, "[]\n", "utf8");
    }
  }
}

// Lê a lista de registros e relata erros de leitura ao middleware central da API.
async function readRecords() {
  const contents = await fs.readFile(recordsPath, "utf8");
  const records = JSON.parse(contents);
  if (!Array.isArray(records)) throw new Error("O arquivo de registros possui formato inválido.");
  return records;
}

// Grava primeiro em arquivo temporário e troca o arquivo principal para reduzir risco de corrupção.
async function writeRecords(records) {
  const temporaryPath = `${recordsPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, recordsPath);
}

// Lê usuários cadastrados e preserva apenas hashes de senha no armazenamento persistente.
async function readUsers() {
  const contents = await fs.readFile(usersPath, "utf8");
  const users = JSON.parse(contents);
  if (!Array.isArray(users)) throw new Error("O arquivo de usuários possui formato inválido.");
  return users;
}

// Atualiza os usuários por substituição atômica do arquivo persistido.
async function writeUsers(users) {
  const temporaryPath = `${usersPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, usersPath);
}

// Valida nome de usuário e senha para os formulários de criação inicial e gestão de contas.
function validateCredentials(username, password) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,32}$/.test(username.trim())) {
    const error = new Error("O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.");
    error.status = 400;
    throw error;
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    const error = new Error("A senha deve ter entre 8 e 128 caracteres.");
    error.status = 400;
    throw error;
  }
  return username.trim();
}

// Converte a senha em hash scrypt com salt aleatório antes de persistir uma conta.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, passwordHash: hash.toString("hex") };
}

// Recupera um identificador de sessão do cookie sem confiar em valores arbitrários do navegador.
function getSessionId(request) {
  const authorization = request.get("Authorization") || "";
  const bearerToken = authorization.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (bearerToken) return bearerToken;
  const cookie = (request.headers.cookie || "").split(";").map((part) => part.trim());
  const sessionCookie = cookie.find((part) => part.startsWith("organizador_session="));
  const sessionId = sessionCookie?.slice("organizador_session=".length);
  return sessionId && /^[a-f0-9]{64}$/.test(sessionId) ? sessionId : null;
}

// Cria cookies de sessão protegidos contra leitura por JavaScript e envio em navegação externa.
function setSessionCookie(response, sessionId, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `organizador_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`,
  );
}

// Limita o acesso à API às contas autenticadas e invalida sessões expiradas ou removidas.
async function requireAuthentication(request, response, next) {
  const sessionId = getSessionId(request);
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (sessionId) sessions.delete(sessionId);
    if (
      process.env.ALLOW_ANONYMOUS_MOBILE !== "false" &&
      request.get("X-Organizador-Client") === "android"
    ) {
      request.user = { id: "android-guest", username: "Acesso sem login", isAdmin: false, isAnonymous: true };
      next();
      return;
    }
    response.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
    return;
  }

  try {
    const users = await readUsers();
    const user = users.find((item) => item.id === session.userId);
    if (!user) {
      sessions.delete(sessionId);
      response.status(401).json({ error: "Sua conta não está mais disponível. Entre novamente." });
      return;
    }
    request.user = { id: user.id, username: user.username, isAdmin: user.isAdmin };
    next();
  } catch (error) {
    next(error);
  }
}

// Define respostas públicas de sessão, configuração inicial e entrada com limitação de tentativas.
app.get("/api/session", async (_request, response, next) => {
  try {
    const users = await readUsers();
    const sessionId = getSessionId(_request);
    const session = sessionId ? sessions.get(sessionId) : null;
    const user = session && session.expiresAt > Date.now()
      ? users.find((item) => item.id === session.userId)
      : null;
    response.json({
      setupRequired: users.length === 0,
      user: user ? { id: user.id, username: user.username, isAdmin: user.isAdmin } : null,
    });
  } catch (error) {
    next(error);
  }
});

// Cria a primeira conta como administradora somente enquanto o sistema ainda não possui usuários.
app.post("/api/setup", async (request, response, next) => {
  try {
    const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
    if (process.env.ALLOW_REMOTE_SETUP !== "true" && !localAddresses.has(request.ip)) {
      const error = new Error("A configuração inicial deve ser feita no próprio servidor.");
      error.status = 403;
      throw error;
    }
    const users = await readUsers();
    if (users.length) {
      const error = new Error("A configuração inicial já foi concluída.");
      error.status = 409;
      throw error;
    }
    const username = validateCredentials(request.body.username, request.body.password);
    const credentials = await hashPassword(request.body.password);
    const user = { id: crypto.randomUUID(), username, ...credentials, isAdmin: true };
    await writeUsers([user]);
    const sessionId = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionId, { userId: user.id, expiresAt: Date.now() + sessionLifetime });
    setSessionCookie(response, sessionId, sessionLifetime / 1000);
    response.status(201).json({ user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
  } catch (error) {
    next(error);
  }
});

// Verifica credenciais com mensagem uniforme e bloqueio temporário após tentativas inválidas.
app.post("/api/login", async (request, response, next) => {
  try {
    const ipAddress = request.ip;
    const attempt = loginAttempts.get(ipAddress);
    if (attempt?.blockedUntil > Date.now()) {
      response.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente." });
      return;
    }
    const username = typeof request.body.username === "string" ? request.body.username.trim().toLowerCase() : "";
    const password = typeof request.body.password === "string" && request.body.password.length <= 128
      ? request.body.password
      : "";
    const user = (await readUsers()).find((item) => item.username.toLowerCase() === username);
    const submittedHash = user
      ? await scrypt(password, user.salt, 64)
      : await scrypt(password || "invalid-password", "organizador-medico-invalid-user", 64);
    const matches = user && crypto.timingSafeEqual(submittedHash, Buffer.from(user.passwordHash, "hex"));

    if (!matches) {
      const failures = (attempt?.failures || 0) + 1;
      loginAttempts.set(ipAddress, {
        failures,
        blockedUntil: failures >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
      });
      response.status(401).json({ error: "Usuário ou senha inválidos." });
      return;
    }

    loginAttempts.delete(ipAddress);
    const sessionId = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionId, { userId: user.id, expiresAt: Date.now() + sessionLifetime });
    setSessionCookie(response, sessionId, sessionLifetime / 1000);
    response.json({
      user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
      ...(request.get("X-Organizador-Client") === "android" ? { token: sessionId } : {}),
    });
  } catch (error) {
    next(error);
  }
});

// Encerra a sessão atual e remove o cookie do navegador.
app.post("/api/logout", (request, response) => {
  const sessionId = getSessionId(request);
  if (sessionId) sessions.delete(sessionId);
  setSessionCookie(response, "", 0);
  response.status(204).end();
});

// Exige uma sessão válida para qualquer rota de registros ou administração de contas.
app.use("/api", requireAuthentication);

// Lista contas sem incluir hashes ou salts de senha e somente para administradores.
app.get("/api/users", async (request, response, next) => {
  if (!request.user.isAdmin) {
    response.status(403).json({ error: "Somente o administrador pode gerenciar usuários." });
    return;
  }
  try {
    const users = await readUsers();
    response.json(users.map(({ id, username, isAdmin }) => ({ id, username, isAdmin })));
  } catch (error) {
    next(error);
  }
});

// Permite ao administrador criar contas de teste que compartilham o histórico deste sistema.
app.post("/api/users", async (request, response, next) => {
  if (!request.user.isAdmin) {
    response.status(403).json({ error: "Somente o administrador pode gerenciar usuários." });
    return;
  }
  try {
    const username = validateCredentials(request.body.username, request.body.password);
    const users = await readUsers();
    if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      const error = new Error("Este nome de usuário já está cadastrado.");
      error.status = 409;
      throw error;
    }
    const credentials = await hashPassword(request.body.password);
    const user = { id: crypto.randomUUID(), username, ...credentials, isAdmin: false };
    await writeUsers([...users, user]);
    response.status(201).json({ id: user.id, username: user.username, isAdmin: user.isAdmin });
  } catch (error) {
    next(error);
  }
});

// Exclui conta de teste, sem permitir remover a própria conta ou o último administrador.
app.delete("/api/users/:userId", async (request, response, next) => {
  if (!request.user.isAdmin) {
    response.status(403).json({ error: "Somente o administrador pode gerenciar usuários." });
    return;
  }
  try {
    const users = await readUsers();
    const target = users.find((user) => user.id === request.params.userId);
    if (!target) {
      const error = new Error("Usuário não encontrado.");
      error.status = 404;
      throw error;
    }
    if (target.id === request.user.id) {
      const error = new Error("Não é possível excluir a própria conta.");
      error.status = 400;
      throw error;
    }
    if (target.isAdmin && users.filter((user) => user.isAdmin).length === 1) {
      const error = new Error("O sistema precisa manter pelo menos um administrador.");
      error.status = 400;
      throw error;
    }
    await writeUsers(users.filter((user) => user.id !== target.id));
    for (const [sessionId, session] of sessions.entries()) {
      if (session.userId === target.id) sessions.delete(sessionId);
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Valida os campos obrigatórios e estrutura os anexos já selecionados para permanecer no registro.
function parseRecordPayload(body) {
  let payload;
  try {
    payload = JSON.parse(body.payload || "{}");
  } catch {
    const error = new Error("Os dados da consulta enviados são inválidos.");
    error.status = 400;
    throw error;
  }
  if (
    typeof payload.doctor !== "string" ||
    typeof payload.specialty !== "string" ||
    typeof payload.date !== "string" ||
    typeof payload.time !== "string" ||
    !payload.doctor.trim() ||
    !payload.specialty.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
    !/^\d{2}:\d{2}$/.test(payload.time)
  ) {
    const error = new Error("Preencha médico, especialidade, data e horário.");
    error.status = 400;
    throw error;
  }

  const retainedIds = Object.fromEntries(categories.map((category) => [category, []]));
  for (const category of categories) {
    const items = payload.attachments?.[category] || [];
    if (!Array.isArray(items) || items.some((item) => typeof item?.id !== "string")) {
      const error = new Error("A lista de anexos enviada é inválida.");
      error.status = 400;
      throw error;
    }
    retainedIds[category] = items.map((item) => item.id);
  }

  return {
    doctor: payload.doctor.trim(),
    specialty: payload.specialty.trim(),
    date: payload.date,
    time: payload.time,
    observations: typeof payload.observations === "string" ? payload.observations : "",
    retainedIds,
  };
}

// Valida todos os arquivos antes de gravá-los, evitando deixar uploads inválidos parcialmente persistidos.
async function storeUploadedFiles(recordId, files, fileCategories) {
  if (!Array.isArray(fileCategories) || fileCategories.length !== files.length) {
    const error = new Error("Não foi possível relacionar os arquivos às categorias.");
    error.status = 400;
    throw error;
  }

  for (const [index, file] of files.entries()) {
    if (!categories.includes(fileCategories[index]) || !allowedMimeTypes.has(file.mimetype)) {
      const error = new Error("Anexe somente arquivos PDF, JPEG, PNG, WEBP ou GIF nas categorias permitidas.");
      error.status = 400;
      throw error;
    }
  }

  const attachments = Object.fromEntries(categories.map((category) => [category, []]));
  try {
    for (const [index, file] of files.entries()) {
      const category = fileCategories[index];
      const extension = path.extname(path.basename(file.originalname)).slice(0, 12);
      const storedName = `${crypto.randomUUID()}${extension}`;
      const categoryDirectory = path.join(filesDirectory, recordId, category);
      await fs.mkdir(categoryDirectory, { recursive: true });
      await fs.writeFile(path.join(categoryDirectory, storedName), file.buffer, { flag: "wx" });
      attachments[category].push({
        id: crypto.randomUUID(),
        name: path.basename(file.originalname).slice(0, 180),
        storedName,
        mimeType: file.mimetype,
        size: file.size,
      });
    }
  } catch (error) {
    for (const [category, items] of Object.entries(attachments)) {
      for (const file of items) {
        await fs.rm(path.join(filesDirectory, recordId, category, file.storedName), { force: true });
      }
    }
    throw error;
  }
  return attachments;
}

// Remove arquivos não retidos no envio, mantendo os anexos existentes que o usuário não apagou.
async function removeUnretainedFiles(recordId, previousAttachments, nextAttachments) {
  for (const category of categories) {
    const retainedIds = new Set(nextAttachments[category].map((file) => file.id));
    for (const file of previousAttachments?.[category] || []) {
      if (!retainedIds.has(file.id)) {
        await fs.rm(path.join(filesDirectory, recordId, category, file.storedName), { force: true });
      }
    }
  }
}

// Disponibiliza os arquivos compilados da interface quando o servidor estiver em produção.
app.use(express.static(path.resolve(currentDirectory, "..", "dist")));

// Lista registros ordenados por data e horário, do compromisso mais recente ao mais distante.
app.get("/api/records", async (_request, response, next) => {
  try {
    const records = await readRecords();
    records.sort((first, second) => `${second.date}T${second.time}`.localeCompare(`${first.date}T${first.time}`));
    response.json(records);
  } catch (error) {
    next(error);
  }
});

// Cria ou atualiza um registro e seus anexos em uma única requisição multipart.
app.post("/api/records", upload.array("files", 20), async (request, response, next) => {
  try {
    const payload = parseRecordPayload(request.body);
    let fileCategories;
    try {
      fileCategories = JSON.parse(request.body.fileCategories || "[]");
    } catch {
      const error = new Error("A lista de categorias dos arquivos é inválida.");
      error.status = 400;
      throw error;
    }
    const records = await readRecords();
    const existing = request.body.id ? records.find((record) => record.id === request.body.id) : null;
    if (request.body.id && !existing) {
      const error = new Error("Consulta não encontrada.");
      error.status = 404;
      throw error;
    }

    const recordId = existing?.id || crypto.randomUUID();
    const retained = Object.fromEntries(
      categories.map((category) => {
        const existingFiles = existing?.attachments?.[category] || [];
        const requestedIds = new Set(payload.retainedIds[category]);
        return [category, existingFiles.filter((file) => requestedIds.has(file.id))];
      }),
    );
    const uploaded = await storeUploadedFiles(recordId, request.files || [], fileCategories);
    const attachments = Object.fromEntries(
      categories.map((category) => [
        category,
        [...retained[category], ...uploaded[category]],
      ]),
    );
    const record = {
      id: recordId,
      doctor: payload.doctor,
      specialty: payload.specialty,
      date: payload.date,
      time: payload.time,
      observations: payload.observations,
      attachments,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedRecords = existing
      ? records.map((item) => (item.id === recordId ? record : item))
      : [record, ...records];
    await writeRecords(updatedRecords);
    await removeUnretainedFiles(recordId, existing?.attachments, attachments);
    response.status(existing ? 200 : 201).json(record);
  } catch (error) {
    next(error);
  }
});

// Envia um anexo pelo identificador do registro e do arquivo, preservando o nome original no download.
app.get("/api/records/:recordId/files/:fileId", async (request, response, next) => {
  try {
    const records = await readRecords();
    const record = records.find((item) => item.id === request.params.recordId);
    const attachment = record?.attachments
      ? categories.flatMap((category) => record.attachments[category] || []).find((file) => file.id === request.params.fileId)
      : null;
    if (!record || !attachment) {
      const error = new Error("Arquivo não encontrado.");
      error.status = 404;
      throw error;
    }
    const category = categories.find((key) => record.attachments[key]?.some((file) => file.id === attachment.id));
    response.download(path.join(filesDirectory, record.id, category, attachment.storedName), attachment.name);
  } catch (error) {
    next(error);
  }
});

// Exclui o registro e remove somente a pasta de anexos vinculada ao seu identificador.
app.delete("/api/records/:recordId", async (request, response, next) => {
  try {
    const records = await readRecords();
    const remaining = records.filter((record) => record.id !== request.params.recordId);
    if (remaining.length === records.length) {
      const error = new Error("Consulta não encontrada.");
      error.status = 404;
      throw error;
    }
    await writeRecords(remaining);
    await fs.rm(path.join(filesDirectory, request.params.recordId), { recursive: true, force: true });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Converte erros em respostas claras sem ocultar falhas inesperadas de gravação ou leitura.
app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: "Cada arquivo pode ter até 10 MB e a consulta pode conter até 20 arquivos." });
    return;
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  response.status(status).json({ error: status >= 500 ? "Erro interno ao processar a solicitação." : error.message });
});

// Inicializa o armazenamento antes de iniciar a API somente no host local por padrão.
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
initializeStorage()
  .then(() => app.listen(port, host, () => console.log(`API disponível em http://${host}:${port}`)))
  .catch((error) => {
    console.error("Não foi possível inicializar o armazenamento.", error);
    process.exitCode = 1;
  });
