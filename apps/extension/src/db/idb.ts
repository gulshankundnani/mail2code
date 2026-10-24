// Minimal promise wrapper over IndexedDB. Kept dependency-free on purpose.

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDb(
  factory: IDBFactory,
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, version);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion, r.transaction!);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("Database upgrade blocked by another open tab. Close other extension tabs and retry."));
  });
}

// Runs `fn` in one transaction and resolves after it commits. `fn` may only
// await IndexedDB requests made on `tx`; awaiting anything else lets the
// transaction auto-commit early. If `fn` throws, the transaction is aborted
// and nothing it wrote is kept.
export async function inTx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
  let result: T;
  try {
    result = await fn(tx);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // already finished
    }
    await done.catch(() => {});
    throw err;
  }
  await done;
  return result;
}
