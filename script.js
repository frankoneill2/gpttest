// script.js (ES module)

// --- Firebase: import from the CDN (no npm needed)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, onSnapshot,
  deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp, getDocs, setDoc, collectionGroup, where, getDoc, limit
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
let caseListSection, caseListEl, caseForm, caseInput, caseLocationSel;
let caseDetailEl, caseTitleEl, backBtn;
let taskForm, taskInput, taskListEl;
let taskAssigneeEl, taskPriorityEl, composerOptsEl;
let noteForm, noteInput, notesListEl;
let tabTasksBtn, tabNotesBtn;
let userDetailEl, userTitleEl, userTaskListEl, userBackBtn;
let brandHome;
let currentCaseId = null;
let collapseAll = false; // global state for compact tasks on case list
let hideAllComments = false; // global show/hide comments on case list
let backTarget = 'list'; // 'list' or 'user'
let currentUserPageName = null;
let unsubTasks = null;
let unsubNotes = null;
let unsubUsers = null;
let unsubLocations = null;
let usersCache = [];
let locationsCache = [];
let unsubUserTasks = [];
let pendingFocusTaskId = null; // when navigating from case list to a specific task
// In-session compact order for case list preview: caseId -> [taskIds]
let compactOrderByCase = new Map();
// Toolbar filters for case tasks
let toolbarStatuses = new Set(['open','in progress','complete']);
let toolbarPriority = 'all';
let toolbarSort = 'none';
let toolbarSearch = '';
let currentCaseTasks = [];
let currentTaskOrder = null;
// User page state for rendering/filtering
let userPerCase = new Map(); // caseId -> [{ taskId, text, status }]
let userCaseTitles = new Map(); // caseId -> title
let currentUserFilter = 'all';
let userFilterEl; // legacy single-select (no longer used)
let currentUserStatusSet = new Set(['open', 'in progress', 'complete']);
let currentUserPriorityFilter = 'all';
let currentUserSort = 'none';
let currentUserSearch = '';
let userStatusEls = [];
let userPriorityFilterEl, userSortEl;
let userFilterByName = new Map(); // username -> { statuses: [...], priority: 'all'|'high'|'medium'|'low', sort: 'none'|'pri-asc'|'pri-desc' }

// Utility: assign a consistent color to a name for avatar badges
function colorForName(name) {
  if (!name) return { bg: '#e5e7eb', border: '#d1d5db', color: '#374151' };
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const bg = `hsl(${h}, 70%, 90%)`;
  const border = `hsl(${h}, 60%, 65%)`;
  const color = `hsl(${h}, 40%, 25%)`;
  return { bg, border, color };
}

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
  // Reset in-session compact orders when arriving fresh to case list
  compactOrderByCase = new Map();
}

async function openCase(id, title, source = 'list', initialTab = 'notes') {
  currentCaseId = id;
  backTarget = source === 'user' ? 'user' : 'list';
  caseTitleEl.textContent = title;
  if (caseListSection) caseListSection.style.display = 'none';
  userDetailEl.hidden = true;
  caseDetailEl.hidden = false;
  startRealtimeTasks(id);
  startRealtimeNotes(id);
  // Open chosen tab
  showTab(initialTab);
}


// Top-level tabs between Cases and My Tasks
function showMainTab(which) {
  const mainTabCases = document.getElementById('tab-cases');
  const mainTabMy = document.getElementById('tab-my');
  const onCases = which === 'cases';
  // Toggle active classes
  if (mainTabCases && mainTabMy) {
    mainTabCases.classList.toggle('active', onCases);
    mainTabCases.setAttribute('aria-selected', String(onCases));
    mainTabMy.classList.toggle('active', !onCases);
    mainTabMy.setAttribute('aria-selected', String(!onCases));
  }
  if (onCases) {
    // Show cases list or detail, hide user detail
    userDetailEl.hidden = true;
    if (currentCaseId) {
      caseDetailEl.hidden = false;
      if (caseListSection) caseListSection.style.display = 'none';
    } else {
      showCaseList();
    }
  } else {
    // Show current user's tasks
    openUser(username);
  }
}


// User select modal using live users list
function showUserSelectModal() {
  return new Promise(async (resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const modal = document.createElement('div'); modal.className = 'modal'; overlay.appendChild(modal);
    const title = document.createElement('h3'); title.textContent = 'Select your user'; modal.appendChild(title);
    const row = document.createElement('div'); row.className = 'row'; modal.appendChild(row);
    const select = document.createElement('select'); select.style.height = '48px'; select.style.borderRadius = '12px'; select.style.border = '1px solid #e5e7eb'; select.style.padding = '0 12px'; row.appendChild(select);
    const actions = document.createElement('div'); actions.className = 'actions'; modal.appendChild(actions);
    const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; actions.appendChild(cancel);
    const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = 'Continue'; actions.appendChild(ok);
    document.body.appendChild(overlay);
    let unsub = null;
    const fill = (names) => {
      const prev = select.value;
      select.innerHTML = '';
      for (const n of names) { const opt=document.createElement('option'); opt.value=n; opt.textContent=n; select.appendChild(opt);} 
      if (prev && names.includes(prev)) select.value = prev;
    };
    try {
      const qUsers = query(collection(db, 'users'), orderBy('username'));
      unsub = onSnapshot(qUsers, (snap) => {
        const names = snap.docs.map(d => (d.data().username || '').trim()).filter(Boolean);
        fill(names);
      });
    } catch (e) {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('username')));
      fill(snap.docs.map(d => (d.data().username || '').trim()).filter(Boolean));
    }
    const cleanup = () => { if (unsub) unsub(); overlay.remove(); };
    cancel.addEventListener('click', () => { cleanup(); resolve(''); });
    ok.addEventListener('click', () => { const val = select.value || ''; cleanup(); resolve(val); });
    select.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); }});
    select.focus();
  });
}

