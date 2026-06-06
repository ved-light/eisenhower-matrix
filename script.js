/* ==============================================
   EISENHOWER MATRIX — app.js
   Sync: QR code + URL hash (base64 encoded)
   Storage: localStorage (per-device persistence)
=============================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAajRR-Q8DchWUUflz31If1K-SMWU9uG8w",
  authDomain: "eisenhower-18432.firebaseapp.com",
  projectId: "eisenhower-18432",
  storageBucket: "eisenhower-18432.firebasestorage.app",
  messagingSenderId: "1030494950365",
  appId: "1:1030494950365:web:478b5b310983c696b99c34"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const matrixRef = doc(db, "tasks", "matrix");
const SYNC_PARAM  = 'sync';

const QUADRANTS = [
  { id: 'do',        color: '#ef4444' },
  { id: 'schedule',  color: '#3b82f6' },
  { id: 'delegate',  color: '#f59e0b' },
  { id: 'eliminate', color: '#6b7280' },
];

// ── State ──────────────────────────────────────
let tasks = { do: [], schedule: [], delegate: [], eliminate: [] };
let pendingImport = null;   // tasks decoded from URL, waiting for user confirmation
let saveTimer    = null;
let badgeTimer   = null;

// ── Encode / Decode ────────────────────────────
function encodeTasks(t) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(t))));
}

function decodeTasks(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}

// ── Local Storage ──────────────────────────────
async function loadTasks() {
  try {
    const snap = await getDoc(matrixRef);

    if (snap.exists()) {
      const data = snap.data();

      tasks = data.tasks || {
        do: [],
        schedule: [],
        delegate: [],
        eliminate: []
      };
    }

    renderAll();

  } catch (err) {
    console.error(err);
  }
}

async function saveTasks() {
  try {

    await setDoc(matrixRef, {
      tasks,
      updatedAt: Date.now()
    });

    showSavedBadge();

  } catch (err) {
    console.error(err);
  }
}

// ── Saved badge ────────────────────────────────
function showSavedBadge() {
  const badge = document.getElementById('savedBadge');
  badge.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => badge.classList.remove('show'), 1600);
}

// ── URL Sync: check on load ────────────────────
function checkUrlForSync() {
  const hash   = window.location.hash;   // #sync=<data>
  const search = window.location.search; // ?sync=<data>
  let encoded  = null;

  const hashMatch = hash.match(/[#&]sync=([^&]+)/);
  if (hashMatch) encoded = hashMatch[1];

  if (!encoded) {
    const searchMatch = search.match(/[?&]sync=([^&]+)/);
    if (searchMatch) encoded = searchMatch[1];
  }

  if (!encoded) return;

  try {
    const decoded = decodeTasks(encoded);
    pendingImport = decoded;
    showImportBanner();
    // Clean URL without reloading
    const clean = window.location.href
      .replace(/[?&]sync=[^&]+/, '')
      .replace(/#sync=[^&]+/, '')
      .replace(/[?#]$/, '');
    history.replaceState(null, '', clean);
  } catch (e) {
    console.warn('Could not decode sync URL:', e);
  }
}

// ── Import Banner ──────────────────────────────
function showImportBanner() {
  document.getElementById('importBanner').classList.add('visible');
}

function dismissImport() {
  document.getElementById('importBanner').classList.remove('visible');
  pendingImport = null;
}

// Called by HTML buttons
function importTasks(mode) {
  if (!pendingImport) return;

  if (mode === 'replace') {
    tasks = { do: [], schedule: [], delegate: [], eliminate: [] };
    ['do', 'schedule', 'delegate', 'eliminate'].forEach(q => {
      if (Array.isArray(pendingImport[q])) tasks[q] = pendingImport[q];
    });
  } else {
    // Merge: append tasks that don't already exist (match by text)
    ['do', 'schedule', 'delegate', 'eliminate'].forEach(q => {
      if (!Array.isArray(pendingImport[q])) return;
      const existingTexts = new Set(tasks[q].map(t => t.text.toLowerCase()));
      pendingImport[q].forEach(t => {
        if (!existingTexts.has(t.text.toLowerCase())) {
          tasks[q].push({ id: Date.now() + Math.random(), text: t.text, done: t.done });
        }
      });
    });
  }

  renderAll();
  saveTasks();
  dismissImport();
}

// ── Sync Modal ─────────────────────────────────
function openSyncModal() {
  // Build sync URL
  const encoded = encodeTasks(tasks);
  const base    = window.location.href.split('#')[0].split('?')[0];
  const syncUrl = base + '#sync=' + encoded;

  document.getElementById('syncUrlInput').value = syncUrl;

  // Generate QR code
  const wrap = document.getElementById('qrWrap');
  wrap.innerHTML = '';
  new QRCode(wrap, {
    text:          syncUrl,
    width:         152,
    height:        152,
    colorDark:     '#000000',
    colorLight:    '#ffffff',
    correctLevel:  QRCode.CorrectLevel.M,
  });

  document.getElementById('modalBackdrop').classList.add('open');
  document.getElementById('syncModal').classList.add('open');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.getElementById('syncModal').classList.remove('open');
}

function copyUrl() {
  const input = document.getElementById('syncUrlInput');
  const btn   = document.getElementById('copyBtn');

  navigator.clipboard.writeText(input.value).then(() => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    // Fallback for non-HTTPS
    input.select();
    document.execCommand('copy');
    btn.textContent = '✓ Copied';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Render ─────────────────────────────────────
function renderAll() {
  QUADRANTS.forEach(q => renderQuadrant(q.id, q.color));
  updateProgress();
}

function renderQuadrant(qid, color) {
  const list  = document.getElementById('list-'  + qid);
  const count = document.getElementById('count-' + qid);
  const items = tasks[qid];

  count.textContent = items.length;
  list.innerHTML    = '';

  if (items.length === 0) {
    const hint = document.createElement('li');
    hint.className   = 'empty-hint';
    hint.textContent = '— empty —';
    list.appendChild(hint);
    return;
  }

  items.forEach(task => {
    const li = document.createElement('li');
    li.className  = 'task-item';
    li.dataset.id = task.id;

    // Checkbox
    const check = document.createElement('button');
    check.className = 'task-check' + (task.done ? ' checked' : '');
    check.style.setProperty('--check-color', color);
    check.setAttribute('aria-label', task.done ? 'Mark incomplete' : 'Mark complete');
    check.innerHTML = `
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M1 4l2 2 4-4" stroke="#0a0a0f" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    check.addEventListener('click', () => toggleTask(qid, task.id));

    // Text
    const span = document.createElement('span');
    span.className   = 'task-text' + (task.done ? ' done' : '');
    span.textContent = task.text;

    // Delete
    const del = document.createElement('button');
    del.className   = 'task-del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete task');
    del.addEventListener('click', () => deleteTask(qid, task.id));

    li.appendChild(check);
    li.appendChild(span);
    li.appendChild(del);
    list.appendChild(li);
  });
}

function updateProgress() {
  const all  = Object.values(tasks).flat();
  const done = all.filter(t => t.done).length;
  const pill = document.getElementById('progressPill');
  const text = document.getElementById('progressText');

  if (all.length === 0) {
    pill.style.display = 'none';
  } else {
    pill.style.display = '';
    text.textContent   = done + '/' + all.length + ' done';
  }
}

// ── Task Actions ───────────────────────────────
function addTask(qid) {
  const input = document.getElementById('input-' + qid);
  const text  = input.value.trim();
  if (!text) return;

  tasks[qid].push({ id: Date.now(), text, done: false });
  input.value = '';
  renderQuadrant(qid, getColor(qid));
  updateProgress();
  saveTasks();
}

function toggleTask(qid, id) {
  const task = tasks[qid].find(t => t.id === id);
  if (task) task.done = !task.done;
  renderQuadrant(qid, getColor(qid));
  updateProgress();
  saveTasks();
}

function deleteTask(qid, id) {
  tasks[qid] = tasks[qid].filter(t => t.id !== id);
  renderQuadrant(qid, getColor(qid));
  updateProgress();
  saveTasks();
}

function getColor(qid) {
  return QUADRANTS.find(q => q.id === qid)?.color || '#64748b';
}

// ── Input bindings ─────────────────────────────
function bindInputs() {
  QUADRANTS.forEach(q => {
    const input = document.getElementById('input-' + q.id);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') addTask(q.id);
    });
    input.style.caretColor = q.color;
  });
}

// ── Init ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  bindInputs();

  await loadTasks();

  checkUrlForSync();

  onSnapshot(matrixRef, snap => {

    if (!snap.exists()) return;

    const data = snap.data();

    tasks = data.tasks || {
      do: [],
      schedule: [],
      delegate: [],
      eliminate: []
    };

    renderAll();

  });

});