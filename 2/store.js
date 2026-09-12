// Named documents in localStorage. No DOM. Falls back to memory when storage is blocked.
const memory = new Map();
const backend = (() => {
  try {
    globalThis.localStorage.getItem("calced-files");
    return globalThis.localStorage;
  } catch (e) {
    return {
      getItem: k => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, v),
      removeItem: k => memory.delete(k),
    };
  }
})();

const FILES = "calced-files";
const ACTIVE = "calced-active";
const DRAFT = "calced-draft";

function allFiles() {
  try {
    const raw = backend.getItem(FILES);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    return {};
  }
}

function putFiles(obj) {
  try { backend.setItem(FILES, JSON.stringify(obj)); } catch (e) {}
}

export function listFiles() {
  return Object.keys(allFiles()).sort((a, b) => a.localeCompare(b));
}

export function readFile(name) {
  const files = allFiles();
  return name in files ? files[name] : null;
}

export function writeFile(name, text) {
  const files = allFiles();
  files[name] = text;
  putFiles(files);
}

export function renameFile(from, to) {
  const files = allFiles();
  if (!(from in files) || to in files) return false;
  files[to] = files[from];
  delete files[from];
  putFiles(files);
  if (backend.getItem(ACTIVE) === from) backend.setItem(ACTIVE, to);
  return true;
}

export function deleteFile(name) {
  const files = allFiles();
  delete files[name];
  putFiles(files);
  if (backend.getItem(ACTIVE) === name) backend.removeItem(ACTIVE);
}

export function getActive() {
  const name = backend.getItem(ACTIVE);
  if (name !== null && name in allFiles()) return { name, text: readFile(name) };
  return { name: null, text: backend.getItem(DRAFT) || "" };
}

export function setActive(name) {
  if (name === null) backend.removeItem(ACTIVE);
  else backend.setItem(ACTIVE, name);
}

export function saveActive(text) {
  const name = backend.getItem(ACTIVE);
  if (name !== null && name in allFiles()) writeFile(name, text);
  else { try { backend.setItem(DRAFT, text); } catch (e) {} }
}

export function uniqueName(base) {
  const files = allFiles();
  if (!(base in files)) return base;
  for (let i = 2; ; i++) {
    const name = base + " " + i;
    if (!(name in files)) return name;
  }
}
