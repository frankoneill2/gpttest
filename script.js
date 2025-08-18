// script.js (ES module)

// --- Firebase: import from the CDN (no npm needed)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, onSnapshot,
  deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp, getDocs, setDoc, collectionGroup, where, getDoc
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
let caseListSection, caseListEl, caseForm, caseInput;
let caseDetailEl, caseTitleEl, backBtn;
let taskForm, taskInput, taskListEl;
let noteForm, noteInput, notesListEl;
let tabTasksBtn, tabNotesBtn;
let userDetailEl, userTitleEl, userTaskListEl, userBackBtn;
let brandHome;
let currentCaseId = null;
let backTarget = 'list'; // 'list' or 'user'
let currentUserPageName = null;
let unsubTasks = null;
let unsubNotes = null;
let unsubUsers = null;
let usersCache = [];
let unsubUserTasks = [];
// User page state for rendering/filtering
let userPerCase = new Map(); // caseId -> [{ taskId, text, status }]
let userCaseTitles = new Map(); // caseId -> title
let currentUserFilter = 'all';
let userFilterEl;
let userFilterByName = new Map(); // username -> last filter

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
  userDetailEl.hidden = true;
  if (caseListSection) caseListSection.style.display = 'block';
  currentCaseId = null;
  if (unsubTasks) { unsubTasks(); unsubTasks = null; }
  if (unsubNotes) { unsubNotes(); unsubNotes = null; }
  if (unsubUsers) { unsubUsers(); unsubUsers = null; }
}