// --- Firestore listeners
function startRealtimeCases() {
  const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'));
  onSnapshot(q, async snap => {
    caseListEl.innerHTML = '';
    // Build list and sort by location
    const rows = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      try {
        const title = await decryptText(data.titleCipher, data.titleIv);
        const location = (data.location || '').trim();
        rows.push({ docSnap, title, location });
      } catch (err) {
        console.error('Skipping undecryptable case', err);
      }
    }
    rows.sort((a, b) => {
      const la = a.location || '\uFFFF';
      const lb = b.location || '\uFFFF';
      const byLoc = la.localeCompare(lb);
      if (byLoc !== 0) return byLoc;
      return a.title.localeCompare(b.title);
    });

    for (const { docSnap, title, location } of rows) {
      const li = document.createElement('li');
      li.className = 'case-item';
      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '6px';
      left.style.flex = '1 1 auto';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'case-title';
      // Parse trailing ID in parentheses for subtitle
      let mainTitle = title, idText = '';
      const m = title.match(/^(.*?)(\s*\(([^)]+)\))\s*$/);
      if (m) { mainTitle = m[1]; idText = m[3]; }
      titleSpan.textContent = mainTitle;
      left.appendChild(titleSpan);
      // Location chip (clickable to edit)
      const chip = document.createElement('span');
      chip.className = 'chip location';
      const renderChip = (val) => { chip.textContent = `📍 ${val || 'None'}`; };
      renderChip(location);
      // Build a second-line container for subtitle + chip
      const subinfo = document.createElement('div');
      subinfo.className = 'case-subinfo-left';
      if (idText) {
        const idEl = document.createElement('span'); idEl.className = 'case-id'; idEl.textContent = `(${idText})`;
        subinfo.appendChild(idEl);
      }
      subinfo.appendChild(chip);
      // Prevent chip click from opening the case
      chip.addEventListener('mousedown', (e) => e.stopPropagation());
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle select next to chip
        const existing = left.querySelector('select.location-select');
        if (existing) { existing.remove(); return; }
        const sel = document.createElement('select');
        sel.className = 'location-select';
        const none = document.createElement('option'); none.value=''; none.textContent='No location'; sel.appendChild(none);
        for (const l of locationsCache) { const opt=document.createElement('option'); opt.value=l.name; opt.textContent=l.name; sel.appendChild(opt);} 
        sel.value = location || '';
        const stop = (ev) => ev.stopPropagation();
        sel.addEventListener('mousedown', stop);
        sel.addEventListener('click', stop);
        sel.addEventListener('keydown', stop);
        sel.addEventListener('change', async (ev) => {
          ev.stopPropagation();
          const newVal = sel.value || null;
          try {
            await updateDoc(doc(db, 'cases', docSnap.id), { location: newVal });
            renderChip(newVal);
          } catch (err) {
            console.error('Failed to update location', err);
            showToast('Failed to update location');
          } finally {
            sel.remove();
          }
        }, { once: true });
        chip.insertAdjacentElement('afterend', sel);
        sel.focus();
      });
      const actions = document.createElement('div');
      actions.className = 'case-actions';

      // Show/hide compact tasks toggle (chevron)
      const tasksToggle = document.createElement('button');
      tasksToggle.type = 'button';
      tasksToggle.className = 'chev-btn';
      tasksToggle.setAttribute('aria-label', 'Hide tasks');
      tasksToggle.textContent = '▾';
      actions.appendChild(tasksToggle);

      // Overflow menu (⋯) for edit/delete
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'actions-menu';
      const menuBtn = document.createElement('button');
      menuBtn.className = 'icon-btn';
      menuBtn.setAttribute('aria-label', 'More actions');
      menuBtn.textContent = '⋯';
      actionsWrap.appendChild(menuBtn);
      const panel = document.createElement('div');
      panel.className = 'menu-panel';
      panel.hidden = true;
      const addItem = (label, onClick, opts={}) => {
        const { danger=false } = opts;
        const b=document.createElement('button'); b.className='menu-item'+(danger?' delete-btn':''); b.textContent=label; b.addEventListener('click',(e)=>{ e.stopPropagation(); onClick(); panel.hidden=true;}); panel.appendChild(b);
      };
      addItem('Edit title', async () => {
        const current = mainTitle;
        const newTitle = (prompt('Edit case title', current) || '').trim();
        if (!newTitle) return;
        const { cipher, iv } = await encryptText(newTitle);
        await updateDoc(doc(db, 'cases', docSnap.id), { titleCipher: cipher, titleIv: iv });
        if (currentCaseId === docSnap.id) caseTitleEl.textContent = newTitle;
        showToast('Case title updated');
      });
      addItem('Delete case', async () => {
        if (!confirm('Delete this case and all its items?')) return;
        await deleteCaseDeep(docSnap.id);
        if (currentCaseId === docSnap.id) showCaseList();
        showToast('Case deleted');
      }, { danger: true });
      actionsWrap.appendChild(panel);
      actions.appendChild(actionsWrap);

      // Prevent clicks in actions area from opening the case
      actions.addEventListener('click', (e) => e.stopPropagation());
      actions.addEventListener('mousedown', (e) => e.stopPropagation());

      // Overflow interactions
      const toggleMenu = (open) => { panel.hidden = !open; };
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(panel.hidden); });
      document.addEventListener('click', (e) => { if (panel.hidden) return; const ae=document.activeElement; const inside=panel.contains(e.target)|| (ae && panel.contains(ae)); if (!inside && e.target!==menuBtn) toggleMenu(false); });

      // Header row that contains title/loc and actions
      const headerRow = document.createElement('div');
      headerRow.className = 'case-item-header';
      headerRow.appendChild(left);
      headerRow.appendChild(subinfo);
      headerRow.appendChild(actions);
      li.appendChild(headerRow);
      li.addEventListener('click', () => openCase(docSnap.id, title, 'list'));

      // Compact tasks container (beneath header row)
      const tasksWrap = document.createElement('div');
      tasksWrap.className = 'case-tasks-wrap';
      const tasksUl = document.createElement('ul');
      tasksUl.className = 'case-tasks';
      tasksWrap.appendChild(tasksUl);
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'case-tasks-more';
      moreBtn.hidden = true;
      tasksWrap.appendChild(moreBtn);
      // allow clicking tasks to navigate; controls will stop propagation individually
      li.appendChild(tasksWrap);

      // Toggle behavior
      let tasksHidden = collapseAll;
      tasksWrap.hidden = tasksHidden;
      tasksToggle.textContent = tasksHidden ? '▸' : '▾';
      tasksToggle.setAttribute('aria-label', tasksHidden ? 'Show tasks' : 'Hide tasks');
      tasksToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        tasksHidden = !tasksHidden;
        tasksWrap.hidden = tasksHidden;
        tasksToggle.textContent = tasksHidden ? '▸' : '▾';
        tasksToggle.setAttribute('aria-label', tasksHidden ? 'Show tasks' : 'Hide tasks');
      });

      // Load compact tasks (non-realtime snapshot)
      loadCompactTasks(docSnap.id, title, tasksUl, moreBtn);

      caseListEl.appendChild(li);
    }
  });
}

