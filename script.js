// script.js (ES module)

// --- Firebase: import from the CDN (no npm needed)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, onSnapshot,
  deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';

// --- Your Firebase config (safe to commit; rules protect data)
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
let form, input, list;
let key, username;

async function deriveKey(passphrase) {
  const enc = new TextEncoder();
  const salt = enc.encode('shared-salt'); // TODO: production: use a random per-space salt

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
    b64ToBuf(cipher) // Uint8Array is fine here
  );
  return dec.decode(plain);
}

// --- Firestore-backed UI
function startRealtimeNotes() {


  const q = query(collection(db, 'notes'), orderBy('createdAt', 'desc'));
  onSnapshot(q, async (snap) => {
    list.innerHTML = '';
    for (const docSnap of snap.docs) {
      const { cipher, iv, username: noteUser } = docSnap.data();
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
            const { cipher: newCipher, iv: newIv } = await encrypt(trimmed);
            await updateDoc(doc(db, 'notes', docSnap.id), { cipher: newCipher, iv: newIv });
          } catch (err) {
            console.error('Failed to edit note', err);
          }
        });
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'notes', docSnap.id));
        });
        li.appendChild(edit);
        li.appendChild(del);
        list.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable note', err);
      }
    }
  });
}

function bindForm() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const encrypted = await encrypt(text);
    await addDoc(collection(db, 'notes'), { ...encrypted, username });
    input.value = '';
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  form = document.getElementById('note-form');
  input = document.getElementById('note-input');
  list = document.getElementById('notes-list');
  bindForm();
  try {
    await signInAnonymously(auth); // gives a uid for security rules
  } catch (err) {
    console.error('Failed to sign in anonymously', err);
    return;
  }


  username = (prompt('Enter username') || '').trim();
  if (!username) return;

  const pass = prompt('Enter shared passphrase');
  if (!pass) return;
  try {
    key = await deriveKey(pass);
  } catch (err) {
    console.error('Failed to derive key', err);
    return;
  }

  startRealtimeNotes();
});


