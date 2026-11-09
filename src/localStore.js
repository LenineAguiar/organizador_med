// Mantém consultas e anexos no armazenamento persistente do próprio dispositivo.
const databaseName = "organizador-medico-local";
const databaseVersion = 1;
const recordsStoreName = "records";

// Abre o banco IndexedDB e cria o repositório de consultas na primeira execução.
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(recordsStoreName)) {
        database.createObjectStore(recordsStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Não foi possível abrir o armazenamento local do aplicativo."));
    request.onblocked = () => reject(new Error("Feche outras janelas do aplicativo e tente novamente."));
  });
}

// Executa uma operação IndexedDB e só confirma o sucesso após a transação terminar.
async function runTransaction(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(recordsStoreName, mode);
    const store = transaction.objectStore(recordsStoreName);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(result?.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(new Error("Não foi possível acessar as consultas salvas neste dispositivo."));
    };
    transaction.onabort = () => {
      database.close();
      reject(new Error("A gravação local foi cancelada. Tente novamente."));
    };
  });
}

// Lista consultas locais em ordem cronológica decrescente, como na tela principal.
export async function getLocalRecords() {
  const records = await runTransaction("readonly", (store) => store.getAll());
  return records.sort((first, second) =>
    second.date.localeCompare(first.date) || second.time.localeCompare(first.time),
  );
}

// Grava ou atualiza uma consulta e seus anexos binários em uma única transação local.
export function saveLocalRecord(record) {
  return runTransaction("readwrite", (store) => store.put(record));
}

// Apaga uma consulta e todos os anexos que ela contém no dispositivo.
export function deleteLocalRecord(id) {
  return runTransaction("readwrite", (store) => store.delete(id));
}
