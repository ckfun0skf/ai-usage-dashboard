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
    const existing = await this.load();
    const byId = new Map((existing?.events || []).map(event => [event.id, event]));
    let added = 0;
    let duplicates = 0;
    for (const event of dataset.events) {
      if (byId.has(event.id)) { duplicates++; continue; }
      byId.set(event.id, event);
      added++;
    }
    const mergedEvents = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
    const now = Date.now();
    const merged = {
      id: "latest",
      sourceName: dataset.sourceName,
      adapterId: dataset.adapterId,
      importedAt: now,
      sourceRows: mergedEvents.length,
      skippedRows: dataset.skippedRows || 0,
      lastImport: { sourceName: dataset.sourceName, importedAt: now, received: dataset.events.length, added, duplicates, skippedRows: dataset.skippedRows || 0 },
      events: mergedEvents
    };
    await transact("readwrite", store => store.put(merged));
    return { ...merged, added, duplicates };
  },
  async load() {
    return transact("readonly", store => store.get("latest"));
  },
  async clear() {
    await transact("readwrite", store => store.delete("latest"));
  }
};