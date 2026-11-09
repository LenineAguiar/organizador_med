// Implementa busca de consultas, formulário responsivo e organização de anexos por categoria.
import { useEffect, useMemo, useState } from "react";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { apiFetch, apiUrl, isNativeApp } from "./api.js";
import { deleteLocalRecord, getLocalRecords, saveLocalRecord } from "./localStore.js";
import { NativeDownloads } from "./nativeDownloads.js";

// Identifica se esta instância deve abrir no modo visitante sem credenciais.
const nativeApp = isNativeApp();

// Define as categorias de documentos exibidas no formulário de cada consulta.
const categories = [
  { id: "observations", label: "Observações" },
  { id: "receitas", label: "Receitas" },
  { id: "pedidos-exames", label: "Pedidos Exames" },
  { id: "relatorios", label: "Relatórios" },
  { id: "atestados", label: "Atestados" },
  { id: "outros", label: "Outros" },
];
const attachmentCategories = categories.filter((category) => category.id !== "observations");

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatInputTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// Cria um formulário vazio com as propriedades esperadas pela API.
function emptyRecord() {
  return {
    id: "",
    doctor: "",
    specialty: "",
    date: "",
    time: "",
    observations: "",
    attachments: Object.fromEntries(attachmentCategories.map(({ id }) => [id, []])),
  };
}

