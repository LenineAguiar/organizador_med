// Centraliza a URL do servidor e identifica chamadas nativas sem alterar o acesso pelo navegador.
import { Capacitor } from "@capacitor/core";

// Mantém endereço do servidor e token de acesso opcionais no armazenamento local do Android.
const serverUrlKey = "organizador-medico-server-url";
const accessTokenKey = "organizador-medico-access-token";
const configuredBuildUrl = import.meta.env.VITE_API_URL || "";

// Detecta a execução nativa e retorna apenas endereços configurados explicitamente no aplicativo.
export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

// Recupera o servidor definido pelo usuário ou pela configuração de compilação.
export function getConfiguredServerUrl() {
  if (!isNativeApp()) return window.location.origin;
  return localStorage.getItem(serverUrlKey) || configuredBuildUrl;
}

// Valida e persiste uma URL HTTP(S) sem caminhos, credenciais ou parâmetros inesperados.
export function saveServerUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Informe o endereço completo do servidor, por exemplo http://192.168.0.10:3000.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use um endereço HTTP ou HTTPS válido, sem caminhos adicionais.");
  }
  if (isNativeApp() && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("No celular, localhost aponta para o próprio aparelho. Informe o endereço IP do computador que executa o servidor.");
  }
  localStorage.setItem(serverUrlKey, url.origin);
  return url.origin;
}

// Constrói endereços absolutos para chamadas à API e download de documentos médicos.
export function apiUrl(path) {
  return `${getConfiguredServerUrl() || window.location.origin}${path}`;
}

// Acrescenta a identificação do aplicativo e o token opcional às chamadas nativas autenticadas.
export function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const serverUrl = getConfiguredServerUrl() || window.location.origin;
  if (isNativeApp()) {
    headers.set("X-Organizador-Client", "android");
    const token = localStorage.getItem(accessTokenKey);
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: isNativeApp() ? "omit" : options.credentials,
  }).catch((error) => {
    if (error instanceof TypeError) {
      throw new Error(
        `Não foi possível conectar ao servidor ${serverUrl}. Confira o endereço e a porta; no celular, use o IP do computador, deixe o Node.js em execução e permita Node.js na rede privada do firewall. Não use localhost no celular.`,
      );
    }
    throw error;
  });
}

// Guarda ou remove o token de sessão nativa após autenticação opcional no Android.
export function saveAccessToken(token) {
  if (token) localStorage.setItem(accessTokenKey, token);
  else localStorage.removeItem(accessTokenKey);
}
