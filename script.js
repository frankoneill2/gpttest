const form = document.getElementById('note-form');
const input = document.getElementById('note-input');
const list = document.getElementById('notes-list');
let key;

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

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function encrypt(text) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { cipher: bufToB64(cipher), iv: Array.from(iv) };
}

async function decrypt(cipher, iv) {
  const dec = new TextDecoder();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, b64ToBuf(cipher));
  return dec.decode(plain);
}

async function loadNotes() {
  const res = await fetch('/notes');
  const encryptedNotes = await res.json();
  list.innerHTML = '';
  for (const [index, { cipher, iv }] of encryptedNotes.entries()) {
    const text = await decrypt(cipher, iv);
    const li = document.createElement('li');
    li.textContent = text;
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await fetch('/notes/' + index, { method: 'DELETE' });
      loadNotes();
    });
    li.appendChild(del);
    list.appendChild(li);
  }
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const encrypted = await encrypt(text);
  await fetch('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encrypted)
  });
  input.value = '';
  loadNotes();
});

window.addEventListener('DOMContentLoaded', async () => {
  const pass = prompt('Enter shared passphrase');
  key = await deriveKey(pass);
  loadNotes();
});
