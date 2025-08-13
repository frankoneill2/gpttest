const form = document.getElementById('note-form');
const input = document.getElementById('note-input');
const list = document.getElementById('notes-list');

function getNotes() {
  return JSON.parse(localStorage.getItem('notes') || '[]');
}

function saveNotes(notes) {
  localStorage.setItem('notes', JSON.stringify(notes));
}

function renderNotes() {
  const notes = getNotes();
  list.innerHTML = '';
  notes.forEach((note, index) => {
    const li = document.createElement('li');
    li.textContent = note;
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      notes.splice(index, 1);
      saveNotes(notes);
      renderNotes();
    });
    li.appendChild(del);
    list.appendChild(li);
  });
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const notes = getNotes();
  notes.push(text);
  saveNotes(notes);
  input.value = '';
  renderNotes();
});

window.addEventListener('DOMContentLoaded', renderNotes);
