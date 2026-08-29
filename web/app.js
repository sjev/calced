// DOM wiring: render loop, file menu, docs document, autocomplete popup, share link, copy.
import {
  processText, highlightLine, escapeHTML,
  RESULT_RE, splitSections, computeTotalIndicators, alignDecimalPoints,
} from "./document.js";
import { suggest, ASSIGN_RE } from "./suggest.js";
import * as store from "./store.js";
import { shareLink, readShared } from "./share.js";

// --- UI Wiring ---
const input = document.getElementById("input");
const results = document.getElementById("results");
const highlight = document.getElementById("highlight");
const shareBtn = document.getElementById("share-btn");
const copyBtn = document.getElementById("copy-btn");
const docsBtn = document.getElementById("docs-btn");
const fileBtn = document.getElementById("file-btn");
const fileMenu = document.getElementById("file-menu");
let lastVarValues = {};  // lower-case variable name -> rendered value, for autocomplete

// --- Docs ---
// The docs document loads into the editor. It stays editable, so the reader can try
// changes, but nothing about it is stored.
let docsText = null;
let docsMode = false;
let prevDoc = null;

async function loadDocs() {
  if (docsText === null) docsText = await fetch("docs.md").then(r => r.text());
  return docsText;
}

async function openDocs() {
  let text;
  try {
    text = await loadDocs();
  } catch (e) {
    console.error("Failed to load docs.md", e);
    return;
  }
  flushSave();
  prevDoc = { name: activeName(), text: input.value };
  docsMode = true;
  input.value = text;
  render();
  updateFileLabel();
  docsBtn.textContent = "Close docs";
  input.focus();
}

function closeDocs() {
  const { name, text } = prevDoc;
  switchTo(name, text);
}

docsBtn.addEventListener("click", () => (docsMode ? closeDocs() : openDocs()));

// --- File Menu ---
// Docs mode counts as unnamed: the menu then offers "Save as", never Delete or Rename,
// so the document underneath cannot be overwritten with docs text.
function activeName() {
  return docsMode ? null : store.getActive().name;
}

function updateFileLabel() {
  const name = activeName();
  const label = docsMode ? "Docs (not saved)" : name === null ? "Untitled *" : name;
  fileBtn.textContent = label + " \u25BE";
}

function renderFileMenu() {
  const name = activeName();
  const rows = store.listFiles().map(f =>
    '<button data-file="' + escapeHTML(f) + '"' + (f === name ? ' class="active"' : '') +
    '>' + escapeHTML(f) + '</button>'
  ).join("");
  fileMenu.innerHTML =
    '<button data-action="new">New</button>' +
    '<button data-action="rename">' + (name === null ? "Save as\u2026" : "Rename\u2026") + '</button>' +
    '<button data-action="duplicate">Duplicate</button>' +
    (name === null ? '' : '<button data-action="delete">Delete</button>') +
    (rows ? '<div class="menu-label">saved</div>' + rows : '');
}

function closeFileMenu() {
  fileMenu.hidden = true;
}

function flushSave() {
  clearTimeout(saveTimer);
  if (!docsMode) store.saveActive(input.value);
}

function switchTo(name, text) {
  flushSave();
  docsMode = false;
  docsBtn.textContent = "Docs";
  store.setActive(name);
  input.value = text;
  render();
  updateFileLabel();
  closeFileMenu();
  input.focus();
}

function askName(base) {
  const name = (prompt("File name:", base) || "").trim();
  if (!name) return null;
  if (store.readFile(name) !== null && !confirm('Replace "' + name + '"?')) return null;
  return name;
}

function fileAction(action) {
  const name = activeName();
  if (action === "new") {
    switchTo(null, "");
  } else if (action === "rename") {
    const to = askName(name === null ? store.uniqueName("Untitled") : name);
    if (!to) return;
    if (name !== null && !store.renameFile(name, to)) store.deleteFile(name);
    store.writeFile(to, input.value);
    switchTo(to, input.value);
  } else if (action === "duplicate") {
    const to = askName(store.uniqueName((name === null ? "Untitled" : name) + " copy"));
    if (!to) return;
    store.writeFile(to, input.value);
    switchTo(to, input.value);
  } else if (action === "delete") {
    if (name === null || !confirm('Delete "' + name + '"?')) return;
    store.deleteFile(name);
    const next = store.listFiles()[0];
    switchTo(next === undefined ? null : next, next === undefined ? "" : store.readFile(next));
  }
}

fileBtn.addEventListener("click", e => {
  e.stopPropagation();
  if (fileMenu.hidden) renderFileMenu();
  fileMenu.hidden = !fileMenu.hidden;
  input.focus();  // keep the caret in the editor: typing then closes the menu
});