async function openCase(id, title, source = 'list') {
  currentCaseId = id;
  backTarget = source === 'user' ? 'user' : 'list';
  caseTitleEl.textContent = title;
  if (caseListSection) caseListSection.style.display = 'none';
  userDetailEl.hidden = true;
  caseDetailEl.hidden = false;
  startRealtimeTasks(id);
  startRealtimeNotes(id);
  // Show tasks tab by default on open
  showTab('tasks');
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
        li.className = 'case-item';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'case-title';
        titleSpan.textContent = title;
        li.appendChild(titleSpan);

        const actions = document.createElement('div');
        actions.className = 'case-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.textContent = '✏️';
        editBtn.setAttribute('aria-label', 'Edit case title');
        editBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newTitle = (prompt('Edit case title', title) || '').trim();
          if (!newTitle) return;
          const { cipher, iv } = await encryptText(newTitle);
          await updateDoc(doc(db, 'cases', docSnap.id), { titleCipher: cipher, titleIv: iv });
          if (currentCaseId === docSnap.id) caseTitleEl.textContent = newTitle;
          showToast('Case title updated');
        });
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn delete-btn';
        delBtn.textContent = '🗑';
        delBtn.setAttribute('aria-label', 'Delete case');
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this case and all its items?')) return;
          await deleteCaseDeep(docSnap.id);
          if (currentCaseId === docSnap.id) showCaseList();
          showToast('Case deleted');
        });
        actions.appendChild(delBtn);

        li.appendChild(actions);
        li.addEventListener('click', () => openCase(docSnap.id, title, 'list'));
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
  // Persist in-session order: set on first load; not reshuffled on status changes
  let taskOrder = null;
  unsubTasks = onSnapshot(q, async snap => {
    taskListEl.innerHTML = '';
    // Collect tasks with decrypted fields
    const items = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      try {
        const text = await decryptText(data.textCipher, data.textIv);
        const status = await decryptText(data.statusCipher, data.statusIv);
        const createdAt = (data.createdAt && data.createdAt.toMillis) ? data.createdAt.toMillis() : 0;
        items.push({ docSnap, data, text, status, createdAt });
      } catch (err) {
        console.error('Skipping undecryptable task', err);
      }
    }

    // Establish initial order by desired grouping, but keep it fixed during this session
    if (!taskOrder) {
      const orderVal = (s) => s === 'open' ? 0 : (s === 'in progress' ? 1 : 2);
      const init = [...items].sort((a, b) => {
        const byStatus = orderVal(a.status) - orderVal(b.status);
        if (byStatus !== 0) return byStatus;
        return b.createdAt - a.createdAt;
      });
      taskOrder = init.map(i => i.docSnap.id);
    } else {
      // Add any new tasks to the top without reordering existing ones
      for (const i of items) {
        const id = i.docSnap.id;
        if (!taskOrder.includes(id)) taskOrder.unshift(id);
      }
    }

    // Sort current items by the established in-session order
    const idx = new Map(taskOrder.map((id, i) => [id, i]));
    items.sort((a, b) => (idx.get(a.docSnap.id) ?? 999999) - (idx.get(b.docSnap.id) ?? 999999));

    for (const item of items) {
      const { docSnap, text, status, data } = item;
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.status = status;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'task-title';
      titleSpan.textContent = text;

        const taskMain = document.createElement('div');
        taskMain.className = 'task-main';

        const actions = document.createElement('div');
        actions.className = 'task-actions';
        li.appendChild(actions);


        // Status checkbox-style button to the left of the title
        const statusBtn = document.createElement('button');
        statusBtn.type = 'button';
        statusBtn.className = 'icon-btn task-status-btn';
        const statusIcon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
        const statusLabel = (s) => `Task status: ${s}`;
        statusBtn.textContent = statusIcon(status);
        statusBtn.setAttribute('aria-label', statusLabel(status));
        statusBtn.addEventListener('click', async () => {
          const order = ['open', 'in progress', 'complete'];
          const idx = order.indexOf(li.dataset.status || 'open');
          const next = order[(idx + 1) % order.length];
          const { cipher, iv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { statusCipher: cipher, statusIv: iv });
          li.dataset.status = next;
          statusBtn.textContent = statusIcon(next);
          statusBtn.setAttribute('aria-label', statusLabel(next));
        });
        taskMain.appendChild(statusBtn);
        taskMain.appendChild(titleSpan);
        li.appendChild(taskMain);


        const del = document.createElement('button');
        del.className = 'icon-btn delete-btn';
        del.textContent = '🗑';
        del.setAttribute('aria-label', 'Delete task');
        del.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id));
        });


        // Quick reassign button (popup select)
        const reBtn = document.createElement('button');
        reBtn.className = 'icon-btn';
        reBtn.textContent = '👤';
        reBtn.setAttribute('aria-label', 'Reassign task');
        reBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sel = document.createElement('select');
          sel.className = 'assignee-select';
          const none = document.createElement('option');
          none.value = '';
          none.textContent = 'Unassigned';
          sel.appendChild(none);
          for (const u of usersCache) {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.username;
            sel.appendChild(opt);
          }
          sel.value = (data.assignee || '');
          sel.addEventListener('change', async () => {
            await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { assignee: sel.value || null });
            sel.remove();
            showToast('Assignee updated');
          }, { once: true });
          const onDocClick = (ev) => {
            if (ev.target !== sel) {
              sel.remove();
              document.removeEventListener('click', onDocClick, true);
            }
          };
          document.addEventListener('click', onDocClick, true);
          actions.insertBefore(sel, reBtn.nextSibling);
          sel.focus();
        });
        actions.appendChild(reBtn);

        // Edit task button
        const edit = document.createElement('button');
        edit.className = 'icon-btn';
        edit.textContent = '✏️';
        edit.setAttribute('aria-label', 'Edit task');
        edit.addEventListener('click', async () => {
          const current = titleSpan.textContent;
          const next = (prompt('Edit task', current) || '').trim();
          if (!next || next === current) return;
          const { cipher: textCipher, iv: textIv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { textCipher, textIv });
          titleSpan.textContent = next;
          showToast('Task updated');
        });
        actions.appendChild(edit);

        actions.appendChild(del);

        const toggle = document.createElement('button');
        toggle.type = 'button';

        toggle.className = 'icon-btn comment-toggle';
        toggle.setAttribute('aria-label', 'Show comments');
        actions.appendChild(toggle);
        const commentCountEl = document.createElement('span');
        commentCountEl.className = 'badge comment-count';
        actions.appendChild(commentCountEl);

        // comments section (open by default)
        const commentSection = document.createElement('div');
        commentSection.className = 'comment-section';
        commentSection.hidden = false;

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
        // Optimistic render
        const tempLi = document.createElement('li');
        tempLi.className = 'optimistic';
        const tempSpan = document.createElement('span');
        tempSpan.textContent = username ? `${username}: ${text}` : text;
        tempLi.appendChild(tempSpan);
        commentsList.appendChild(tempLi);

          // Auto-expand immediately
          commentSection.hidden = false;
          // bump count immediately for snappy feedback
          commentCount += 1;
          updateToggleLabel();

          const shouldStartListener = !commentsLoaded;

          // Clear input right away for snappy UX
          commentInput.value = '';

          try {
            const { cipher, iv } = await encryptText(text);
            await addDoc(collection(db, 'cases', caseId, 'tasks', docSnap.id, 'comments'), {
              cipher, iv, username, createdAt: serverTimestamp(),
            });
            // Kick off realtime after write to avoid flicker
            if (shouldStartListener) {
              startRealtimeComments(caseId, docSnap.id, commentsList, (n) => { commentCount = n; updateToggleLabel(); });
              commentsLoaded = true;
            }
            showToast('Comment added');
          } catch (err) {
            // If write fails, mark the optimistic item as failed
            tempLi.classList.add('failed');
            // revert optimistic count bump
            commentCount = Math.max(0, commentCount - 1);
            updateToggleLabel();
            showToast('Failed to add comment');
            console.error('Failed to add comment', err);
          }
        });
        commentSection.appendChild(commentForm);
        li.appendChild(commentSection);


        let commentsLoaded = true;
        // Start comments immediately so they show by default
        startRealtimeComments(caseId, docSnap.id, commentsList, (n) => { commentCount = n; updateToggleLabel(); });
        let commentCount = 0;
        const updateToggleLabel = () => {
          const icon = commentSection.hidden ? '💬' : '✖';
          toggle.textContent = icon;
          commentCountEl.textContent = commentCount > 0 ? String(commentCount) : '';
          toggle.setAttribute('aria-label', commentSection.hidden ? 'Show comments' : 'Hide comments');
        };
        updateToggleLabel();

        toggle.addEventListener('click', () => {
          const hidden = commentSection.hidden;
          commentSection.hidden = !hidden;
          updateToggleLabel();

          if (hidden && !commentsLoaded) {
            startRealtimeComments(caseId, docSnap.id, commentsList, (n) => { commentCount = n; updateToggleLabel(); });
            commentsLoaded = true;
          }

        });

        taskListEl.appendChild(li);
    }
  });
}