async function loadCompactTasks(caseId, caseTitle, ul, moreBtn) {
  ul.innerHTML = '';
  try {
    const snap = await getDocs(collection(db, 'cases', caseId, 'tasks'));
    const items = [];
    for (const d of snap.docs) {
      const dat = d.data();
      try {
        const text = await decryptText(dat.textCipher, dat.textIv);
        const status = await decryptText(dat.statusCipher, dat.statusIv);
        items.push({ id: d.id, text, status, priority: dat.priority || null, assignee: dat.assignee || null });
      } catch {}
    }
    // Establish per-case in-session order on first render
    if (!compactOrderByCase.has(caseId)) {
      const orderVal = (s) => s === 'open' ? 0 : (s === 'in progress' ? 1 : 2);
      const init = [...items].sort((a,b) => orderVal(a.status) - orderVal(b.status));
      compactOrderByCase.set(caseId, init.map(i => i.id));
    } else {
      // If new tasks appear, add to the front without reordering existing
      const order = compactOrderByCase.get(caseId);
      for (const i of items) if (!order.includes(i.id)) order.unshift(i.id);
    }
    const order = compactOrderByCase.get(caseId) || items.map(i => i.id);
    const idx = new Map(order.map((id, i) => [id, i]));
    items.sort((a, b) => (idx.get(a.id) ?? 999999) - (idx.get(b.id) ?? 999999));

    const limit = 4;
    const expanded = ul.dataset.expanded === 'true';
    const nonCompleted = items.filter(i => i.status !== 'complete');
    const visible = expanded ? items : nonCompleted.slice(0, limit);

    // Show/hide the more button
    const remainingCount = expanded ? 0 : (items.length - visible.length);
    if (remainingCount > 0) {
      moreBtn.hidden = false;
      moreBtn.textContent = expanded ? 'Show less' : `Show more (${remainingCount})`;
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        ul.dataset.expanded = expanded ? 'false' : 'true';
        // Re-render with toggled state
        loadCompactTasks(caseId, caseTitle, ul, moreBtn);
      };
    } else {
      moreBtn.hidden = true;
    }

    for (const it of visible) {
      const li = document.createElement('li');
      const statusCls = it.status === 'in progress' ? 's-inprogress' : (it.status === 'complete' ? 's-complete' : 's-open');
      li.className = 'case-task ' + statusCls;
      // Navigate to case tasks focused on this task when clicking the row
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingFocusTaskId = it.id;
        openCase(caseId, caseTitle, 'list', 'tasks');
      });
      const statusBtn = document.createElement('button');
      statusBtn.type = 'button';
      statusBtn.className = 'status-btn';
      const icon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
      statusBtn.textContent = icon(it.status);
      statusBtn.setAttribute('aria-label', `Task status: ${it.status}`);
      statusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const order = ['open','in progress','complete'];
        const idx = order.indexOf(it.status);
        const next = order[(idx + 1) % order.length];
        try {
          const { cipher, iv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', it.id), { statusCipher: cipher, statusIv: iv });
          it.status = next;
          statusBtn.textContent = icon(next);
          statusBtn.setAttribute('aria-label', `Task status: ${next}`);
          li.className = 'case-task ' + (next === 'in progress' ? 's-inprogress' : (next === 'complete' ? 's-complete' : 's-open'));
          // Do not re-sort now; keep in-session order stable until leaving page
        } catch (err) {
          console.error('Failed to update status', err);
          showToast('Failed to update status');
        }
      });
      const text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = it.text;
      li.appendChild(statusBtn);
      li.appendChild(text);
      if (it.priority) {
        const pri = document.createElement('span');
        pri.className = 'mini-chip';
        pri.textContent = it.priority;
        li.appendChild(pri);
      }
      // Assignee badge (always rendered), with hover tooltip and popup picker on click
      const av = document.createElement('span');
      av.className = 'mini-avatar';
      const initials = it.assignee ? it.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase() : '';
      av.textContent = initials || '';
      const col = colorForName(it.assignee || '');
      av.style.background = col.bg;
      av.style.color = col.color;
      av.style.border = `1px solid ${col.border}`;
      av.setAttribute('aria-label', it.assignee ? `Assigned to ${it.assignee}` : 'Unassigned');
      // Tooltip for full name on hover (rendered at body level to avoid clipping)
      let tipEl = null;
      const removeTip = () => { if (tipEl) { tipEl.remove(); tipEl = null; } };
      av.addEventListener('mouseenter', () => {
        if (!it.assignee) return; // skip tooltip when unassigned
        tipEl = document.createElement('div');
        tipEl.className = 'assignee-tip';
        tipEl.textContent = it.assignee;
        tipEl.style.position = 'fixed';
        tipEl.style.zIndex = '2147483647';
        document.body.appendChild(tipEl);
        // Position above the avatar
        const r = av.getBoundingClientRect();
        // After layout, adjust top to account for tooltip height
        requestAnimationFrame(() => {
          const h = tipEl.offsetHeight || 24;
          tipEl.style.left = `${Math.round(r.left + r.width / 2)}px`;
          tipEl.style.top = `${Math.round(r.top - 6 - h)}px`;
          tipEl.style.transform = 'translateX(-50%)';
        });
      });
      av.addEventListener('mouseleave', removeTip);
      window.addEventListener('scroll', removeTip, { passive: true });
      window.addEventListener('resize', removeTip, { passive: true });
      
      // Popup picker
      av.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close existing if open
        const existing = li.querySelector('.assignee-panel');
        if (existing) { existing.remove(); return; }
        const panel = document.createElement('div');
        panel.className = 'assignee-panel';
        panel.style.position = 'fixed';
        panel.style.zIndex = '2147483646';
        const addOpt = (label, value) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'assignee-option';
          b.textContent = label;
          b.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            try {
              await updateDoc(doc(db, 'cases', caseId, 'tasks', it.id), { assignee: value });
              loadCompactTasks(caseId, caseTitle, ul, moreBtn);
            } catch (err) {
              console.error('Failed to reassign task', err);
              showToast('Failed to reassign');
            } finally {
              panel.remove();
            }
          });
          panel.appendChild(b);
        };
        addOpt('Unassigned', null);
        for (const u of usersCache) addOpt(u.username, u.username);
        document.body.appendChild(panel);
        // Position near the avatar (below, aligned to right if space)
        const r = av.getBoundingClientRect();
        requestAnimationFrame(() => {
          const w = panel.offsetWidth || 180;
          const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
          const top = Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6);
          panel.style.left = `${Math.round(left)}px`;
          panel.style.top = `${Math.round(top)}px`;
        });
        // outside click to close
        const onDocClick = (evt) => {
          if (!panel || panel.contains(evt.target) || evt.target === av) return;
          panel.remove();
          document.removeEventListener('click', onDocClick, true);
        };
        setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
      });
      li.appendChild(av);
      // Minimal comments line (latest)
      const cm = document.createElement('div');
      cm.className = 'case-mini-comments';
      cm.hidden = hideAllComments;
      li.appendChild(cm);
      loadLastComment(caseId, it.id, cm);
      ul.appendChild(li);
    }
  } catch (err) {
    console.error('Failed to load compact tasks for case', caseId, err);
  }
}