fileMenu.addEventListener("click", e => {
  const el = e.target.closest("[data-action], [data-file]");
  if (!el) return;
  closeFileMenu();
  if (el.dataset.action) fileAction(el.dataset.action);
  else switchTo(el.dataset.file, store.readFile(el.dataset.file));
});

document.addEventListener("click", e => {
  if (!fileMenu.hidden && !e.target.closest("#file-menu, #file-btn")) closeFileMenu();
});

function render() {
  const text = input.value;
  const cleaned = text.split("\n").map(l => l.replace(RESULT_RE, "")).join("\n");
  if (cleaned !== text) input.value = cleaned;
  const lines = cleaned.split("\n");
  const output = processText(cleaned);
  const aligned = alignDecimalPoints(output, lines, "frac");
  const indicators = computeTotalIndicators(output, lines);
  lastVarValues = {};
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[@#]/.test(lines[i]) || !output[i] || output[i].result === null) continue;
    const m = lines[i].match(ASSIGN_RE);
    if (m) lastVarValues[m[1].toLowerCase()] = output[i].result;
  }
  results.innerHTML = aligned.map((r, i) => {
    const cls = ["result-line"];
    if (indicators[i] === "summed") cls.push("summed");
    if (indicators[i] === "total") cls.push("total-line");
    return '<div class="' + cls.join(" ") + '">' + (r !== null ? escapeHTML(r) : '') + '</div>';
  }).join("");
  highlight.innerHTML = output.map((o, i) =>
    '<div class="hl-line">' + highlightLine(lines[i], o.cls) + '</div>'
  ).join("");
  // Sync result line heights with highlight line heights
  const hlLines = highlight.children;
  const resLines = results.children;
  for (let i = 0; i < hlLines.length && i < resLines.length; i++) {
    resLines[i].style.height = hlLines[i].getBoundingClientRect().height + 'px';
  }
  scheduleSave();
  const heading = lines.find(l => l.trim().startsWith("#"));
  document.title = heading ? heading.replace(/^#+ */, "").trim() + " - calced" : "calced";
}

input.addEventListener("input", render);
// Capture phase: any key closes the file menu, even when the autocomplete popup
// stops the Escape key from bubbling.
document.addEventListener("keydown", () => {
  if (!fileMenu.hidden) closeFileMenu();
}, true);

// --- Line hover highlight ---
let hoveredIdx = -1;
const editorInner = document.querySelector(".editor-inner");
function setHoveredLine(idx) {
  if (idx === hoveredIdx) return;
  if (hoveredIdx >= 0) {
    highlight.children[hoveredIdx]?.classList.remove("line-hover");
    results.children[hoveredIdx]?.classList.remove("line-hover");
  }
  hoveredIdx = idx;
  if (hoveredIdx >= 0) {
    highlight.children[hoveredIdx]?.classList.add("line-hover");
    results.children[hoveredIdx]?.classList.add("line-hover");
  }
}
editorInner.addEventListener("mousemove", e => {
  const resLine = e.target.closest(".result-line");
  if (resLine) {
    setHoveredLine([...results.children].indexOf(resLine));
    return;
  }
  // Over input area: find line by Y position
  const resChildren = results.children;
  if (!resChildren.length) return;
  const y = e.clientY;
  for (let i = resChildren.length - 1; i >= 0; i--) {
    if (y >= resChildren[i].getBoundingClientRect().top) {
      setHoveredLine(i);
      return;
    }
  }
  setHoveredLine(-1);
});
editorInner.addEventListener("mouseleave", () => setHoveredLine(-1));


// --- Autocomplete popup ---
const acEl = document.getElementById("ac");
const editorWrap = document.querySelector(".editor-wrap");
let acItems = [];
let acIdx = 0;
let acStart = 0;
let acEnd = 0;

function acClose() {
  acEl.hidden = true;
  acItems = [];
}

// The caret in pixels, measured on the #highlight mirror. It has the same font,
// padding and line height as the textarea, so a Range over it is exact.
function acCaretRect() {
  const caret = input.selectionStart;
  const text = input.value;
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const el = highlight.children[text.slice(0, lineStart).split("\n").length - 1];
  if (!el) return input.getBoundingClientRect();
  const col = caret - lineStart;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (seen + len >= col) {
      const range = document.createRange();
      range.setStart(node, col - seen);
      range.collapse(true);
      const r = range.getBoundingClientRect();
      if (r.width || r.height) return r;
      break;
    }
    seen += len;
  }
  return el.getBoundingClientRect();
}

function acPlace() {
  const r = acCaretRect();
  const wrap = editorWrap.getBoundingClientRect();
  if (r.bottom < wrap.top || r.top > wrap.bottom) return acClose();  // caret scrolled away
  const h = acEl.offsetHeight;
  const w = acEl.offsetWidth;
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  acEl.style.top = top + "px";
  acEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
}

