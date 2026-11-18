"use strict";

(() => {
  // Store snapshots, not filesystem handles, so restoring works from file://.
  const PREFIX = "deck-analyser:file:";
  let database;

  function openDatabase() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("deck-analyser-files", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Browser storage is blocked."));
    });
    return database;
  }

  async function access(mode, key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("files", mode);
      const store = transaction.objectStore("files");
      const request = mode === "readonly" ? store.get(key) : store.put(value, key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Browser storage is unavailable."));
    });
  }

  function valid(value) {
    return value && typeof value.name === "string" && typeof value.text === "string" &&
      typeof value.type === "string" && Number.isFinite(value.lastModified);
  }

  async function read(key) {
    try {
      const value = await access("readonly", key);
      if (value !== undefined) return value;
    } catch { /* Some browsers restrict IndexedDB for local files. */ }
    try {
      return JSON.parse(localStorage.getItem(PREFIX + key));
    } catch { /* A blocked store or malformed entry should not prevent use. */ }
    return null;
  }

  async function write(key, value) {
    try {
      await access("readwrite", key, value);
      try { localStorage.removeItem(PREFIX + key); } catch { /* Optional cleanup. */ }
    } catch {
      // This also reports quota/storage failures to the caller instead of silently losing the file.
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  }

  async function load(key) {
    const value = await read(key);
    return valid(value) ? value : null;
  }

  function save(key, file, text) {
    return write(key, { name: file.name, type: file.type || "text/plain", lastModified: file.lastModified, text });
  }

  async function loadMany(key) {
    const value = await read(key);
    return Array.isArray(value) && value.every(valid) ? value : [];
  }

  function saveMany(key, files) {
    return write(key, files);
  }

  function restorePicker(input, value) {
    try {
      const transfer = new DataTransfer();
      for (const file of Array.isArray(value) ? value : [value]) {
        transfer.items.add(new File([file.text], file.name, { type: file.type, lastModified: file.lastModified }));
      }
      input.files = transfer.files;
    } catch { /* The adjacent filename and loaded text remain usable. */ }
  }

  window.DeckFiles = Object.freeze({ load, save, loadMany, saveMany, restorePicker });
})();
