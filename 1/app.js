// DOM wiring: render loop, docs panel, autocomplete popup, URL hash, export.
import {
  processText, highlightLine, escapeHTML,
  RESULT_RE, splitSections, computeTotalIndicators, alignDecimalPoints,
} from "./document.js";
import { suggest, ASSIGN_RE } from "./suggest.js";

// --- UI Wiring ---
const input = document.getElementById("input");
const results = document.getElementById("results");
const highlight = document.getElementById("highlight");
const shareBtn = document.getElementById("share-btn");
const docsBtn = document.getElementById("docs-btn");
const cheatsheet = document.getElementById("cheatsheet");
let lastVarValues = {};  // lower-case variable name -> rendered value, for autocomplete

// --- Docs Panel ---
const EXAMPLES = {
  basics: "2 + 3\n10 * (4 + 6)\n2 ^ 10\n17 % 5",
  variables: "price = 100\nqty = 3\ntotal = price * qty\n\ntax_rate = 22%\ntax = total * tax_rate\nafter_tax = total - tax",
  totals: "# Groceries\n\nbread 3.50\nmilk 2 * 1.20\neggs 4.95\nsum()\n\n# A heading starts a new total\n\n100\n200\nsubtotal = sum()\nsubtotal * 2",
  pct: "50% of 300\n200 + 15%\n200 - 10%",
  units: "5 km in miles\n100 C in F\n1 gib in mib\n60 min in hr\n1 gal in l",
  funcs: "sqrt(16)\nround(3.14159, 2)\nmin(5, 2, 8)\nmax(1, 9, 3)\nlog10(1000)",
  fmt: "1000000\n\n@format = fixed(2)\n1000000\n\n@format = scientific\n1000000\n\n@format = eng\n1000000\n\n@separator = comma\n@format = minSig(3)\n1000000",
  dates: "date()\nnow()\ndate() + 2 weeks\n\n# Deadline\ndeadline = 2026-12-31\ndays until deadline\n\n# Date math\n2025-01-31 + 1 month\n2025-03-01 - 2025-01-01\n\n# Times\nnow() + 3 hours\n2025-01-15 18:00 - 2025-01-15 09:00",
  rates: "@rate USD/EUR = 0.92\n100 USD in EUR\n50 EUR in USD\n\n@rate BTC/USD = 97500\n0.5 BTC in USD",
};

function toggleDocs() {
  const show = cheatsheet.hidden;
  cheatsheet.hidden = !show;
  docsBtn.innerHTML = show ? "Docs &#x25B4;" : "Docs &#x25BE;";
  try { localStorage.setItem("calced-docs", show ? "1" : "0"); } catch(e) {}
}

function tryExample(key) {
  const text = EXAMPLES[key];
  if (!text) return;
  if (input.value.trim() && !confirm("Replace editor content with example?")) return;
  input.value = text;
  render();
  cheatsheet.hidden = true;
  docsBtn.innerHTML = "Docs &#x25BE;";
  try { localStorage.setItem("calced-docs", "0"); } catch(e) {}
  input.focus();
}

docsBtn.addEventListener("click", toggleDocs);
cheatsheet.addEventListener("click", (e) => {
  const el = e.target.closest("[data-example]");
  if (el) tryExample(el.dataset.example);
});

try {
  if (localStorage.getItem("calced-docs") === "1") {
    cheatsheet.hidden = false;
    docsBtn.innerHTML = "Docs &#x25B4;";
  }
} catch(e) {}

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
  scheduleHashUpdate();
  try { localStorage.setItem("calced-input", text); } catch(e) {}
  const heading = lines.find(l => l.trim().startsWith("#"));
  document.title = heading ? heading.replace(/^#+ */, "").trim() + " - calced" : "calced";
}

input.addEventListener("input", render);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !cheatsheet.hidden) toggleDocs(); });

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

// --- URL Hash Encoding ---
let hashTimer = null;
function scheduleHashUpdate() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => updateHash(), 300);
}

async function compressText(text) {
  if (typeof CompressionStream === "undefined") {
    return "b64." + btoa(unescape(encodeURIComponent(text)));
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decompressText(hash) {
  if (hash.startsWith("b64.")) {
    return decodeURIComponent(escape(atob(hash.slice(4))));
  }
  const binary = atob(hash.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (typeof DecompressionStream === "undefined") {
    return decodeURIComponent(escape(atob(hash)));
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

async function updateHash() {
  const text = input.value;
  if (!text) { history.replaceState(null, "", location.pathname); return; }
  const encoded = await compressText(text);
  history.replaceState(null, "", "#" + encoded);
}

async function loadFromHash() {
  const hash = location.hash.slice(1);
  if (!hash) return false;
  if (hash === "new") {
    history.replaceState(null, "", location.pathname);
    return true;
  }
  try {
    input.value = await decompressText(hash);
    render();
  } catch (e) {
    console.error("Failed to decode URL hash:", e);
  }
  return true;
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

function downloadFile() {
  const text = input.value;
  if (!text.trim()) return;
  const content = formatForFile(text);
  const blob = new Blob([content + "\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const heading = text.split("\n").find(l => l.trim().startsWith("#"));
  a.download = (heading ? heading.replace(/^#+ */, "").trim() : "calced") + ".txt";
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

function shareURL() {
  navigator.clipboard.writeText(location.href).then(() => {
    shareBtn.textContent = "Link copied!";
    shareBtn.classList.add("copied");
    setTimeout(() => { shareBtn.textContent = "Share"; shareBtn.classList.remove("copied"); }, 1500);
  });
}

shareBtn.addEventListener("click", shareURL);
document.getElementById("download-btn").addEventListener("click", downloadFile);

const WELCOME = `Write math anywhere. Results appear on the right.

# Monthly Budget

rent 1500
groceries 200 + 150
utilities 80 + 45
sum()

# Variables and percentages

income = 5000
tax = income * 22%
after_tax = income - tax

# Unit conversions

5 km in miles
100 C in F

Try editing these lines, or click New for a blank sheet.
Click Docs for more features (functions, formatting, etc.)
`;

loadFromHash().then((hadHash) => {
  if (!input.value && !hadHash) {
    try {
      const saved = localStorage.getItem("calced-input");
      if (saved) { input.value = saved; render(); }
      else if (saved === null) { input.value = WELCOME; render(); }
    } catch(e) {}
  }
});
