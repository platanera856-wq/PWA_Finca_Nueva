(() => {
  'use strict';
  const DB_NAME = 'finca-registros-nueva';
  const STORE = 'registros';
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('No se pudo abrir el almacenamiento local.'));
    });
  }
  async function transact(mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      try { result = action(tx.objectStore(STORE)); } catch (e) { db.close(); reject(e); return; }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Falló el almacenamiento local.')); };
    });
  }
  window.FincaDB = {
    save: r => transact('readwrite', s => s.put(r)),
    remove: id => transact('readwrite', s => s.delete(id)),
    async all() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    }
  };
})();
