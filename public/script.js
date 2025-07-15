const socket = io();
let currentCourse = null;

function updateTimecode() {
  const now = new Date();
  const frames = Math.floor(now.getMilliseconds() / 40); // approx 25fps
  const tc = now.toTimeString().split(' ')[0] + ':' + String(frames).padStart(2, '0');
  document.getElementById('timecode').innerText = tc;
}
setInterval(updateTimecode, 40);

const courseSelect = document.getElementById('courseSelect');
const newCourse = document.getElementById('newCourse');
const createCourse = document.getElementById('createCourse');
const codeInput = document.getElementById('codeInput');
const noteInput = document.getElementById('noteInput');
const addNoteBtn = document.getElementById('addNote');
const notesLog = document.getElementById('notesLog');
const exportCsv = document.getElementById('exportCsv');

function refreshCourseList() {
  fetch('/courses').then(r => r.json()).then(data => {
    courseSelect.innerHTML = data.courses.map(c => `<option value="${c}">${c}</option>`).join('');
    if (data.current) courseSelect.value = data.current;
  });
}
refreshCourseList();

createCourse.addEventListener('click', () => {
  const name = newCourse.value.trim();
  if (!name) return;
  fetch('/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    .then(() => { newCourse.value = ''; refreshCourseList(); });
});

courseSelect.addEventListener('change', () => {
  const course = courseSelect.value;
  fetch(`/courses/${course}/select`, { method: 'POST' }).then(() => {});
});

addNoteBtn.addEventListener('click', () => {
  socket.emit('addNote', { code: codeInput.value, note: noteInput.value });
  codeInput.value = '';
  noteInput.value = '';
});

exportCsv.addEventListener('click', () => {
  if (!currentCourse) return;
  window.location = `/courses/${currentCourse}/export`;
});

socket.on('courseLoaded', data => {
  currentCourse = data.course;
  notesLog.innerHTML = '';
  data.notes.forEach(renderNote);
  refreshCourseList();
});

socket.on('noteAdded', note => {
  renderNote(note);
});

function renderNote(note) {
  const div = document.createElement('div');
  div.className = 'noteItem';
  div.textContent = `[${note.timestamp}] ${note.code} - ${note.note}`;
  notesLog.appendChild(div);
  notesLog.scrollTop = notesLog.scrollHeight;
}
