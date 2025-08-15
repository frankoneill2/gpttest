// case.js (ES module)

// --- Firebase imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
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
  measurementId: "G-6NZEC4ED4C"
};

// --- Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- DOM + crypto helpers
let form, descInput, noteInput, list;
let key, caseId;

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

async function encrypt(text) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { cipher: bufToB64(cipher), iv: Array.from(iv), createdAt: serverTimestamp() };
}

async function decrypt(cipher, iv) {
  const dec = new TextDecoder();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    b64ToBuf(cipher)
  );
  return dec.decode(plain);
}

// --- Firestore-backed UI
function startRealtimeTasks() {
  const tasksRef = collection(db, 'cases', caseId, 'tasks');
  const q = query(tasksRef, orderBy('status'), orderBy('createdAt'));
  onSnapshot(q, async (snap) => {
    list.innerHTML = '';
    for (const taskSnap of snap.docs) {
      const { descCipher, descIv, taskNote, status } = taskSnap.data();
      let desc, noteText = '';
      try {
        desc = await decrypt(descCipher, descIv);
        if (taskNote) {
          noteText = await decrypt(taskNote.cipher, taskNote.iv);
        }
      } catch (err) {
        console.error('Skipping undecryptable task', err);
        continue;
      }
      const li = document.createElement('li');
      li.textContent = desc + ' ';

      const select = document.createElement('select');
      ['todo', 'doing', 'done'].forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === status) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        updateDoc(doc(tasksRef, taskSnap.id), { status: select.value });
      });
      li.appendChild(select);

      const edit = document.createElement('button');
      edit.textContent = 'Edit note';
      edit.addEventListener('click', async () => {
        try {
          const newNote = prompt('Edit note', noteText);
          if (newNote === null) return;
          const trimmed = newNote.trim();
          if (!trimmed) return;
          const enc = await encrypt(trimmed);
          await updateDoc(doc(tasksRef, taskSnap.id), { taskNote: { cipher: enc.cipher, iv: enc.iv } });
        } catch (err) {
          console.error('Failed to edit note', err);
        }
      });
      li.appendChild(edit);

      list.appendChild(li);
    }
  });
}

function bindForm() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const desc = descInput.value.trim();
    const note = noteInput.value.trim();
    if (!desc) return;
    const encDesc = await encrypt(desc);
    const docData = {
      descCipher: encDesc.cipher,
      descIv: encDesc.iv,
      status: 'todo',
      createdAt: serverTimestamp()
    };
    if (note) {
      const encNote = await encrypt(note);
      docData.taskNote = { cipher: encNote.cipher, iv: encNote.iv };
    }
    await addDoc(collection(db, 'cases', caseId, 'tasks'), docData);
    descInput.value = '';
    noteInput.value = '';
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  form = document.getElementById('task-form');
  descInput = document.getElementById('task-desc');
  noteInput = document.getElementById('task-note');
  list = document.getElementById('tasks-list');
  bindForm();
  try {
    await signInAnonymously(auth);
  } catch (err) {
    console.error('Failed to sign in anonymously', err);
    return;
  }
  const pass = prompt('Enter shared passphrase');
  if (!pass) return;
  key = await deriveKey(pass);
  caseId = new URLSearchParams(location.search).get('caseId');
  if (!caseId) {
    console.error('No caseId provided in URL');
    return;
  }
  startRealtimeTasks();
});