async function loadLastComment(caseId, taskId, container) {
  container.textContent = '';
  try {
    const snap = await getDocs(query(collection(db, 'cases', caseId, 'tasks', taskId, 'comments'), orderBy('createdAt', 'desc'), limit(1)));
    if (snap.empty) { container.hidden = hideAllComments; return; }
    const d = snap.docs[0].data();
    const text = await decryptText(d.cipher, d.iv);
    const author = d.username || '';
    const line = document.createElement('div'); line.className = 'c-line';
    if (author) {
      const a = document.createElement('span'); a.className = 'c-author'; a.textContent = author + ':'; line.appendChild(a);
    }
    const t = document.createElement('span'); t.textContent = ' ' + text; line.appendChild(t);
    container.appendChild(line);
  } catch (err) {
    // ignore comment load errors
  }
}

// Global collapse/expand toggle for all compact task lists on case list page
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggle-all-tasks');
  if (!btn) return;
  const apply = () => {
    const wraps = document.querySelectorAll('.case-tasks-wrap');
    wraps.forEach(w => { w.hidden = collapseAll; });
    const toggles = document.querySelectorAll('.case-tasks-toggle');
    toggles.forEach(t => {
      if (!(t instanceof HTMLElement)) return;
      if (t.id === 'toggle-all-tasks' || t.id === 'toggle-all-comments') return; // skip header controls
      t.textContent = collapseAll ? 'Show tasks' : 'Hide tasks';
    });
    btn.textContent = collapseAll ? 'Expand all' : 'Collapse all';
  };
  btn.addEventListener('click', () => { collapseAll = !collapseAll; apply(); });
  apply();
});

// Global comments show/hide on case list
document.addEventListener('DOMContentLoaded', () => {
  const cbtn = document.getElementById('toggle-all-comments');
  if (!cbtn) return;
  const applyComments = () => {
    const c = document.querySelectorAll('.case-mini-comments');
    c.forEach(el => { if (el instanceof HTMLElement) el.hidden = hideAllComments; });
    cbtn.textContent = hideAllComments ? 'Show comments' : 'Hide comments';
  };
  cbtn.addEventListener('click', () => { hideAllComments = !hideAllComments; applyComments(); });
  applyComments();
});

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

    // Feed toolbar-based renderer
    currentTaskOrder = taskOrder.slice();
    currentCaseTasks = items.map(({ docSnap, data, text, status, createdAt }) => ({ caseId, id: docSnap.id, text, status, data, createdAt }));
    renderCaseTasks();
    return;

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

        // chips under title (priority)
        const chips = document.createElement('div');
        chips.className = 'chips';
        if (data.priority) {
          const pri = document.createElement('span');
          const val = data.priority;
          pri.className = 'chip ' + (val === 'high' ? 'pri-high' : val === 'medium' ? 'pri-medium' : 'pri-low');
          pri.textContent = `Priority: ${val}`;
          chips.appendChild(pri);
        }
        if (data.assignee) {
          const as = document.createElement('span');
          as.className = 'chip';
          const av = document.createElement('span');
          av.className = 'avatar';
          const initials = data.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase();
          av.textContent = initials || 'U';
          const name = document.createElement('span');
          name.textContent = data.assignee;
          as.appendChild(av); as.appendChild(name);
          chips.appendChild(as);
        }
        if (chips.children.length) li.appendChild(chips);


        // Actions menu (⋯)
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'actions-menu';
        const menuBtn = document.createElement('button');
        menuBtn.className = 'icon-btn';
        menuBtn.setAttribute('aria-label', 'More actions');
        menuBtn.textContent = '⋯';
        actionsWrap.appendChild(menuBtn);
        const panel = document.createElement('div');
        panel.className = 'menu-panel';
        panel.hidden = true;

        const addItem = (label, onClick, opts = {}) => {
          const { danger = false, autoClose = true } = opts;
          const b = document.createElement('button');
          b.className = 'menu-item' + (danger ? ' delete-btn' : '');
          b.textContent = label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            if (autoClose) panel.hidden = true;
          });
          panel.appendChild(b);
        };

        addItem('Edit', async () => {
          const current = titleSpan.textContent;
          const next = (prompt('Edit task', current) || '').trim();
          if (!next || next === current) return;
          const { cipher: textCipher, iv: textIv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { textCipher, textIv });
          titleSpan.textContent = next;
          showToast('Task updated');
        });

        addItem('Assign', () => {
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
            panel.hidden = true;
            showToast('Assignee updated');
          }, { once: true });
          panel.appendChild(sel);
          sel.focus();
        }, { autoClose: false });

        addItem('Delete', async () => {
          if (!confirm('Delete this task?')) return;
          await deleteDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id));
        }, { danger: true, autoClose: true });

        actionsWrap.appendChild(panel);
        actions.appendChild(actionsWrap);

      const toggleMenu = (open) => { panel.hidden = !open; };
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(panel.hidden); });
      document.addEventListener('click', (e) => {
        if (panel.hidden) return;
        const ae = document.activeElement;
        const interactingInside = panel.contains(e.target) || (ae && panel.contains(ae));
        if (!interactingInside && e.target !== menuBtn) toggleMenu(false);
      });

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

