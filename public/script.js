let socket;
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

courseSelect.addEventListener('change', () => {
  const course = courseSelect.value;
  fetch(`/courses/${course}/select`, { method: 'POST' }).then(() => { devLog(`Selected course ${course}`); });
});

addNoteBtn.addEventListener('click', () => {
  socket.emit('addNote', { code: codeInput.value, note: noteInput.value });
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
    notesLog.innerHTML = '';
    data.notes.forEach(renderNote);
    refreshCourseList();
    devLog(`Course loaded ${data.course}`);
  });
  socket.on('noteAdded', note => {
    renderNote(note);
    devLog('Note added');
  });
}

function renderNote(note) {
  const div = document.createElement('div');
  div.className = 'noteItem';

  const ts = document.createElement('span');
  ts.className = 'timestamp';
  ts.textContent = `[${note.timestamp}]`;

  const text = document.createElement('span');
  text.textContent = ` ${note.code} - ${note.note}`;

  div.appendChild(ts);
  div.appendChild(text);
  notesLog.appendChild(div);
  notesLog.scrollTop = notesLog.scrollHeight;
}
