// Configura o React no Vite e encaminha chamadas da interface para a API Node.js.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mantém interface e API disponíveis no mesmo domínio durante o desenvolvimento.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
