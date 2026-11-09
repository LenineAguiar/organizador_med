// Inicializa a interface React e registra o service worker para permitir instalação como PWA.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Monta a aplicação no elemento raiz criado no documento HTML.
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Ativa cache somente da interface, sem armazenar dados pessoais ou respostas da API offline.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Não foi possível registrar o modo instalável.", error);
    });
  });
}
