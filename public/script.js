let socket;
let currentCourse = null;
let notesArr = [];

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
const renameCourseBtn = document.getElementById('renameCourse');
const deleteCourseBtn = document.getElementById('deleteCourse');
const codeInput = document.getElementById('codeInput');
const noteInput = document.getElementById('noteInput');
const addNoteBtn = document.getElementById('addNote');
const notesLog = document.getElementById('notesLog');
const exportCsv = document.getElementById('exportCsv');
const ipAddress = document.getElementById('ipAddress');
const devConsole = document.getElementById('devConsole');
const devConsoleLog = document.getElementById('devConsoleLog');
const toggleDevConsole = document.getElementById('toggleDevConsole');

toggleDevConsole.addEventListener('click', () => {
  devConsole.classList.toggle('show');
});

function devLog(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  devConsoleLog.appendChild(line);
  devConsoleLog.scrollTop = devConsoleLog.scrollHeight;
}

fetch('/ip')
  .then(r => r.json())
  .then(data => {
    ipAddress.textContent = data.ip;
    const url = `http://${data.ip}:4000`;
    initSocket(url);
  });

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
    .then(() => { newCourse.value = ''; refreshCourseList(); devLog(`Created course ${name}`); });
});

renameCourseBtn.addEventListener('click', () => {
  if (!currentCourse) return;
  const newName = prompt('Enter new course name', currentCourse);
  if (!newName) return;
  fetch(`/courses/${currentCourse}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  }).then(() => { refreshCourseList(); devLog(`Renamed course to ${newName}`); });
});

deleteCourseBtn.addEventListener('click', () => {
  if (!currentCourse) return;
  if (!confirm(`Delete course ${currentCourse}?`)) return;
  fetch(`/courses/${currentCourse}`, { method: 'DELETE' })
    .then(() => { currentCourse = null; notesArr = []; renderNotes(); refreshCourseList(); devLog('Course deleted'); });
});

courseSelect.addEventListener('change', () => {
  const course = courseSelect.value;
  fetch(`/courses/${course}/select`, { method: 'POST' }).then(() => { devLog(`Selected course ${course}`); });
});

codeInput.addEventListener('input', () => {
  if (socket) {
    socket.emit('codeUpdate', codeInput.value);
  }
});

addNoteBtn.addEventListener('click', () => {
  if (!currentCourse) return;
  socket.emit('addNote', {
    code: codeInput.value,
    note: noteInput.value
  });
  codeInput.value = '';
  noteInput.value = '';
  devLog('Sent addNote');
});

exportCsv.addEventListener('click', () => {
  if (!currentCourse) return;
  window.location = `/courses/${currentCourse}/export`;
  devLog(`Export CSV for ${currentCourse}`);
});

function initSocket(url) {
  socket = io(url);
  devLog(`Connecting to ${url}`);
  socket.on('log', devLog);
  socket.on('connect', () => devLog('Connected to server'));
  socket.on('courseLoaded', data => {
    currentCourse = data.course;
    notesArr = data.notes;
    renderNotes();
    refreshCourseList();
    devLog(`Course loaded ${data.course}`);
  });
  socket.on('noteAdded', note => {
    notesArr.push(note);
    renderNotes();
    devLog('Note added');
  });
  socket.on('noteEdited', data => {
    notesArr[data.index] = data.note;
    renderNotes();
    devLog('Note edited');
  });
  socket.on('noteDeleted', index => {
    notesArr.splice(index, 1);
    renderNotes();
    devLog('Note deleted');
  });
  socket.on('codeUpdate', value => {
    codeInput.value = value;
  });
}

socket.on('error', message => {
  alert(message);
});

function renderNotes() {
  notesLog.innerHTML = '';
  notesArr.forEach((n, i) => renderNote(n, i));
}

function renderNote(note, index) {
  const div = document.createElement('div');
  div.className = 'noteItem';
  div.dataset.index = index;

  const ts = document.createElement('span');
  ts.className = 'timestamp';
  ts.textContent = `[${note.timestamp}]`;

  const text = document.createElement('span');
  text.textContent = ` ${note.code} - ${note.note}`;

  const actions = document.createElement('span');
  actions.className = 'noteActions';
  const editBtn = document.createElement('span');
  editBtn.textContent = '✏️';
  editBtn.style.cursor = 'pointer';
  editBtn.addEventListener('click', () => {
    const newCode = prompt('Edit code', note.code);
    if (newCode === null) return;
    const newNote = prompt('Edit note', note.note);
    if (newNote === null) return;
    socket.emit('editNote', { index, code: newCode, note: newNote });
  });
  const delBtn = document.createElement('span');
  delBtn.textContent = '🗑️';
  delBtn.style.cursor = 'pointer';
  delBtn.style.marginLeft = '10px';
  delBtn.addEventListener('click', () => {
    if (confirm('Delete this note?')) {
      socket.emit('deleteNote', index);
    }
  });
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  div.appendChild(ts);
  div.appendChild(text);
  div.appendChild(actions);
  notesLog.appendChild(div);
  notesLog.scrollTop = notesLog.scrollHeight;
}