// Apply toolbar filters to current case tasks and render
function renderCaseTasks() {
  if (!taskListEl) return;
  const priVal = (p) => (p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0);
  let visible = currentCaseTasks.filter(it => {
    const pri = (it.data && it.data.priority) || '';
    const matchStatus = (!toolbarStatuses.size || toolbarStatuses.has(it.status));
    const matchPriority = (toolbarPriority === 'all' || pri === toolbarPriority);
    const matchSearch = (!toolbarSearch || it.text.toLowerCase().includes(toolbarSearch.toLowerCase()));
    return matchStatus && matchPriority && matchSearch;
  });
  let ordered;
  if (toolbarSort === 'pri-asc' || toolbarSort === 'pri-desc') {
    ordered = [...visible].sort((a,b) => {
      const pa = (a.data && a.data.priority) || '';
      const pb = (b.data && b.data.priority) || '';
      return toolbarSort === 'pri-asc' ? (priVal(pa) - priVal(pb)) : (priVal(pb) - priVal(pa));
    });
  } else {
    const idx = new Map((currentTaskOrder || []).map((id,i)=>[id,i]));
    ordered = [...visible].sort((a,b)=>(idx.get(a.id)??999999)-(idx.get(b.id)??999999));
  }
  // Re-render list with ordered
  taskListEl.innerHTML = '';
  for (const item of ordered) {
    // Reuse existing builder by simulating a single-item snapshot render
    // Build the same DOM fragment used in startRealtimeTasks for each item
    // Simplest: call a small builder
    const openComments = (pendingFocusTaskId && item.id === pendingFocusTaskId);
    taskListEl.appendChild(buildTaskListItem(item, { openComments }));
  }
  if (pendingFocusTaskId) {
    const target = document.getElementById('task-' + pendingFocusTaskId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash-highlight');
      setTimeout(() => target.classList.remove('flash-highlight'), 1400);
    }
    pendingFocusTaskId = null;
  }
}

function buildTaskListItem(item, opts = {}) {
  const { caseId, id: taskId, text, status, data } = item;
  const li = document.createElement('li');
  const statusCls = status === 'in progress' ? 's-inprogress' : (status === 'complete' ? 's-complete' : 's-open');
  li.className = 'case-task ' + statusCls;
  li.id = 'task-' + taskId;
  // Status button
  const statusBtn = document.createElement('button');
  statusBtn.type = 'button';
  statusBtn.className = 'status-btn';
  const icon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
  statusBtn.textContent = icon(status);
  statusBtn.setAttribute('aria-label', `Task status: ${status}`);
  statusBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const order = ['open','in progress','complete'];
    const next = order[(order.indexOf(statusBtn.getAttribute('aria-label')?.split(': ')[1] || status) + 1) % order.length];
    try {
      const { cipher, iv } = await encryptText(next);
      await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId), { statusCipher: cipher, statusIv: iv });
      statusBtn.textContent = icon(next);
      statusBtn.setAttribute('aria-label', `Task status: ${next}`);
      li.className = 'case-task ' + (next === 'in progress' ? 's-inprogress' : (next === 'complete' ? 's-complete' : 's-open'));
    } catch (err) { console.error('Failed to update status', err); showToast('Failed to update status'); }
  });
  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-text';
  titleSpan.textContent = text;
  li.appendChild(statusBtn);
  li.appendChild(titleSpan);
  // Priority chip
  if (data.priority) {
    const pri = document.createElement('span');
    pri.className = 'mini-chip';
    pri.textContent = data.priority;
    li.appendChild(pri);
  }
  // Assignee avatar with tooltip and popup picker
  const av = document.createElement('span');
  av.className = 'mini-avatar';
  const initials = data.assignee ? data.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase() : '';
  av.textContent = initials || '';
  const col = colorForName(data.assignee || '');
  av.style.background = col.bg; av.style.color = col.color; av.style.border = `1px solid ${col.border}`;
  let tipEl = null; const removeTip = () => { if (tipEl) { tipEl.remove(); tipEl = null; } };
  av.addEventListener('mouseenter', () => {
    if (!data.assignee) return;
    tipEl = document.createElement('div'); tipEl.className = 'assignee-tip'; tipEl.textContent = data.assignee; tipEl.style.position = 'fixed'; tipEl.style.zIndex='2147483647'; document.body.appendChild(tipEl);
    const r = av.getBoundingClientRect(); requestAnimationFrame(()=>{ const h=tipEl.offsetHeight||24; tipEl.style.left=`${Math.round(r.left + r.width/2)}px`; tipEl.style.top=`${Math.round(r.top - 6 - h)}px`; tipEl.style.transform='translateX(-50%)'; });
  });
  av.addEventListener('mouseleave', removeTip);
  av.addEventListener('click', (e) => {
    e.stopPropagation(); removeTip();
    const existing = document.querySelector('.assignee-panel'); if (existing) existing.remove();
    const panel = document.createElement('div'); panel.className='assignee-panel'; panel.style.position='fixed'; panel.style.zIndex='2147483646';
    const addOpt = (label, value) => { const b=document.createElement('button'); b.type='button'; b.className='assignee-option'; b.textContent=label; b.addEventListener('click', async (ev)=>{ ev.stopPropagation(); try{ await updateDoc(doc(db,'cases',caseId,'tasks',taskId),{ assignee: value }); renderCaseTasks(); } catch(err){ console.error('Failed to reassign',err); showToast('Failed to reassign'); } finally { panel.remove(); } }); panel.appendChild(b); };
    addOpt('Unassigned', null); for (const u of usersCache) addOpt(u.username, u.username);
    document.body.appendChild(panel);
    const r = av.getBoundingClientRect(); requestAnimationFrame(()=>{ const w=panel.offsetWidth||180; const left=Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8); const top=Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6); panel.style.left=`${Math.round(left)}px`; panel.style.top=`${Math.round(top)}px`; });
    const onDocClick = (evt)=>{ if (!panel || panel.contains(evt.target) || evt.target===av) return; panel.remove(); document.removeEventListener('click', onDocClick, true); }; setTimeout(()=>document.addEventListener('click', onDocClick, true),0);
  });
  li.appendChild(av);
  // Comments unobtrusive below (hidden by default)
  const toggle = document.createElement('button'); toggle.type='button'; toggle.className='icon-btn comment-toggle'; toggle.setAttribute('aria-label','Show comments'); toggle.textContent='💬';
  const countEl = document.createElement('span'); countEl.className='badge comment-count';
  li.appendChild(toggle); li.appendChild(countEl);
  const commentSection = document.createElement('div'); commentSection.className='comment-section'; commentSection.hidden= !(opts && opts.openComments); const commentsList=document.createElement('ul'); commentsList.className='comments'; commentSection.appendChild(commentsList);
  const commentForm=document.createElement('form'); commentForm.className='comment-form'; const commentInput=document.createElement('input'); commentInput.placeholder='Add comment'; commentForm.appendChild(commentInput); const commentBtn=document.createElement('button'); commentBtn.className='icon-btn add-comment-btn'; commentBtn.type='submit'; commentBtn.textContent='➕'; commentBtn.setAttribute('aria-label','Add comment'); commentForm.appendChild(commentBtn); commentSection.appendChild(commentForm);
  let commentsLoaded=false; let commentCount=0; const updateToggle=()=>{ countEl.textContent = commentCount>0? String(commentCount):''; toggle.setAttribute('aria-label', commentSection.hidden?'Show comments':'Hide comments'); toggle.textContent = commentSection.hidden ? '💬' : '✖'; };
  updateToggle();
  if (!commentSection.hidden && !commentsLoaded) {
    startRealtimeComments(caseId, taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); });
    commentsLoaded = true;
  }
  toggle.addEventListener('click', ()=>{ const h=commentSection.hidden; commentSection.hidden=!h; updateToggle(); if(h && !commentsLoaded){ startRealtimeComments(caseId, taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } });
  commentForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const t=commentInput.value.trim(); if(!t) return; const tempLi=document.createElement('li'); tempLi.className='optimistic'; const span=document.createElement('span'); span.textContent = username ? `${username}: ${t}` : t; tempLi.appendChild(span); commentsList.appendChild(tempLi); commentInput.value=''; commentSection.hidden=false; updateToggle(); try{ const {cipher, iv}= await encryptText(t); await addDoc(collection(db,'cases',caseId,'tasks',taskId,'comments'),{cipher,iv,username,createdAt:serverTimestamp()}); if(!commentsLoaded){ startRealtimeComments(caseId,taskId,commentsList,(n)=>{ commentCount=n; updateToggle();}); commentsLoaded=true; } } catch(err){ tempLi.classList.add('failed'); showToast('Failed to add comment'); } });
  li.appendChild(commentSection);
  return li;
}
function bindCaseForm() {
  caseForm.addEventListener('submit', async e => {
    e.preventDefault();
    const title = caseInput.value.trim();
    if (!title) return;
    const { cipher, iv } = await encryptText(title);
    const location = caseLocationSel ? (caseLocationSel.value || null) : null;
    await addDoc(collection(db, 'cases'), {
      titleCipher: cipher,
      titleIv: iv,
      createdAt: serverTimestamp(),
      username,
      location,
    });
    caseInput.value = '';
    if (caseLocationSel) caseLocationSel.value = '';
  });
}

