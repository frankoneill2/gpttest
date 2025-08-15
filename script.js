// script.js (ES module)

// --- Firebase: import from the CDN (no npm needed)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, onSnapshot,
  deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';

// --- Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBo5a6Uxk1vJwS8WqFnccjSnNOOXreOhcg",
  authDomain: "catalist-1.firebaseapp.com",
  projectId: "catalist-1",
  storageBucket: "catalist-1.firebasestorage.app",
  messagingSenderId: "843924921323",
  appId: "1:843924921323:web:0e7a847f8cd70db55f57ae",
  measurementId: "G-6NZEC4ED4C",
};

// --- Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- State and DOM refs
let key, username;
let caseListEl, caseForm, caseInput;
let caseDetailEl, caseTitleEl, backBtn;
let taskForm, taskInput, taskStatus, taskListEl;
let noteForm, noteInput, notesListEl;
let currentCaseId = null;
let unsubTasks = null;
let unsubNotes = null;

// --- Crypto helpers
async function deriveKey(passphrase) {
  const enc = new TextEncoder();
  const salt = enc.encode('shared-salt');
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

async function encryptText(text) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { cipher: bufToB64(cipher), iv: Array.from(iv) };
}

async function decryptText(cipher, iv) {
  const dec = new TextDecoder();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    b64ToBuf(cipher)
  );
  return dec.decode(plain);
}

// --- UI helpers
function showCaseList() {
  caseDetailEl.hidden = true;
  caseListEl.style.display = 'block';
  currentCaseId = null;
  if (unsubTasks) { unsubTasks(); unsubTasks = null; }
  if (unsubNotes) { unsubNotes(); unsubNotes = null; }
}

async function openCase(id, title) {
  currentCaseId = id;
  caseTitleEl.textContent = title;
  caseListEl.style.display = 'none';
  caseDetailEl.hidden = false;
  startRealtimeTasks(id);
  startRealtimeNotes(id);
}

// --- Firestore listeners
function startRealtimeCases() {
  const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'));
  onSnapshot(q, async snap => {
    caseListEl.innerHTML = '';
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      try {
        const title = await decryptText(data.titleCipher, data.titleIv);
        const li = document.createElement('li');
        li.textContent = title;
        li.addEventListener('click', () => openCase(docSnap.id, title));
        caseListEl.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable case', err);
      }
    }
  });
}

function startRealtimeTasks(caseId) {
  const q = query(collection(db, 'cases', caseId, 'tasks'), orderBy('createdAt', 'desc'));
  if (unsubTasks) unsubTasks();
  unsubTasks = onSnapshot(q, async snap => {
    taskListEl.innerHTML = '';
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      try {
        const text = await decryptText(data.textCipher, data.textIv);
        const status = await decryptText(data.statusCipher, data.statusIv);
        const li = document.createElement('li');
        li.className = 'task-item';
        li.dataset.status = status;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'task-title';
        titleSpan.textContent = text;
        li.appendChild(titleSpan);

        const actions = document.createElement('div');
        actions.className = 'task-actions';
        li.appendChild(actions);

        const select = document.createElement('select');
        select.className = 'status-select';
        ['open','in progress','complete'].forEach(s => {
          const opt = document.createElement('option');
          opt.value = s; opt.textContent = s; select.appendChild(opt);
        });
        select.value = status;
        select.dataset.status = status;
        select.addEventListener('change', async () => {
          const { cipher, iv } = await encryptText(select.value);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { statusCipher: cipher, statusIv: iv });
          select.dataset.status = select.value;
          li.dataset.status = select.value;
        });
        actions.appendChild(select);

        const del = document.createElement('button');
        del.className = 'icon-btn delete-btn';
        del.textContent = '🗑';
        del.setAttribute('aria-label', 'Delete task');
        del.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id));
        });
        actions.appendChild(del);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'icon-btn comment-toggle';
        toggle.textContent = '💬';
        toggle.setAttribute('aria-label', 'Show comments');
        actions.appendChild(toggle);

        // comments section
        const commentSection = document.createElement('div');
        commentSection.className = 'comment-section';
        commentSection.hidden = true;

        const commentsList = document.createElement('ul');
        commentsList.className = 'comments';
        commentSection.appendChild(commentsList);

        const commentForm = document.createElement('form');
        commentForm.className = 'comment-form';
        const commentInput = document.createElement('input');
        commentInput.placeholder = 'Add comment';
        commentForm.appendChild(commentInput);
        const commentBtn = document.createElement('button');
        commentBtn.className = 'icon-btn add-comment-btn';
        commentBtn.type = 'submit';
        commentBtn.textContent = '➕';
        commentBtn.setAttribute('aria-label', 'Add comment');
        commentForm.appendChild(commentBtn);
        commentForm.addEventListener('submit', async e => {
          e.preventDefault();
          const text = commentInput.value.trim();
          if (!text) return;
          const { cipher, iv } = await encryptText(text);
          await addDoc(collection(db, 'cases', caseId, 'tasks', docSnap.id, 'comments'), {
            cipher, iv, username, createdAt: serverTimestamp(),
          });
          commentInput.value = '';
        });
        commentSection.appendChild(commentForm);
        li.appendChild(commentSection);

        let commentsLoaded = false;
        toggle.addEventListener('click', () => {
          const hidden = commentSection.hidden;
          commentSection.hidden = !hidden;
          toggle.textContent = hidden ? '✖' : '💬';
          toggle.setAttribute('aria-label', hidden ? 'Hide comments' : 'Show comments');
          if (hidden && !commentsLoaded) {
            startRealtimeComments(caseId, docSnap.id, commentsList);
            commentsLoaded = true;
          }
        });

        taskListEl.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable task', err);
      }
    }
  });
}