// Converte data ISO em texto localizado para facilitar a leitura dos cartões.
function formatDate(date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${date}T12:00:00`));
}

// Apresenta a lista, filtros, editor e mensagens de estado da aplicação.
export default function App() {
  const [authMode, setAuthMode] = useState(nativeApp ? "ready" : "checking");
  const [authUser, setAuthUser] = useState(
    nativeApp ? { id: "android-local", username: "Armazenamento local", isAdmin: false } : null,
  );
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [records, setRecords] = useState([]);
  const [filters, setFilters] = useState({ doctor: "", specialty: "", from: "", to: "" });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [draft, setDraft] = useState(null);
  const [activeTab, setActiveTab] = useState("observations");
  const [pendingFiles, setPendingFiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [usersOpen, setUsersOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [userForm, setUserForm] = useState({ username: "", password: "" });
  const [userError, setUserError] = useState("");
  const [userNotice, setUserNotice] = useState("");

  // Carrega dados locais no Android e mantém a API existente no navegador desktop.
  async function loadRecords() {
    setLoading(true);
    setErrorMessage("");
    try {
      if (nativeApp) {
        setRecords(await getLocalRecords());
        return;
      }
      const response = await apiFetch("/api/records");
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "Não foi possível carregar as consultas.");
        if (response.status === 401) {
          setAuthUser(null);
          setAuthMode("login");
          setAuthError(error.message);
        }
        throw error;
      }
      setRecords(result);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  // Valida a sessão somente no navegador; o Android abre diretamente no histórico local.
  useEffect(() => {
    if (nativeApp) return;
    apiFetch("/api/session")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível verificar a sessão.");
        if (result.setupRequired) {
          setAuthMode("setup");
        } else if (result.user) {
          setAuthUser(result.user);
          setAuthMode("ready");
        } else {
          setAuthMode("login");
        }
      })
      .catch((error) => {
        setAuthError(error.message);
        setAuthMode("login");
      });
  }, []);

  // Carrega o histórico após o início do app ou a confirmação da sessão no desktop.
  useEffect(() => {
    if (authUser) loadRecords();
  }, [authUser]);

  // Envia credenciais de configuração ou acesso e mantém a senha fora do armazenamento local.
  async function submitAuthentication(event) {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError("");
    try {
      const endpoint = authMode === "setup" ? "/api/setup" : "/api/login";
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível autenticar.");
      setAuthUser(result.user);
      setAuthForm({ username: "", password: "" });
      setAuthMode("ready");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthSubmitting(false);
    }
  }

  // Finaliza a sessão do navegador desktop e retorna à tela de entrada.
  async function logout() {
    try {
      const response = await apiFetch("/api/logout", { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível encerrar a sessão.");
      setAuthUser(null);
      setRecords([]);
      setUsersOpen(false);
      setAuthMode("login");
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  // Converte um anexo local em base64 para os recursos nativos de salvar e compartilhar.
  async function getAttachmentData(file) {
    const blob = file.blob;
    if (!(blob instanceof Blob)) throw new Error("O arquivo não foi encontrado no armazenamento local.");
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = () => {
        const data = String(reader.result).split(",")[1];
        if (!data) {
          reject(new Error("Não foi possível ler o conteúdo do arquivo."));
          return;
        }
        resolve(data);
      };
      reader.onerror = () => reject(new Error("Não foi possível preparar o arquivo."));
      reader.readAsDataURL(blob);
    });
  }

  // Abre o seletor nativo para salvar o anexo em uma pasta escolhida no aparelho.
  async function downloadAttachment(event, file) {
    event.preventDefault();
    try {
      const fileData = await getAttachmentData(file);
      const result = await NativeDownloads.saveToDevice({
        name: file.name,
        mimeType: file.mimeType,
        data: fileData,
      });
      if (result.saved) {
        setErrorMessage("");
        setNotice(`Arquivo salvo: ${file.name}`);
      }
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  // Grava temporariamente o anexo e abre o menu nativo de compartilhamento do Android.
  async function shareAttachment(event, file) {
    event.preventDefault();
    try {
      const fileData = await getAttachmentData(file);
      const extension = file.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || "";
      const savedFile = await Filesystem.writeFile({
        path: `${file.id}${extension}`,
        data: fileData,
        directory: Directory.Cache,
      });
      await Share.share({
        title: file.name,
        url: savedFile.uri,
        dialogTitle: "Compartilhar arquivo",
      });
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  // Busca contas sem expor hashes de senha e abre a área de administração.
  async function openUserManagement() {
    setUserError("");
    try {
      const response = await apiFetch("/api/users");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar os usuários.");
      setUsers(result);
      setUsersOpen(true);
    } catch (error) {
      setUserError(error.message);
      setErrorMessage(error.message);
    }
  }

  // Cadastra uma conta de teste usando as regras de validação do servidor.
  async function createUser(event) {
    event.preventDefault();
    setUserError("");
    setUserNotice("");
    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userForm),
      });
      const result = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(result?.error || "Não foi possível criar o usuário.");
      setUserForm({ username: "", password: "" });
      setUserNotice("Usuário criado com sucesso.");
      await openUserManagement();
    } catch (error) {
      setUserError(error.message);
    }
  }

  // Exclui uma conta selecionada e o servidor invalida as sessões abertas dessa conta.
  async function deleteUser(user) {
    if (!window.confirm(`Excluir o usuário ${user.username}?`)) return;
    setUserError("");
    setUserNotice("");
    try {
      const response = await apiFetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Não foi possível excluir o usuário.");
      }
      setUserNotice(`Usuário ${user.username} excluído.`);
      await openUserManagement();
    } catch (error) {
      setUserError(error.message);
    }
  }

  // Filtra por nome, especialidade e intervalo de datas sem diferenciar maiúsculas.
  const filteredRecords = useMemo(() => {
    const doctor = filters.doctor.trim().toLocaleLowerCase("pt-BR");
    const specialty = filters.specialty.trim().toLocaleLowerCase("pt-BR");
    return records.filter((record) => {
      const matchesDoctor = record.doctor.toLocaleLowerCase("pt-BR").includes(doctor);
      const matchesSpecialty = record.specialty.toLocaleLowerCase("pt-BR").includes(specialty);
      const matchesFrom = !filters.from || record.date >= filters.from;
      const matchesTo = !filters.to || record.date <= filters.to;
      return matchesDoctor && matchesSpecialty && matchesFrom && matchesTo;
    });
  }, [records, filters]);

  // Mantém a configuração e o login apenas na versão de navegador para computador.
  if (!nativeApp && authMode !== "ready") {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand auth-brand">
            <div className="brand-mark" aria-hidden="true">+</div>
            <div>
              <p className="eyebrow">SEU CUIDADO, ORGANIZADO</p>
              <h1>Meu Organizador Médico</h1>
            </div>
          </div>
          {authMode === "checking" ? (
            <p className="auth-description">Verificando acesso...</p>
          ) : (
            <>
              <div className="auth-heading">
                <h2>{authMode === "setup" ? "Crie a conta administradora" : "Acesse sua conta"}</h2>
                <p>{authMode === "setup" ? "Essa primeira conta poderá criar e remover usuários." : "Entre para acessar seu histórico médico."}</p>
              </div>
              <form className="auth-form" onSubmit={submitAuthentication}>
                <label>
                  Usuário
                  <input required minLength="3" maxLength="32" autoComplete="username" value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} placeholder="Seu nome de usuário" />
                </label>
                <label>
                  Senha
                  <input required minLength="8" maxLength="128" type="password" autoComplete={authMode === "setup" ? "new-password" : "current-password"} value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="Mínimo de 8 caracteres" />
                </label>
                {authError && <p className="feedback error-message" role="alert">{authError}</p>}
                <button className="primary-button auth-submit" type="submit" disabled={authSubmitting}>
                  {authSubmitting ? "Aguarde..." : authMode === "setup" ? "Criar administrador" : "Entrar"}
                </button>
              </form>
            </>
          )}
        </section>
      </main>
    );
  }

  // Apresenta a tela para criação e exclusão de usuários de teste pelo administrador.
  if (usersOpen) {
    return (
      <main className="app-shell user-management">
        <header className="page-header">
          <div>
            <p className="eyebrow">ADMINISTRAÇÃO</p>
            <h1>Gerenciar usuários</h1>
          </div>
          <button className="secondary-button" type="button" onClick={() => setUsersOpen(false)}>Voltar às consultas</button>
        </header>
        <section className="filter-panel user-create-panel">
          <div className="filter-title">
            <div>
              <p className="eyebrow">CONTAS DE TESTE</p>
              <h2>Criar usuário</h2>
            </div>
          </div>
          <form className="user-create-form" onSubmit={createUser}>
            <label>
              Usuário
              <input required minLength="3" maxLength="32" autoComplete="off" value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} placeholder="Letras, números, ponto, hífen ou sublinhado" />
            </label>
            <label>
              Senha
              <input required minLength="8" maxLength="128" type="password" autoComplete="new-password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} placeholder="Mínimo de 8 caracteres" />
            </label>
            <button className="primary-button" type="submit">Criar usuário</button>
          </form>
          {userError && <p className="feedback error-message" role="alert">{userError}</p>}
          {userNotice && <p className="feedback success-message" role="status">{userNotice}</p>}
        </section>
        <section className="user-list-panel">
          <div className="filter-title">
            <div>
              <p className="eyebrow">ACESSO AO SISTEMA</p>
              <h2>Usuários cadastrados</h2>
            </div>
            <span className="record-count">{users.length} {users.length === 1 ? "usuário" : "usuários"}</span>
          </div>
          <ul className="user-list">
            {users.map((user) => (
              <li className="user-row" key={user.id}>
                <div>
                  <strong>{user.username}</strong>
                  <span>{user.isAdmin ? "Administrador" : "Usuário de teste"}</span>
                </div>
                {user.id !== authUser.id && (
                  <button className="text-button delete-user-button" type="button" onClick={() => deleteUser(user)}>Excluir</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  // Abre um formulário novo e mantém a categoria inicial de observações selecionada.
  function createRecord() {
    setDraft(emptyRecord());
    setPendingFiles({});
    setActiveTab("observations");
    setNotice("");
  }

  // Carrega uma consulta salva no formulário para permitir edição dos campos e anexos.
  function editRecord(record) {
    setDraft({ ...record });
    setPendingFiles({});
    setActiveTab("observations");
    setNotice("");
  }

  // Atualiza um campo do formulário sem alterar o restante dos dados digitados.
  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  // Valida formatos, tamanho e quantidade de anexos antes de adicioná-los ao formulário.
  function chooseFiles(category, selectedFiles) {
    const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
    const selected = Array.from(selectedFiles);
    if (selected.some((file) => !allowedTypes.has(file.type))) {
      setErrorMessage("Anexe somente arquivos PDF ou imagens JPG, PNG, WEBP e GIF.");
      return;
    }
    if (selected.some((file) => file.size > 10 * 1024 * 1024)) {
      setErrorMessage("Cada arquivo pode ter até 10 MB.");
      return;
    }
    const existingCount = attachmentCategories.reduce(
      (total, { id }) => total + (draft.attachments[id]?.length || 0) + (pendingFiles[id]?.length || 0),
      0,
    );
    if (existingCount + selected.length > 20) {
      setErrorMessage("Cada consulta pode conter até 20 arquivos.");
      return;
    }
    setErrorMessage("");
    setPendingFiles((current) => ({
      ...current,
      [category]: [
        ...(current[category] || []),
        ...selected.map((file) => ({ file, description: "" })),
      ],
    }));
  }

  // Remove um anexo existente ou ainda não enviado e atualiza o rascunho local.
  function removeAttachment(category, fileId, pendingIndex) {
    if (fileId) {
      setDraft((current) => ({
        ...current,
        attachments: {
          ...current.attachments,
          [category]: current.attachments[category].filter((file) => file.id !== fileId),
        },
      }));
      return;
    }
    setPendingFiles((current) => ({
      ...current,
      [category]: current[category].filter((_, index) => index !== pendingIndex),
    }));
  }

  function updateAttachmentDescription(category, fileId, description) {
    setDraft((current) => ({
      ...current,
      attachments: {
        ...current.attachments,
        [category]: (current.attachments[category] || []).map((file) =>
          file.id === fileId ? { ...file, description } : file,
        ),
      },
    }));
  }

  function updatePendingDescription(category, pendingIndex, description) {
    setPendingFiles((current) => ({
      ...current,
      [category]: current[category].map((item, index) =>
        index === pendingIndex ? { ...item, description } : item,
      ),
    }));
  }

  // Salva no armazenamento local do Android ou envia os dados ao servidor desktop.
  async function saveRecord(event) {
    event.preventDefault();
    setSaving(true);
    setErrorMessage("");
    setNotice("");

    try {
      const timestamp = new Date();
      const recordDraft = {
        ...draft,
        specialty: draft.specialty.trim(),
        date: draft.date || formatInputDate(timestamp),
        time: draft.time || formatInputTime(timestamp),
      };
      if (nativeApp) {
        const attachments = Object.fromEntries(
          attachmentCategories.map(({ id }) => [
            id,
            [
              ...(draft.attachments[id] || []),
              ...(pendingFiles[id] || []).map(({ file, description }) => ({
                id: crypto.randomUUID(),
                name: file.name,
                description: description.trim(),
                size: file.size,
                mimeType: file.type,
                blob: file,
              })),
            ],
          ]),
        );
        await saveLocalRecord({
          ...recordDraft,
          id: draft.id || crypto.randomUUID(),
          attachments,
          createdAt: draft.createdAt || timestamp.toISOString(),
          updatedAt: timestamp.toISOString(),
        });
        setDraft(null);
        setPendingFiles({});
        setNotice("Consulta salva neste dispositivo.");
        await loadRecords();
        return;
      }

      const formData = new FormData();
      const retainedAttachments = Object.fromEntries(
        attachmentCategories.map(({ id }) => [id, draft.attachments[id] || []]),
      );
      formData.append("payload", JSON.stringify({ ...recordDraft, attachments: retainedAttachments }));
      if (draft.id) formData.append("id", draft.id);
      const uploadedCategories = [];
      const uploadedDescriptions = [];
      for (const { id } of attachmentCategories) {
        for (const { file, description } of pendingFiles[id] || []) {
          formData.append("files", file);
          uploadedCategories.push(id);
          uploadedDescriptions.push(description);
        }
      }
      formData.append("fileCategories", JSON.stringify(uploadedCategories));
      formData.append("fileDescriptions", JSON.stringify(uploadedDescriptions));
      const response = await apiFetch("/api/records", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar a consulta.");
      setDraft(null);
      setPendingFiles({});
      setNotice("Consulta salva com sucesso.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  // Confirma exclusão antes de remover a consulta local ou a versão armazenada no servidor.
  async function deleteRecord(record) {
    if (!window.confirm(`Excluir a consulta com ${record.doctor} e todos os seus anexos?`)) return;
    setErrorMessage("");
    try {
      if (nativeApp) {
        await deleteLocalRecord(record.id);
        if (draft?.id === record.id) setDraft(null);
        setNotice("Consulta excluída deste dispositivo.");
        await loadRecords();
        return;
      }
      const response = await apiFetch(`/api/records/${record.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Não foi possível excluir a consulta.");
      }
      if (draft?.id === record.id) setDraft(null);
      setNotice("Consulta excluída.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  // Apresenta filtros de consulta e o atalho para criar um novo registro.
  return (
    <main className="app-shell">
      <header className="page-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">+</div>
          <div>
            <p className="eyebrow">{nativeApp ? "USO OFFLINE · DADOS NESTE APARELHO" : "SEU CUIDADO, ORGANIZADO"}</p>
            <h1>Meu Organizador Médico</h1>
          </div>
        </div>
        <button className="primary-button new-button" type="button" onClick={createRecord}>
          <span aria-hidden="true">+</span> Nova consulta
        </button>
        {!nativeApp && (
          <div className="account-actions">
              <span>{authUser.username}</span>
              {authUser.isAdmin && <button className="text-button" type="button" onClick={openUserManagement}>Usuários</button>}
              <button className="text-button" type="button" onClick={logout}>Sair</button>
          </div>
        )}
      </header>

      <section className="filter-panel" aria-label="Filtros de consultas">
        <div className="filter-title">
          <div>
            <p className="eyebrow">HISTÓRICO DE SAÚDE</p>
            <h2>Suas consultas</h2>
          </div>
          <span className="record-count">{filteredRecords.length} {filteredRecords.length === 1 ? "consulta" : "consultas"}</span>
          <button
            className="text-button filter-toggle"
            type="button"
            aria-expanded={filtersExpanded}
            aria-controls="consultation-filters"
            onClick={() => setFiltersExpanded((expanded) => !expanded)}
          >
            {filtersExpanded ? "Recolher filtros" : "Expandir filtros"}
            <span aria-hidden="true">{filtersExpanded ? "−" : "+"}</span>
          </button>
        </div>
        <div className="filters-grid" id="consultation-filters" hidden={!filtersExpanded}>
          <label>
            Médico
            <input value={filters.doctor} onChange={(event) => setFilters({ ...filters, doctor: event.target.value })} placeholder="Nome do médico" />
          </label>
          <label>
            Especialidade
            <input value={filters.specialty} onChange={(event) => setFilters({ ...filters, specialty: event.target.value })} placeholder="Ex.: Cardiologia" />
          </label>
          <label>
            Data inicial
            <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
          </label>
          <label>
            Data final
            <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
          </label>
        </div>
      </section>

      {/* Comunica o resultado de ações e erros da API para que falhas não passem despercebidas. */}
      {errorMessage && <p className="feedback error-message" role="alert">{errorMessage}</p>}
      {notice && <p className="feedback success-message" role="status">{notice}</p>}

      {/* Exibe os registros filtrados com edição rápida e resumo de anexos. */}
      <section className="record-list" aria-live="polite">
        {loading ? (
          <div className="empty-state"><p>Carregando suas consultas...</p></div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">＋</div>
            <h3>{records.length ? "Nenhuma consulta encontrada" : "Seu histórico começa aqui"}</h3>
            <p>{records.length ? "Ajuste os filtros ou tente outro período." : "Cadastre sua primeira consulta para reunir tudo em um só lugar."}</p>
            {!records.length && <button className="secondary-button" type="button" onClick={createRecord}>Criar consulta</button>}
          </div>
        ) : (
          filteredRecords.map((record) => (
            <article className="record-card" key={record.id}>
              <div className="record-date">
                <span>{formatDate(record.date)}</span>
                <span>{record.time}</span>
              </div>
              <div className="record-info">
                <h3>{record.doctor}</h3>
                <p>{record.specialty}</p>
                {record.observations && <p className="record-observation">{record.observations}</p>}
                <div className="attachment-summary">
                  {attachmentCategories.map(({ id, label }) => {
                    const count = record.attachments?.[id]?.length || 0;
                    return count ? <span key={id}>{label}: {count}</span> : null;
                  })}
                </div>
              </div>
              <div className="record-actions">
                <button className="text-button" type="button" onClick={() => editRecord(record)}>Abrir</button>
                <button className="icon-button delete-button" type="button" onClick={() => deleteRecord(record)} aria-label={`Excluir consulta com ${record.doctor}`} title="Excluir consulta">×</button>
              </div>
            </article>
          ))
        )}
      </section>

      {/* Mantém o formulário em uma janela própria para edição sem sair da lista de consultas. */}
      {draft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setDraft(null);
        }}>
          <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
            <header className="editor-header">
              <div>
                <p className="eyebrow">{draft.id ? "REGISTRO MÉDICO" : "NOVO REGISTRO"}</p>
                <h2 id="editor-title">{draft.id ? "Editar consulta" : "Nova consulta"}</h2>
              </div>
              <button className="icon-button close-button" type="button" onClick={() => setDraft(null)} aria-label="Fechar formulário">×</button>
            </header>
            <form onSubmit={saveRecord}>
              <div className="appointment-fields">
                <label className="wide-field">
                  Nome do médico
                  <input required maxLength="120" value={draft.doctor} onChange={(event) => updateDraft("doctor", event.target.value)} placeholder="Ex.: Dra. Ana Souza" />
                </label>
                <label>
                  Especialidade
                  <input maxLength="120" value={draft.specialty} onChange={(event) => updateDraft("specialty", event.target.value)} placeholder="Ex.: Cardiologia" />
                </label>
                <label>
                  Data
                  <input type="date" value={draft.date} onChange={(event) => updateDraft("date", event.target.value)} />
                </label>
                <label>
                  Horário
                  <input type="time" value={draft.time} onChange={(event) => updateDraft("time", event.target.value)} />
                </label>
              </div>
              <div className="tab-list" role="tablist" aria-label="Informações da consulta">
                {categories.map(({ id, label }) => (
                  <button
                    className={`tab-button ${activeTab === id ? "active" : ""}`}
                    id={`tab-${id}`}
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    aria-controls={`panel-${id}`}
                    onClick={() => setActiveTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="tab-panel" id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
                {activeTab === "observations" ? (
                  <label className="observation-field">
                    Anotações sobre a consulta
                    <textarea rows="7" maxLength="10000" value={draft.observations} onChange={(event) => updateDraft("observations", event.target.value)} placeholder="Digite sintomas, orientações médicas, próximos passos ou outras observações..." />
                  </label>
                ) : (
                  <div className="file-panel">
                    <p>Adicione documentos em PDF ou imagens (JPG, PNG, WEBP e GIF), até 10 MB cada.</p>
                    <label className="file-picker">
                      <span aria-hidden="true">↑</span> Anexar arquivos
                      <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => chooseFiles(activeTab, event.target.files)} />
                    </label>
                    <ul className="file-list">
                      {(draft.attachments[activeTab] || []).map((file) => (
                        <li key={file.id}>
                          <span className="file-kind" aria-hidden="true">{file.mimeType === "application/pdf" ? "PDF" : "IMG"}</span>
                          <div className="attachment-item-details">
                            {nativeApp ? (
                              <span className="attachment-display-name">{file.description?.trim() || file.name}</span>
                            ) : (
                              <a className="attachment-display-name" href={apiUrl(`/api/records/${draft.id}/files/${file.id}`)} download>{file.description?.trim() || file.name}</a>
                            )}
                            <input
                              className="attachment-description"
                              maxLength="200"
                              value={file.description || ""}
                              onChange={(event) => updateAttachmentDescription(activeTab, file.id, event.target.value)}
                              placeholder="Descrição do arquivo (opcional)"
                              aria-label={`Descrição do arquivo ${file.name}`}
                            />
                          </div>
                          {nativeApp && (
                            <div className="attachment-actions">
                              <button className="text-button" type="button" onClick={(event) => downloadAttachment(event, file)}>Baixar</button>
                              <button className="text-button" type="button" onClick={(event) => shareAttachment(event, file)}>Compartilhar</button>
                            </div>
                          )}
                          <button className="remove-file" type="button" onClick={() => removeAttachment(activeTab, file.id)} aria-label={`Remover ${file.description?.trim() || file.name}`}>×</button>
                        </li>
                      ))}
                      {(pendingFiles[activeTab] || []).map(({ file, description }, index) => (
                        <li key={`${file.name}-${index}`}>
                          <span className="file-kind" aria-hidden="true">{file.type === "application/pdf" ? "PDF" : "IMG"}</span>
                          <div className="attachment-item-details">
                            <span className="attachment-display-name">{description.trim() || file.name} <small>(aguardando salvar)</small></span>
                            <input
                              className="attachment-description"
                              maxLength="200"
                              value={description}
                              onChange={(event) => updatePendingDescription(activeTab, index, event.target.value)}
                              placeholder="Descrição do arquivo (opcional)"
                              aria-label={`Descrição do arquivo ${file.name}`}
                            />
                          </div>
                          <button className="remove-file" type="button" onClick={() => removeAttachment(activeTab, null, index)} aria-label={`Remover ${description.trim() || file.name}`}>×</button>
                        </li>
                      ))}
                    </ul>
                    {!draft.id && <p className="inline-hint">{nativeApp ? "Os arquivos serão salvos neste dispositivo." : "Os arquivos serão enviados ao salvar a consulta."}</p>}
                  </div>
                )}
              </div>
              <footer className="editor-footer">
                <button className="secondary-button" type="button" onClick={() => setDraft(null)} disabled={saving}>Cancelar</button>
                <button className="primary-button" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar consulta"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
