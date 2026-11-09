// Expõe a janela nativa do Android para salvar documentos no armazenamento escolhido pelo usuário.
import { registerPlugin } from "@capacitor/core";

// Mantém a tipagem e a chamada ao plugin Android em um único módulo.
export const NativeDownloads = registerPlugin("NativeDownloads");