function startRealtimeComments(caseId, taskId, listEl, onCount) {
  const q = query(collection(db, 'cases', caseId, 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc'));
  onSnapshot(q, async snap => {
    if (onCount) onCount(snap.size);
    listEl.innerHTML = '';
    for (const s of snap.docs) {
      const { cipher, iv, username: user } = s.data();
      try {
        const text = await decryptText(cipher, iv);
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = user ? `${user}: ${text}` : text;
        li.appendChild(span);

        const actions = document.createElement('div');
        actions.className = 'case-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.textContent = '✏️';
        editBtn.setAttribute('aria-label', 'Edit comment');
        editBtn.addEventListener('click', async () => {
          const current = text;
          const next = (prompt('Edit comment', current) || '').trim();
          if (!next) return;
          const { cipher, iv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId, 'comments', s.id), { cipher, iv });
          showToast('Comment updated');
        });
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn delete-btn';
        delBtn.textContent = '🗑';
        delBtn.setAttribute('aria-label', 'Delete comment');
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this comment?')) return;
          await deleteDoc(doc(db, 'cases', caseId, 'tasks', taskId, 'comments', s.id));
          showToast('Comment deleted');
        });
        actions.appendChild(delBtn);

        li.appendChild(actions);
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
function bindTabs() {
  tabTasksBtn.addEventListener('click', () => showTab('tasks'));
  tabNotesBtn.addEventListener('click', () => showTab('notes'));
}

function showTab(which) {
  const tasks = document.getElementById('tasks');
  const notes = document.getElementById('notes');
  const isTasks = which === 'tasks';
  tasks.hidden = !isTasks;
  notes.hidden = isTasks;
  tabTasksBtn.classList.toggle('active', isTasks);
  tabNotesBtn.classList.toggle('active', !isTasks);
  tabTasksBtn.setAttribute('aria-selected', String(isTasks));
  tabNotesBtn.setAttribute('aria-selected', String(!isTasks));
}
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
  taskForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentCaseId) return;
    const text = taskInput.value.trim();
    const statusVal = 'open';
    if (!text) return;
    const { cipher: textCipher, iv: textIv } = await encryptText(text);
    const { cipher: statusCipher, iv: statusIv } = await encryptText(statusVal);
    await addDoc(collection(db, 'cases', currentCaseId, 'tasks'), {
      textCipher, textIv, statusCipher, statusIv, createdAt: serverTimestamp(), username,
    });
    taskInput.value = '';
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
  caseListSection = document.getElementById('case-list-section');
  caseForm = document.getElementById('case-form');
  caseInput = document.getElementById('case-input');
  caseDetailEl = document.getElementById('case-detail');
  caseTitleEl = document.getElementById('case-title');
  backBtn = document.getElementById('back-btn');
  taskForm = document.getElementById('task-form');
  taskInput = document.getElementById('task-input');
  taskListEl = document.getElementById('task-list');
  noteForm = document.getElementById('note-form');
  noteInput = document.getElementById('note-input');
  notesListEl = document.getElementById('notes-list');
  tabTasksBtn = document.getElementById('tab-tasks');
  tabNotesBtn = document.getElementById('tab-notes');
  userDetailEl = document.getElementById('user-detail');
  userTitleEl = document.getElementById('user-title');
  userTaskListEl = document.getElementById('user-task-list');
  userBackBtn = document.getElementById('user-back-btn');
  brandHome = document.getElementById('brand-home');
  userFilterEl = document.getElementById('user-filter');

  bindCaseForm();
  bindTaskForm();
  bindNoteForm();
  bindTabs();
  backBtn.addEventListener('click', () => {
    if (backTarget === 'user' && userDetailEl) {
      // Leave case view, return to user page
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }
      if (unsubNotes) { unsubNotes(); unsubNotes = null; }
      currentCaseId = null;
      caseDetailEl.hidden = true;
      userDetailEl.hidden = false;
      if (caseListSection) caseListSection.style.display = 'none';
      backTarget = 'list';
    } else {
      showCaseList();
    }
  });
  userBackBtn.addEventListener('click', () => {
    userDetailEl.hidden = true;
    // Return to prior view: case detail if one is open, else case list
    if (currentCaseId) {
      caseDetailEl.hidden = false;
      if (caseListSection) caseListSection.style.display = 'none';
    } else {
      showCaseList();
    }
    if (Array.isArray(unsubUserTasks)) {
      for (const u of unsubUserTasks) try { u(); } catch {}
      unsubUserTasks = [];
    }
  });
  if (brandHome) {
    brandHome.addEventListener('click', () => {
      showCaseList();
    });
  }
  if (userFilterEl) {
    userFilterEl.addEventListener('change', () => {
      currentUserFilter = userFilterEl.value;
      if (currentUserPageName) userFilterByName.set(currentUserPageName, currentUserFilter);
      renderUserTasks();
    });
  }
  if (userFilterEl) {
    userFilterEl.addEventListener('change', () => {
      currentUserFilter = userFilterEl.value;
      renderUserTasks();
    });
  }

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
  // Start manual users list
  startRealtimeUsers();
});

