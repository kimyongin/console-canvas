export async function database() {
  return await new Promise((resolve,reject)=>{
    const request=indexedDB.open('console-canvas',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('documents',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function saveDocument(value) {
  const db=await database();
  await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(value);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
}
export async function getDocument(id) {
  const db=await database();
  const result=await new Promise((resolve,reject)=>{const request=db.transaction('documents').objectStore('documents').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();return result;
}
export async function listDocuments() {
  const db=await database();
  const result=await new Promise((resolve,reject)=>{const request=db.transaction('documents').objectStore('documents').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();return result.sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
}
