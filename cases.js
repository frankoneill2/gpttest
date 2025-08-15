// cases.js - manage cases with tasks and notes
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBo5a6Uxk1vJwS8WqFnccjSnNOOXreOhcg",
  authDomain: "catalist-1.firebaseapp.com",
  projectId: "catalist-1",
  storageBucket: "catalist-1.firebasestorage.app",
  messagingSenderId: "843924921323",
  appId: "1:843924921323:web:0e7a847f8cd70db55f57ae",
  measurementId: "G-6NZEC4ED4C"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let caseForm, caseInput, casesList, detail, detailTitle, tasksList, notesList;

function showCase(id, title) {
  detailTitle.textContent = title;
  detail.style.display = 'block';

  const tasksQ = query(collection(db, 'cases', id, 'tasks'), orderBy('createdAt', 'desc'));
  onSnapshot(tasksQ, snap => {
    tasksList.innerHTML = '';
    snap.forEach(docSnap => {
      const li = document.createElement('li');
      li.textContent = docSnap.data().text || '';
      tasksList.appendChild(li);
    });
  });

  const notesQ = query(collection(db, 'cases', id, 'notes'), orderBy('createdAt', 'desc'));
  onSnapshot(notesQ, snap => {
    notesList.innerHTML = '';
    snap.forEach(docSnap => {
      const li = document.createElement('li');
      li.textContent = docSnap.data().text || '';
      notesList.appendChild(li);
    });
  });
}

async function init() {
  caseForm = document.getElementById('case-form');
  caseInput = document.getElementById('case-input');
  casesList = document.getElementById('cases-list');
  detail = document.getElementById('case-detail');
  detailTitle = document.getElementById('case-title');
  tasksList = document.getElementById('tasks-list');
  notesList = document.getElementById('case-notes-list');

  try {
    await signInAnonymously(auth);
  } catch (err) {
    console.error('Failed to sign in anonymously', err);
    return;
  }

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