function bindTaskForm() {
  populateComposerAssignees();
  if (document.getElementById('task-input') && document.getElementById('composer-opts')) {
    document.getElementById('task-input').addEventListener('focus', () => {
      document.getElementById('composer-opts').hidden = false;
    });
  }
  taskForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentCaseId) return;
    const text = taskInput.value.trim();
    const statusVal = 'open';
    if (!text) return;
    const { cipher: textCipher, iv: textIv } = await encryptText(text);
    const { cipher: statusCipher, iv: statusIv } = await encryptText(statusVal);
    const assigneeSel = document.getElementById('task-assignee');
    const priSel = document.getElementById('task-priority');
    const assignee = assigneeSel ? (assigneeSel.value || null) : null;
    const priority = priSel ? (priSel.value || null) : null;
    await addDoc(collection(db, 'cases', currentCaseId, 'tasks'), {
      textCipher, textIv, statusCipher, statusIv, createdAt: serverTimestamp(), username, assignee, priority,
    });
    taskInput.value = '';
    if (assigneeSel) assigneeSel.value = '';
    if (priSel) priSel.value = '';
  });
}

// Keep the composer assignee list in sync with usersCache
function populateComposerAssignees() {
  const sel = document.getElementById('task-assignee');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
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
  sel.value = prev || '';
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
  caseLocationSel = document.getElementById('case-location');
  caseDetailEl = document.getElementById('case-detail');
  caseTitleEl = document.getElementById('case-title');
  backBtn = document.getElementById('back-btn');
  taskForm = document.getElementById('task-form');
  taskInput = document.getElementById('task-input');
  taskListEl = document.getElementById('task-list');
  taskAssigneeEl = document.getElementById('task-assignee');
  taskPriorityEl = document.getElementById('task-priority');
  composerOptsEl = document.getElementById('composer-opts');
  noteForm = document.getElementById('note-form');
  noteInput = document.getElementById('note-input');
  notesListEl = document.getElementById('notes-list');
  tabTasksBtn = document.getElementById('tab-tasks');
  tabNotesBtn = document.getElementById('tab-notes');
  // Main tabs
  const mainTabCases = document.getElementById('tab-cases');
  const mainTabMy = document.getElementById('tab-my');
  userDetailEl = document.getElementById('user-detail');
  userTitleEl = document.getElementById('user-title');
  userTaskListEl = document.getElementById('user-task-list');
  userBackBtn = document.getElementById('user-back-btn');
  brandHome = document.getElementById('brand-home');
  userFilterEl = document.getElementById('user-filter');
  userStatusEls = Array.from(document.querySelectorAll('.user-status'));
  userPriorityFilterEl = document.getElementById('user-priority-filter');
  userSortEl = document.getElementById('user-sort');

  bindCaseForm();
  bindTaskForm();
  bindNoteForm();
  bindTabs();
  // Main tab bindings
  if (mainTabCases && mainTabMy) {
    mainTabCases.addEventListener('click', () => showMainTab('cases'));
    mainTabMy.addEventListener('click', () => showMainTab('my'));
  }
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
  
  // React toolbar events -> filter/sort case tasks
  document.addEventListener('taskToolbar:status', (e) => {
    const detail = (e && e.detail) || {};
    toolbarStatuses = new Set((detail.statuses || []).map(String));
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:priority', (e) => {
    toolbarPriority = (e && e.detail && e.detail.priority) || 'all';
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:sort', (e) => {
    toolbarSort = (e && e.detail && e.detail.sort) || 'none';
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:search', (e) => {
    toolbarSearch = (e && e.detail && e.detail.query) || '';
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:clear', () => {
    toolbarStatuses = new Set(['open','in progress','complete']);
    toolbarPriority = 'all';
    toolbarSort = 'none';
    toolbarSearch = '';
    renderCaseTasks();
  });
}
  // React User toolbar events
  document.addEventListener('userToolbar:status', (e) => {
    const detail = (e && e.detail) || {};
    currentUserStatusSet = new Set((detail.statuses || []).map(String));
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:priority', (e) => {
    currentUserPriorityFilter = (e && e.detail && e.detail.priority) || 'all';
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:sort', (e) => {
    currentUserSort = (e && e.detail && e.detail.sort) || 'none';
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:search', (e) => {
    currentUserSearch = (e && e.detail && e.detail.query) || '';
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:clear', () => {
    currentUserStatusSet = new Set(['open','in progress','complete']);
    currentUserPriorityFilter = 'all';
    currentUserSort = 'none';
    saveUserFilterState();
    renderUserTasks();
  });

  try {
    await signInAnonymously(auth);
  } catch (err) {
    console.error('Failed to sign in anonymously', err);
    return;
  }
  // First, passphrase
  const pass = prompt('Enter shared passphrase');
  if (!pass) return;
  key = await deriveKey(pass);
  // Then pick a user from dropdown modal fed by live users list
  username = await showUserSelectModal();
  if (!username) return;
  startRealtimeCases();
  // Start settings (users + locations)
  startRealtimeUsers();
  // Default tab
  showMainTab('cases');
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
  const locList = document.getElementById('location-list');
  const addLocBtn = document.getElementById('add-location-btn');
  if (!list || !addBtn || !menu || !btn || !locList || !addLocBtn) return;

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
        // Switch current user context and open their tasks
        username = name;
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
        if (!confirm(`Delete user '${name}'?`)) return;
        await deleteDoc(doc(db, 'users', d.id));
      });

      li.appendChild(nameBtn);
      li.appendChild(edit);
      li.appendChild(del);
      list.appendChild(li);
    }
    // Update composer assignee select with latest users
    populateComposerAssignees();
  });

  // Locations realtime
  const qLoc = query(collection(db, 'locations'), orderBy('name'));
  if (unsubLocations) { unsubLocations(); unsubLocations = null; }
  unsubLocations = onSnapshot(qLoc, (snap) => {
    locList.innerHTML = '';
    locationsCache = [];
    for (const d of snap.docs) {
      const data = d.data();
      const name = (data.name || '').trim() || 'Unnamed';
      locationsCache.push({ id: d.id, name });

      const li = document.createElement('li');
      const nameBtn = document.createElement('button');
      nameBtn.className = 'name icon-btn';
      nameBtn.textContent = name;

      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.textContent = '✏️';
      edit.setAttribute('aria-label', `Edit ${name}`);
      edit.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = (prompt('Edit location', name) || '').trim();
        if (!next || next === name) return;
        try {
          await updateDoc(doc(db, 'locations', d.id), { name: next });
        } catch (err) {
          console.error('Failed to update location', err);
          showToast('Failed to update location (permissions)');
        }
      });

      const del = document.createElement('button');
      del.className = 'icon-btn delete-btn';
      del.textContent = '🗑';
      del.setAttribute('aria-label', `Delete ${name}`);
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete location '${name}'?`)) return;
        try {
          await deleteDoc(doc(db, 'locations', d.id));
        } catch (err) {
          console.error('Failed to delete location', err);
          showToast('Failed to delete location (permissions)');
        }
      });

      li.appendChild(nameBtn);
      li.appendChild(edit);
      li.appendChild(del);
      locList.appendChild(li);
    }
    // Update case creation select with latest locations
    populateCaseLocationSelect();
  }, (err) => {
    console.error('Locations listener error', err);
    showToast('Cannot access locations (permissions)');
  });

  // Add location
  addLocBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = (prompt('Add location name') || '').trim();
    if (!name) return;
    try {
      await addDoc(collection(db, 'locations'), { name, createdAt: serverTimestamp() });
    } catch (err) {
      console.error('Failed to add location', err);
      showToast('Failed to add location (permissions)');
    }
  });
}

function populateCaseLocationSelect() {
  const sel = document.getElementById('case-location');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No location';
  sel.appendChild(none);
  for (const l of locationsCache) {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    sel.appendChild(opt);
  }
  sel.value = prev || '';
}

function openUser(name) {
  currentUserPageName = name;
  // Title with inline change link
  userTitleEl.innerHTML = `${name}'s tasks <button id="change-user-link" class="change-user-link" type="button">(Change user)</button>`;
  if (caseListSection) caseListSection.style.display = 'none';
  caseDetailEl.hidden = true;
  userDetailEl.hidden = false;
  // Bind change user link
  const changeBtn = document.getElementById('change-user-link');
  if (changeBtn) {
    changeBtn.addEventListener('click', async () => {
      const next = await showUserSelectModal();
      if (next && next !== username) {
        username = next;
        openUser(next);
      }
    }, { once: true });
  }
  // Restore last-used filters (multi-status, priority, sort) for this user
  const saved = userFilterByName.get(name);
  if (saved && typeof saved === 'object') {
    currentUserStatusSet = new Set(saved.statuses || ['open','in progress','complete']);
    currentUserPriorityFilter = saved.priority || 'all';
    currentUserSort = saved.sort || 'none';
    currentUserSearch = saved.search || '';
  } else {
    currentUserStatusSet = new Set(['open','in progress','complete']);
    currentUserPriorityFilter = 'all';
    currentUserSort = 'none';
    currentUserSearch = '';
  }
  // Reflect in controls
  if (userStatusEls.length) userStatusEls.forEach(cb => cb.checked = currentUserStatusSet.has(cb.value));
  if (userPriorityFilterEl) userPriorityFilterEl.value = currentUserPriorityFilter;
  if (userSortEl) userSortEl.value = currentUserSort;
  // Hydrate React toolbar
  document.dispatchEvent(new CustomEvent('userToolbar:hydrate', { detail: {
    statuses: Array.from(currentUserStatusSet),
    priority: currentUserPriorityFilter,
    sort: currentUserSort,
    search: currentUserSearch,
  }}));
  startRealtimeUserTasks(name);
}

