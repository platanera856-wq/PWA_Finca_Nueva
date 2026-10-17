(() => {
 const DB_NAME="finca-registros-nueva", STORE="registros";
 function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:"id"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
 async function run(mode,fn){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);let result;try{result=fn(tx.objectStore(STORE))}catch(e){db.close();reject(e);return}tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error)}})}
 window.FincaDB={save:r=>run("readwrite",s=>s.put(r)),remove:id=>run("readwrite",s=>s.delete(id)),async all(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),q=tx.objectStore(STORE).getAll();q.onsuccess=()=>resolve(q.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error)}})}};
})();