// Toast utility
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 3300);
}

// Deep delete a case and nested content
async function deleteCaseDeep(caseId) {
  // Delete tasks and their comments
  const tasks = await getDocs(collection(db, 'cases', caseId, 'tasks'));
  for (const t of tasks.docs) {
    const comments = await getDocs(collection(db, 'cases', caseId, 'tasks', t.id, 'comments'));
    await Promise.all(comments.docs.map((c) => deleteDoc(doc(db, 'cases', caseId, 'tasks', t.id, 'comments', c.id))));
    await deleteDoc(doc(db, 'cases', caseId, 'tasks', t.id));
  }
  // Delete notes
  const notes = await getDocs(collection(db, 'cases', caseId, 'notes'));
  await Promise.all(notes.docs.map((n) => deleteDoc(doc(db, 'cases', caseId, 'notes', n.id))));
  // Delete case doc
  await deleteDoc(doc(db, 'cases', caseId));
}

// --- Presence: users list
function startRealtimeUsers() {
  const list = document.getElementById('user-list');
  const addBtn = document.getElementById('add-user-btn');
  const menu = document.getElementById('users-menu');
  const btn = document.getElementById('users-btn');
  if (!list || !addBtn || !menu || !btn) return;

  // Toggle dropdown
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) setOpen(false);
  });

  // Add user
  addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = (prompt('Add user name') || '').trim();
    if (!name) return;
    await addDoc(collection(db, 'users'), { username: name, createdAt: serverTimestamp() });
  });

  const q = query(collection(db, 'users'), orderBy('username'));
  if (unsubUsers) { unsubUsers(); unsubUsers = null; }
  unsubUsers = onSnapshot(q, snap => {
    list.innerHTML = '';
    usersCache = [];
    for (const d of snap.docs) {
      const data = d.data();
      const name = data.username || 'Unknown';
      usersCache.push({ id: d.id, username: name });

      const li = document.createElement('li');
      const nameBtn = document.createElement('button');
      nameBtn.className = 'name icon-btn';
      nameBtn.textContent = name;
      nameBtn.addEventListener('click', () => {
        setOpen(false);
        openUser(name);
      });

      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.textContent = '✏️';
      edit.setAttribute('aria-label', `Edit ${name}`);
      edit.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = (prompt('Edit user name', name) || '').trim();
        if (!next || next === name) return;
        await updateDoc(doc(db, 'users', d.id), { username: next });
      });

      const del = document.createElement('button');
      del.className = 'icon-btn delete-btn';
      del.textContent = '🗑';
      del.setAttribute('aria-label', `Delete ${name}`);
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete user \'${name}\'?`)) return;
        await deleteDoc(doc(db, 'users', d.id));
      });

      li.appendChild(nameBtn);
      li.appendChild(edit);
      li.appendChild(del);
      list.appendChild(li);
    }
  });
}
function openUser(name) {
  currentUserPageName = name;
  userTitleEl.textContent = `${name}'s tasks`;
  if (caseListSection) caseListSection.style.display = 'none';
  caseDetailEl.hidden = true;
  userDetailEl.hidden = false;
  // Restore last-used filter for this user within the session
  const saved = userFilterByName.has(name) ? userFilterByName.get(name) : 'all';
  currentUserFilter = saved;
  if (userFilterEl) { userFilterEl.value = saved; }
  startRealtimeUserTasks(name);
}