function saveUserFilterState() {
  if (!currentUserPageName) return;
  userFilterByName.set(currentUserPageName, {
    statuses: Array.from(currentUserStatusSet),
    priority: currentUserPriorityFilter,
    sort: currentUserSort,
  });
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
        items.push({ taskId: d.id, text, status, assignee: dat.assignee || null, priority: dat.priority || null, caseId });
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
    if (currentUserStatusSet && currentUserStatusSet.size) items = items.filter(i => currentUserStatusSet.has(i.status));
    if (currentUserPriorityFilter !== 'all') items = items.filter(i => (i.priority || '') === currentUserPriorityFilter);
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
    const priVal = (p) => p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0;
    let sorted = [...items];
    if (currentUserSort === 'pri-desc') sorted.sort((a,b) => priVal(b.priority) - priVal(a.priority));
    else if (currentUserSort === 'pri-asc') sorted.sort((a,b) => priVal(a.priority) - priVal(b.priority));
    for (const it of sorted) {
      const li = document.createElement('li');
      const statusCls = it.status === 'in progress' ? 's-inprogress' : (it.status === 'complete' ? 's-complete' : 's-open');
      li.className = 'case-task ' + statusCls;
      // Status button
      const statusBtn = document.createElement('button'); statusBtn.type='button'; statusBtn.className='status-btn';
      const icon = (s)=> s==='complete'?'☑':(s==='in progress'?'◐':'☐');
      statusBtn.textContent = icon(it.status);
      statusBtn.setAttribute('aria-label', `Task status: ${it.status}`);
      statusBtn.addEventListener('click', async (e)=>{ e.stopPropagation(); const order=['open','in progress','complete']; const next=order[(order.indexOf(it.status)+1)%order.length]; try{ const {cipher, iv}= await encryptText(next); await updateDoc(doc(db,'cases',caseId,'tasks',it.taskId),{ statusCipher:cipher, statusIv:iv }); it.status=next; statusBtn.textContent=icon(next); statusBtn.setAttribute('aria-label',`Task status: ${next}`); li.className='case-task '+(next==='in progress'?'s-inprogress':(next==='complete'?'s-complete':'s-open')); } catch(err){ console.error('Failed to update status',err); showToast('Failed to update status'); } });
      const titleSpan = document.createElement('span'); titleSpan.className='task-text'; titleSpan.textContent=it.text;
      li.appendChild(statusBtn); li.appendChild(titleSpan);
      if (it.priority) { const pri=document.createElement('span'); pri.className='mini-chip'; pri.textContent=it.priority; li.appendChild(pri); }
      // Assignee avatar
      const av=document.createElement('span'); av.className='mini-avatar'; const initials= it.assignee? it.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase():''; av.textContent=initials||''; const col=colorForName(it.assignee||''); av.style.background=col.bg; av.style.color=col.color; av.style.border=`1px solid ${col.border}`;
      let tipEl=null; const removeTip=()=>{ if(tipEl){ tipEl.remove(); tipEl=null; } };
      av.addEventListener('mouseenter',()=>{ if(!it.assignee) return; tipEl=document.createElement('div'); tipEl.className='assignee-tip'; tipEl.textContent=it.assignee; tipEl.style.position='fixed'; tipEl.style.zIndex='2147483647'; document.body.appendChild(tipEl); const r=av.getBoundingClientRect(); requestAnimationFrame(()=>{ const h=tipEl.offsetHeight||24; tipEl.style.left=`${Math.round(r.left + r.width/2)}px`; tipEl.style.top=`${Math.round(r.top - 6 - h)}px`; tipEl.style.transform='translateX(-50%)'; }); });
      av.addEventListener('mouseleave', removeTip);
      av.addEventListener('click',(e)=>{ e.stopPropagation(); removeTip(); const existing=document.querySelector('.assignee-panel'); if(existing) existing.remove(); const panel=document.createElement('div'); panel.className='assignee-panel'; panel.style.position='fixed'; panel.style.zIndex='2147483646'; const addOpt=(label,value)=>{ const b=document.createElement('button'); b.type='button'; b.className='assignee-option'; b.textContent=label; b.addEventListener('click', async (ev)=>{ ev.stopPropagation(); try{ await updateDoc(doc(db,'cases',caseId,'tasks',it.taskId),{ assignee:value }); // If the task moves out of this user, remove from UI
        if (currentUserPageName && value !== currentUserPageName) { li.remove(); const current=parseInt(caseCard.querySelector('.badge')?.textContent||'1',10); if(!Number.isNaN(current)&&current>0) caseCard.querySelector('.badge').textContent=String(current-1); }
      } catch(err){ console.error('Failed to reassign',err); showToast('Failed to reassign'); } finally { panel.remove(); } }); panel.appendChild(b); };
      addOpt('Unassigned', null); for (const u of usersCache) addOpt(u.username,u.username); document.body.appendChild(panel); const r=av.getBoundingClientRect(); requestAnimationFrame(()=>{ const w=panel.offsetWidth||180; const left=Math.min(Math.max(8, r.right-w), window.innerWidth - w - 8); const top=Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6); panel.style.left=`${Math.round(left)}px`; panel.style.top=`${Math.round(top)}px`; }); const onDocClick=(evt)=>{ if(!panel || panel.contains(evt.target) || evt.target===av) return; panel.remove(); document.removeEventListener('click', onDocClick, true); }; setTimeout(()=>document.addEventListener('click', onDocClick, true),0); });
      li.appendChild(av);
      // Comments unobtrusive
      const toggle=document.createElement('button'); toggle.type='button'; toggle.className='icon-btn comment-toggle'; toggle.setAttribute('aria-label','Show comments'); toggle.textContent='💬'; const countEl=document.createElement('span'); countEl.className='badge comment-count'; li.appendChild(toggle); li.appendChild(countEl);
      const commentSection=document.createElement('div'); commentSection.className='comment-section'; commentSection.hidden=true; const commentsList=document.createElement('ul'); commentsList.className='comments'; commentSection.appendChild(commentsList); const commentForm=document.createElement('form'); commentForm.className='comment-form'; const commentInput=document.createElement('input'); commentInput.placeholder='Add comment'; commentForm.appendChild(commentInput); const commentBtn=document.createElement('button'); commentBtn.className='icon-btn add-comment-btn'; commentBtn.type='submit'; commentBtn.textContent='➕'; commentBtn.setAttribute('aria-label','Add comment'); commentForm.appendChild(commentBtn); commentSection.appendChild(commentForm);
      let commentsLoaded=false; let commentCount=0; const updateToggle=()=>{ countEl.textContent= commentCount>0? String(commentCount):''; toggle.textContent= commentSection.hidden? '💬':'✖'; toggle.setAttribute('aria-label', commentSection.hidden? 'Show comments':'Hide comments'); }; updateToggle();
      toggle.addEventListener('click', ()=>{ const h=commentSection.hidden; commentSection.hidden=!h; updateToggle(); if(h && !commentsLoaded){ startRealtimeComments(caseId, it.taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } });
      commentForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const t=commentInput.value.trim(); if(!t) return; const tempLi=document.createElement('li'); tempLi.className='optimistic'; const span=document.createElement('span'); span.textContent= username? `${username}: ${t}` : t; tempLi.appendChild(span); commentsList.appendChild(tempLi); commentInput.value=''; commentSection.hidden=false; updateToggle(); try{ const {cipher, iv}= await encryptText(t); await addDoc(collection(db,'cases',caseId,'tasks',it.taskId,'comments'), {cipher,iv,username,createdAt:serverTimestamp()}); if(!commentsLoaded){ startRealtimeComments(caseId, it.taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } } catch(err){ tempLi.classList.add('failed'); showToast('Failed to add comment'); } });
      li.appendChild(commentSection);
      ul.appendChild(li);
    }
    caseCard.appendChild(ul);
    userTaskListEl.appendChild(caseCard);
  }
}
