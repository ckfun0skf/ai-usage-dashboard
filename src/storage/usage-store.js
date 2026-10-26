const DB_NAME = "ai-usage-dashboard";
const DB_VERSION = 1;
const STORE_NAME = "datasets";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("This browser does not support IndexedDB."));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
  });
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try { result = operation(store); } catch (error) { db.close(); reject(error); return; }
    transaction.oncomplete = () => { db.close(); resolve(result?.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Browser storage transaction failed.")); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Browser storage transaction was aborted.")); };
  });
}

export const usageStore = {
  async save(dataset) {
    await transact("readwrite", store => store.put({ ...dataset, id: "latest" }));
  },
  async load() {
    return transact("readonly", store => store.get("latest"));
  },
  async clear() {
    await transact("readwrite", store => store.delete("latest"));
  }
};