function startRealtimeComments(caseId, taskId, listEl) {
  const q = collection(db, 'cases', caseId, 'tasks', taskId, 'comments');
  onSnapshot(q, async snap => {
    const docs = snap.docs
      .map(s => ({ id: s.id, ...s.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    listEl.innerHTML = '';
    for (const { cipher, iv, username: user } of docs) {
      try {
        const text = await decryptText(cipher, iv);
        const li = document.createElement('li');
        li.textContent = user ? `${user}: ${text}` : text;
        listEl.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable comment', err);
      }
    }
  }, err => console.error('Comments listener error', err));
}

function startRealtimeNotes(caseId) {
  const q = query(collection(db, 'cases', caseId, 'notes'), orderBy('createdAt', 'desc'));
  if (unsubNotes) unsubNotes();
  unsubNotes = onSnapshot(q, async snap => {
    notesListEl.innerHTML = '';
    for (const docSnap of snap.docs) {
      const { cipher, iv, username: noteUser } = docSnap.data();
      try {
        const text = await decryptText(cipher, iv);
        const li = document.createElement('li');
        li.textContent = noteUser ? `${noteUser}: ${text}` : text;
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'cases', caseId, 'notes', docSnap.id));
        });
        li.appendChild(del);
        notesListEl.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable note', err);
      }
    }
  });
}

// --- Form bindings
function bindCaseForm() {
  caseForm.addEventListener('submit', async e => {
    e.preventDefault();
    const title = caseInput.value.trim();
    if (!title) return;
    const { cipher, iv } = await encryptText(title);
    await addDoc(collection(db, 'cases'), {
      titleCipher: cipher,
      titleIv: iv,
      createdAt: serverTimestamp(),
      username,
    });
    caseInput.value = '';
  });
}

function bindTaskForm() {
  taskStatus.addEventListener('change', () => {
    taskStatus.dataset.status = taskStatus.value;
  });

  taskForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentCaseId) return;
    const text = taskInput.value.trim();
    const statusVal = taskStatus.value;
    if (!text) return;
    const { cipher: textCipher, iv: textIv } = await encryptText(text);
    const { cipher: statusCipher, iv: statusIv } = await encryptText(statusVal);
    await addDoc(collection(db, 'cases', currentCaseId, 'tasks'), {
      textCipher, textIv, statusCipher, statusIv, createdAt: serverTimestamp(), username,
    });
    taskInput.value = '';
    taskStatus.value = 'open';
    taskStatus.dataset.status = 'open';
  });
}

function bindNoteForm() {
  noteForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentCaseId) return;
    const text = noteInput.value.trim();
    if (!text) return;
    const { cipher, iv } = await encryptText(text);
    await addDoc(collection(db, 'cases', currentCaseId, 'notes'), {
      cipher, iv, username, createdAt: serverTimestamp(),
    });
    noteInput.value = '';
  });
}

// --- Init on load
window.addEventListener('DOMContentLoaded', async () => {
  caseListEl = document.getElementById('case-list');
  caseForm = document.getElementById('case-form');
  caseInput = document.getElementById('case-input');
  caseDetailEl = document.getElementById('case-detail');
  caseTitleEl = document.getElementById('case-title');
  backBtn = document.getElementById('back-btn');
  taskForm = document.getElementById('task-form');
  taskInput = document.getElementById('task-input');
  taskStatus = document.getElementById('task-status');
  taskListEl = document.getElementById('task-list');
  noteForm = document.getElementById('note-form');
  noteInput = document.getElementById('note-input');
  notesListEl = document.getElementById('notes-list');

  bindCaseForm();
  bindTaskForm();
  bindNoteForm();
  backBtn.addEventListener('click', showCaseList);

  try {
    await signInAnonymously(auth);
  } catch (err) {
    console.error('Failed to sign in anonymously', err);
    return;
  }
  username = (prompt('Enter username') || '').trim();
  if (!username) return;
  const pass = prompt('Enter shared passphrase');
  if (!pass) return;
  key = await deriveKey(pass);
  startRealtimeCases();
});