function acUpdate(force) {
  if (document.activeElement !== input || input.selectionStart !== input.selectionEnd) return acClose();
  const res = suggest(input.value, input.selectionStart, !!force, lastVarValues);
  if (!res.items.length) return acClose();
  acItems = res.items;
  acStart = res.start;
  acEnd = res.end;
  acIdx = 0;
  acEl.innerHTML = acItems.map((it, i) =>
    '<div class="ac-item' + (i ? '' : ' sel') + '" data-i="' + i + '">'
    + '<span>' + escapeHTML(it.name) + '</span>'
    + '<span class="ac-desc">' + escapeHTML(it.desc) + '</span></div>').join("");
  acEl.hidden = false;
  acEl.scrollTop = 0;
  acPlace();
}

function acMove(step) {
  acEl.children[acIdx].classList.remove("sel");
  acIdx = (acIdx + step + acItems.length) % acItems.length;
  acEl.children[acIdx].classList.add("sel");
  acEl.children[acIdx].scrollIntoView({ block: "nearest" });
}

function acAccept() {
  const it = acItems[acIdx];
  const base = acStart;
  const text = input.value;
  acClose();
  input.value = text.slice(0, acStart) + it.insert + text.slice(acEnd);
  render();  // render() may rewrite input.value, so set the caret after it
  input.selectionStart = base + it.cursor[0];
  input.selectionEnd = base + it.cursor[1];
  if (it.insert.endsWith(" = ")) acUpdate(true);  // "@format = " offers its values
}

input.addEventListener("input", () => acUpdate(false));
input.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key === " ") { e.preventDefault(); acUpdate(true); return; }
  if (acEl.hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); acMove(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); acMove(-1); }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acAccept(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); acClose(); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") acClose();
});
input.addEventListener("blur", acClose);
input.addEventListener("click", acClose);
const acFollow = () => { if (!acEl.hidden) acPlace(); };
editorWrap.addEventListener("scroll", acFollow);
window.addEventListener("resize", acFollow);
acEl.addEventListener("mousedown", e => e.preventDefault());  // keep the caret
acEl.addEventListener("click", e => {
  const row = e.target.closest(".ac-item");
  if (!row) return;
  acIdx = +row.dataset.i;
  acAccept();
  input.focus();
});

// --- Persistence ---
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  if (docsMode) return;
  saveTimer = setTimeout(() => store.saveActive(input.value), 300);
}

function formatForFile(text) {
  const lines = text.split("\n");
  const output = processText(text);
  const aligned = alignDecimalPoints(output, lines, "int");
  const indicators = computeTotalIndicators(output, lines);

  // Per-section column alignment (match Python CLI behavior)
  const sections = splitSections(output, lines);

  const formatted = new Array(lines.length);
  for (const sec of sections) {
    const resultIdxs = sec.filter(i => output[i].result !== null);
    const maxLen = resultIdxs.length ? Math.max(...resultIdxs.map(i => lines[i].length)) : 0;
    const align = Math.max(maxLen + 2, 40);
    // Compute max result width among indicator-bearing lines for alignment
    let maxIndW = 0;
    for (const i of sec) {
      if (output[i].result !== null && indicators[i]) {
        maxIndW = Math.max(maxIndW, aligned[i].length);
      }
    }
    for (const i of sec) {
      if (output[i].result !== null) {
        const hasInd = indicators[i];
        const ind = indicators[i] === "summed" ? " │" : indicators[i] === "total" ? " ┘" : "";
        const padded = hasInd ? aligned[i].padEnd(maxIndW) : aligned[i];
        formatted[i] = lines[i].padEnd(align) + "# => " + padded + ind;
      } else {
        formatted[i] = lines[i];
      }
    }
  }
  return formatted.join("\n");
}

function copyText() {
  const text = input.value;
  if (!text.trim()) return;
  navigator.clipboard.writeText(formatForFile(text) + "\n").then(() => {
    copyBtn.classList.add("copied");  // icon button: show the result with color only
    setTimeout(() => copyBtn.classList.remove("copied"), 1500);
  });
}

async function shareURL() {
  const url = await shareLink(input.value);
  navigator.clipboard.writeText(url).then(() => {
    shareBtn.textContent = "Link copied!";
    shareBtn.classList.add("copied");
    setTimeout(() => { shareBtn.textContent = "Share"; shareBtn.classList.remove("copied"); }, 1500);
  });
}

shareBtn.addEventListener("click", shareURL);
copyBtn.addEventListener("click", copyText);

readShared().then(async shared => {
  if (shared !== null) {
    history.replaceState(null, "", location.pathname);
    store.setActive(null);
    input.value = shared;
  } else {
    const { name, text } = store.getActive();
    // A first visit starts with the docs as an ordinary draft, so edits to it are kept.
    const fresh = name === null && !store.listFiles().length;
    input.value = text || (fresh ? await loadDocs().catch(() => "") : "");
  }
  render();
  updateFileLabel();
});
