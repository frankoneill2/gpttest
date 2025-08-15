// cases.js - main client logic for case and task management with E2EE
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import { deriveKey, setKey, encrypt, decrypt } from './crypto.js';

// --- Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBo5a6Uxk1vJwS8WqFnccjSnNOOXreOhcg",
  authDomain: "catalist-1.firebaseapp.com",
  projectId: "catalist-1",
  storageBucket: "catalist-1.firebasestorage.app",
  messagingSenderId: "843924921323",
  appId: "1:843924921323:web:0e7a847f8cd70db55f57ae",
  measurementId: "G-6NZEC4ED4C"
};

// --- Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- DOM refs
let caseForm, caseInput, casesList;
let detail, detailTitle;
let taskForm, taskInput, taskStatus, taskNote, tasksList;
let noteForm, noteInput, notesList;
let currentCaseId, username;

// --- Realtime task view
function startRealtimeTasks() {
  const q = query(collection(db, 'cases', currentCaseId, 'tasks'), orderBy('createdAt', 'desc'));
  onSnapshot(q, async snap => {
    tasksList.innerHTML = '';
    for (const taskSnap of snap.docs) {
      const { descCipher, descIv, noteCipher, noteIv, status = 'open', username: taskUser } = taskSnap.data();
      try {
        const desc = await decrypt(descCipher, descIv);
        let noteText = '';
        if (noteCipher && noteIv) {
          noteText = await decrypt(noteCipher, noteIv);
        }
        const li = document.createElement('li');
        li.textContent = `${taskUser ? taskUser + ': ' : ''}${desc} [${status}]`;
        if (noteText) li.textContent += ` - ${noteText}`;

        const select = document.createElement('select');
        ['open', 'in-progress', 'done'].forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          if (s === status) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener('change', async () => {
          await updateDoc(doc(db, 'cases', currentCaseId, 'tasks', taskSnap.id), { status: select.value });
        });
        li.appendChild(select);

        const editNote = document.createElement('button');
        editNote.textContent = 'Edit Note';
        editNote.addEventListener('click', async () => {
          try {
            const newText = prompt('Edit note', noteText);
            if (newText === null) return;
            const trimmed = newText.trim();
            if (!trimmed) return;
            const enc = await encrypt(trimmed);
            await updateDoc(doc(db, 'cases', currentCaseId, 'tasks', taskSnap.id), {
              noteCipher: enc.cipher,
              noteIv: enc.iv
            });
          } catch (err) {
            console.error('Failed to edit task note', err);
          }
        });
        li.appendChild(editNote);

        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'cases', currentCaseId, 'tasks', taskSnap.id));
        });
        li.appendChild(del);

        tasksList.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable task', err);
      }
    }
  });
}

// --- Realtime case notes
function startRealtimeNotes() {
  const q = query(collection(db, 'cases', currentCaseId, 'notes'), orderBy('createdAt', 'desc'));
  onSnapshot(q, async snap => {
    notesList.innerHTML = '';
    for (const noteSnap of snap.docs) {
      const { cipher, iv, username: noteUser } = noteSnap.data();
      try {
        const text = await decrypt(cipher, iv);
        const li = document.createElement('li');
        li.textContent = noteUser ? `${noteUser}: ${text}` : text;

        const edit = document.createElement('button');
        edit.textContent = 'Edit';
        edit.addEventListener('click', async () => {
          try {
            const newText = prompt('Edit note', text);
            if (newText === null) return;
            const trimmed = newText.trim();
            if (!trimmed) return;
            const enc = await encrypt(trimmed);
            await updateDoc(doc(db, 'cases', currentCaseId, 'notes', noteSnap.id), {
              cipher: enc.cipher,
              iv: enc.iv
            });
          } catch (err) {
            console.error('Failed to edit note', err);
          }
        });
        li.appendChild(edit);

        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'cases', currentCaseId, 'notes', noteSnap.id));
        });
        li.appendChild(del);

        notesList.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable note', err);
      }
    }
  });
}

// --- Form bindings
function bindTaskForm() {
  taskForm.addEventListener('submit', async e => {
    e.preventDefault();
    const text = taskInput.value.trim();
    if (!text) return;
    const noteText = taskNote.value.trim();
    const status = taskStatus.value || 'open';
    const encDesc = await encrypt(text);
    const docData = {
      descCipher: encDesc.cipher,
      descIv: encDesc.iv,
      status,
      username,
      createdAt: serverTimestamp()
    };
    if (noteText) {
      const encNote = await encrypt(noteText);
      docData.noteCipher = encNote.cipher;
      docData.noteIv = encNote.iv;
    }
    await addDoc(collection(db, 'cases', currentCaseId, 'tasks'), docData);
    taskInput.value = '';
    taskNote.value = '';
    taskStatus.value = 'open';
  });
}

function bindNoteForm() {
  noteForm.addEventListener('submit', async e => {
    e.preventDefault();
    const text = noteInput.value.trim();
    if (!text) return;
    const enc = await encrypt(text);
    await addDoc(collection(db, 'cases', currentCaseId, 'notes'), {
      ...enc,
      username,
      createdAt: serverTimestamp()
    });
    noteInput.value = '';
  });
}

function showCase(id, title) {
  currentCaseId = id;
  detailTitle.textContent = title;
  detail.style.display = 'block';
  startRealtimeTasks();
  startRealtimeNotes();
}

// --- Bootstrap
async function init() {
  caseForm = document.getElementById('case-form');
  caseInput = document.getElementById('case-input');
  casesList = document.getElementById('cases-list');
  detail = document.getElementById('case-detail');
  detailTitle = document.getElementById('case-title');
  taskForm = document.getElementById('task-form');
  taskInput = document.getElementById('task-input');
  taskStatus = document.getElementById('task-status');
  taskNote = document.getElementById('task-note');
  tasksList = document.getElementById('tasks-list');
  noteForm = document.getElementById('note-form');
  noteInput = document.getElementById('note-input');
  notesList = document.getElementById('case-notes-list');

  bindTaskForm();
  bindNoteForm();

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
  const derived = await deriveKey(pass);
  setKey(derived);

  caseForm.addEventListener('submit', async e => {
    e.preventDefault();
    const title = caseInput.value.trim();
    if (!title) return;
    await addDoc(collection(db, 'cases'), { title, createdAt: serverTimestamp() });
    caseInput.value = '';
  });

  const casesQ = query(collection(db, 'cases'), orderBy('createdAt', 'desc'));
  onSnapshot(casesQ, snap => {
    casesList.innerHTML = '';
    snap.forEach(docSnap => {
      const { title } = docSnap.data();
      const li = document.createElement('li');
      li.textContent = title;
      li.addEventListener('click', () => showCase(docSnap.id, title));
      casesList.appendChild(li);
    });
  });
}

window.addEventListener('DOMContentLoaded', init);