async function startRealtimeUserTasks(name) {
  // Clear any previous data and build a fresh snapshot for filtering
  userPerCase = new Map();
  userCaseTitles = new Map();
  userTaskListEl.innerHTML = '';

  const casesSnap = await getDocs(collection(db, 'cases'));
  for (const c of casesSnap.docs) {
    const caseId = c.id;
    try {
      const cd = c.data();
      const title = await decryptText(cd.titleCipher, cd.titleIv);
      userCaseTitles.set(caseId, title);
    } catch { userCaseTitles.set(caseId, '(case)'); }

    const tasksSnap = await getDocs(query(collection(db, 'cases', caseId, 'tasks'), where('assignee', '==', name)));
    const items = [];
    for (const d of tasksSnap.docs) {
      const dat = d.data();
      try {
        const text = await decryptText(dat.textCipher, dat.textIv);
        const status = await decryptText(dat.statusCipher, dat.statusIv);
        items.push({ taskId: d.id, text, status, assignee: dat.assignee || null, caseId });
      } catch (err) { console.error('Skipping task (decrypt) in user view', err); }
    }
    userPerCase.set(caseId, items);
  }

  renderUserTasks();
}

function renderUserTasks() {
  if (!userTaskListEl) return;
  userTaskListEl.innerHTML = '';
  const caseIds = Array.from(userPerCase.keys()).sort((a, b) => (userCaseTitles.get(a) || '').localeCompare(userCaseTitles.get(b) || ''));
  for (const caseId of caseIds) {
    let items = userPerCase.get(caseId) || [];
    if (currentUserFilter !== 'all') items = items.filter(i => i.status === currentUserFilter);
    if (items.length === 0) continue;
    const title = userCaseTitles.get(caseId) || '(case)';

    const caseCard = document.createElement('div');
    caseCard.className = 'card user-case-card';
    const header = document.createElement('div');
    header.className = 'user-case-header';
    const h = document.createElement('h3');
    const link = document.createElement('button');
    link.className = 'link-btn';
    link.textContent = title;
    link.setAttribute('aria-label', `Open case ${title}`);
    link.addEventListener('click', () => openCase(caseId, title, 'user'));
    h.appendChild(link);
    header.appendChild(h);
    const countBadge = document.createElement('span');
    countBadge.className = 'badge';
    countBadge.textContent = String(items.length);
    header.appendChild(countBadge);
    caseCard.appendChild(header);

    const ul = document.createElement('ul');
    const sorted = [...items].sort((a, b) => 0); // maintain fetch order; or could sort by text
    for (const it of sorted) {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.status = it.status;

      const taskMain = document.createElement('div');
      taskMain.className = 'task-main';
      const statusBtn = document.createElement('button');
      statusBtn.type = 'button';
      statusBtn.className = 'icon-btn task-status-btn';
      const statusIcon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
      const statusLabel = (s) => `Task status: ${s}`;
      statusBtn.textContent = statusIcon(it.status);
      statusBtn.setAttribute('aria-label', statusLabel(it.status));
      statusBtn.addEventListener('click', async () => {
        const order = ['open', 'in progress', 'complete'];
        const idx = order.indexOf(li.dataset.status || 'open');
        const next = order[(idx + 1) % order.length];
        const { cipher, iv } = await encryptText(next);
        await updateDoc(doc(db, 'cases', caseId, 'tasks', it.taskId), { statusCipher: cipher, statusIv: iv });
        li.dataset.status = next;
        statusBtn.textContent = statusIcon(next);
        statusBtn.setAttribute('aria-label', statusLabel(next));
      });
      const titleSpan = document.createElement('span');
      titleSpan.className = 'task-title';
      titleSpan.textContent = it.text;
      taskMain.appendChild(statusBtn);
      taskMain.appendChild(titleSpan);
      li.appendChild(taskMain);

      const actions = document.createElement('div');
      actions.className = 'task-actions';
      li.appendChild(actions);

      // Edit
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.textContent = '✏️';
      editBtn.setAttribute('aria-label', 'Edit task');
      editBtn.addEventListener('click', async () => {
        const current = titleSpan.textContent;
        const next = (prompt('Edit task', current) || '').trim();
        if (!next || next === current) return;
        const { cipher: textCipher, iv: textIv } = await encryptText(next);
        await updateDoc(doc(db, 'cases', caseId, 'tasks', it.taskId), { textCipher, textIv });
        titleSpan.textContent = next;
        showToast('Task updated');
      });
      actions.appendChild(editBtn);

      // Delete
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn delete-btn';
      delBtn.textContent = '🗑';
      delBtn.setAttribute('aria-label', 'Delete task');
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this task?')) return;
        await deleteDoc(doc(db, 'cases', caseId, 'tasks', it.taskId));
        li.remove();
        const current = parseInt(caseCard.querySelector('.badge')?.textContent || '1', 10);
        if (!Number.isNaN(current) && current > 0) caseCard.querySelector('.badge').textContent = String(current - 1);
        showToast('Task deleted');
      });
      actions.appendChild(delBtn);

      // Reassign quick button
      const reBtn = document.createElement('button');
      reBtn.className = 'icon-btn';
      reBtn.textContent = '👤';
      reBtn.setAttribute('aria-label', 'Reassign task');
      reBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sel = document.createElement('select');
        sel.className = 'assignee-select';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = 'Unassigned';
        sel.appendChild(none);
        for (const u of usersCache) {
          const opt = document.createElement('option');
          opt.value = u.username;
          opt.textContent = u.username;
          sel.appendChild(opt);
        }
        sel.value = (it.assignee || '');
        sel.addEventListener('change', async () => {
          const newAssignee = sel.value || null;
          await updateDoc(doc(db, 'cases', caseId, 'tasks', it.taskId), { assignee: newAssignee });
          if (currentUserPageName && newAssignee !== currentUserPageName) {
            li.remove();
            const current = parseInt(caseCard.querySelector('.badge')?.textContent || '1', 10);
            if (!Number.isNaN(current) && current > 0) caseCard.querySelector('.badge').textContent = String(current - 1);
          }
          sel.remove();
          showToast('Task reassigned');
        }, { once: true });
        const onDocClick = (ev) => {
          if (ev.target !== sel) {
            sel.remove();
            document.removeEventListener('click', onDocClick, true);
          }
        };
        document.addEventListener('click', onDocClick, true);
        actions.insertBefore(sel, reBtn.nextSibling);
        sel.focus();
      });
      actions.appendChild(reBtn);

      // Comments toggle + count
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'icon-btn comment-toggle';
      toggle.setAttribute('aria-label', 'Show comments');
      actions.appendChild(toggle);
      const commentCountEl = document.createElement('span');
      commentCountEl.className = 'badge comment-count';
      actions.appendChild(commentCountEl);

      const commentSection = document.createElement('div');
      commentSection.className = 'comment-section';
      commentSection.hidden = false;
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

      let commentsLoaded = true;
      let commentCount = 0;
      const updateToggle = () => {
        toggle.textContent = commentSection.hidden ? '💬' : '✖';
        commentCountEl.textContent = commentCount > 0 ? String(commentCount) : '';
        toggle.setAttribute('aria-label', commentSection.hidden ? 'Show comments' : 'Hide comments');
      };
      updateToggle();
      startRealtimeComments(caseId, it.taskId, commentsList, (n) => { commentCount = n; updateToggle(); });

      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = commentInput.value.trim();
        if (!text) return;
        const tempLi = document.createElement('li');
        tempLi.className = 'optimistic';
        const tempSpan = document.createElement('span');
        tempSpan.textContent = username ? `${username}: ${text}` : text;
        tempLi.appendChild(tempSpan);
        commentsList.appendChild(tempLi);
        commentInput.value = '';
        commentSection.hidden = false;
        updateToggle();
        try {
          const { cipher, iv } = await encryptText(text);
          await addDoc(collection(db, 'cases', caseId, 'tasks', it.taskId, 'comments'), {
            cipher, iv, username, createdAt: serverTimestamp(),
          });
          if (!commentsLoaded) {
            startRealtimeComments(caseId, it.taskId, commentsList, (n) => { commentCount = n; updateToggle(); });
            commentsLoaded = true;
          }
        } catch (err) {
          tempLi.classList.add('failed');
          showToast('Failed to add comment');
        }
      });
      commentSection.appendChild(commentForm);

      toggle.addEventListener('click', () => {
        const hidden = commentSection.hidden;
        commentSection.hidden = !hidden;
        updateToggle();
        if (hidden && !commentsLoaded) {
          startRealtimeComments(caseId, it.taskId, commentsList, (n) => { commentCount = n; updateToggle(); });
          commentsLoaded = true;
        }
      });

      li.appendChild(commentSection);
      ul.appendChild(li);
    }
    caseCard.appendChild(ul);
    userTaskListEl.appendChild(caseCard);
  }
}
