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

function updateDate() {
  const now = new Date();
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  document.getElementById('currentDate').innerText = now.toLocaleDateString(undefined, opts);
}
updateDate();
setInterval(updateDate, 60 * 60 * 1000);

const courseSelect = document.getElementById('courseSelect');
const newCourse = document.getElementById('newCourse');
const createCourse = document.getElementById('createCourse');
const addCourseBtn = document.getElementById('addCourseBtn');
const newCourseControls = document.getElementById('newCourseControls');
const renameCourseBtn = document.getElementById('renameCourse');
const deleteCourseBtn = document.getElementById('deleteCourse');
const courseMenuToggle = document.getElementById('courseMenuToggle');
const courseMenu = document.getElementById('courseMenu');
const courseMenuWrapper = document.getElementById('courseMenuWrapper');
const noCourseText = document.getElementById('noCourseText');
const codeInput = document.getElementById('codeInput');
const noteInput = document.getElementById('noteInput');
const addNoteBtn = document.getElementById('addNote');
const notesLog = document.getElementById('notesLog');
const exportCsv = document.getElementById('exportCsv');
const ipAddress = document.getElementById('ipAddress');
const devConsole = document.getElementById('devConsole');
const devConsoleLog = document.getElementById('devConsoleLog');
const toggleDevConsole = document.getElementById('toggleDevConsole');
const renameModal = document.getElementById('renameModal');
const renameInput = document.getElementById('renameInput');
const renameOk = document.getElementById('renameOk');
const renameCancel = document.getElementById('renameCancel');
const confirmModal = document.getElementById('confirmModal');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOk = document.getElementById('confirmOk');
const confirmCancel = document.getElementById('confirmCancel');
const editNoteModal = document.getElementById('editNoteModal');
const editCodeInput = document.getElementById('editCodeInput');
const editNoteInput = document.getElementById('editNoteInput');
const editOk = document.getElementById('editOk');
const editCancel = document.getElementById('editCancel');
const alertModal = document.getElementById('alertModal');
const alertMessage = document.getElementById('alertMessage');
const alertOk = document.getElementById('alertOk');
const batchControls = document.getElementById('batchControls');
const deleteSelectedBtn = document.getElementById('deleteSelected');
const deselectAllBtn = document.getElementById('deselectAll');

let batchMode = false;
const selected = new Set();

function setNoActiveCourse() {
  currentCourse = null;
  notesArr = [];
  renderNotes();
  codeInput.disabled = true;
  noteInput.disabled = true;
  addNoteBtn.disabled = true;
  renameCourseBtn.disabled = true;
  deleteCourseBtn.disabled = true;
}

function setActiveCourse(course, notes) {
  currentCourse = course;
  if (Array.isArray(notes)) {
    notesArr = notes;
    renderNotes();
  }
  codeInput.disabled = false;
  noteInput.disabled = false;
  addNoteBtn.disabled = false;
  renameCourseBtn.disabled = false;
  deleteCourseBtn.disabled = false;
}

setNoActiveCourse();

toggleDevConsole.addEventListener('click', () => {
  devConsole.classList.toggle('show');
});

courseMenuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  courseMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!courseMenuWrapper.contains(e.target)) {
    courseMenu.classList.add('hidden');
  }
});

function devLog(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  devConsoleLog.appendChild(line);
  devConsoleLog.scrollTop = devConsoleLog.scrollHeight;
}

function showModal(modal) {
  modal.classList.add('show');
}

function hideModal(modal) {
  modal.classList.remove('show');
}

function showAlert(message) {
  alertMessage.textContent = message;
  showModal(alertModal);
  alertOk.onclick = () => hideModal(alertModal);
}

function showConfirm(message, onOk) {
  confirmMessage.textContent = message;
  showModal(confirmModal);
  confirmOk.onclick = () => { hideModal(confirmModal); onOk(); };
  confirmCancel.onclick = () => hideModal(confirmModal);
}

function exitBatchMode() {
  batchMode = false;
  selected.clear();
  batchControls.classList.add('hidden');
  document.querySelectorAll('.noteActions').forEach(a => a.classList.remove('hidden'));
  document.querySelectorAll('.noteItem').forEach(n => n.classList.remove('selected'));
}

function enterBatchMode() {
  batchMode = true;
  batchControls.classList.remove('hidden');
  document.querySelectorAll('.noteActions').forEach(a => a.classList.add('hidden'));
}

let editIndex = null;
function openEditNoteModal(note, index) {
  editIndex = index;
  editCodeInput.value = note.code;
  editNoteInput.value = note.note;
  showModal(editNoteModal);
}

editOk.addEventListener('click', () => {
  if (editIndex === null) return;
  socket.emit('editNote', {
    index: editIndex,
    code: editCodeInput.value,
    note: editNoteInput.value
  });
  hideModal(editNoteModal);
  editIndex = null;
});

editCancel.addEventListener('click', () => {
  hideModal(editNoteModal);
  editIndex = null;
});

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
    if (data.courses.length === 0) {
      courseSelect.classList.add('hidden');
      noCourseText.classList.remove('hidden');
    } else {
      courseSelect.classList.remove('hidden');
      noCourseText.classList.add('hidden');
    }
    if (data.current) {
      courseSelect.value = data.current;
    } else {
      courseSelect.value = '';
      setNoActiveCourse();
    }
  });
}
refreshCourseList();

addCourseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  newCourseControls.classList.toggle('hidden');
  if (!newCourseControls.classList.contains('hidden')) {
    newCourse.focus();
  }
});

createCourse.addEventListener('click', () => {
  const name = newCourse.value.trim();
  if (!name) return;
  fetch('/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    .then(() => {
      newCourse.value = '';
      newCourseControls.classList.add('hidden');
      refreshCourseList();
      devLog(`Created course ${name}`);
    });
});

renameCourseBtn.addEventListener('click', () => {
  if (!currentCourse) return;
  courseMenu.classList.add('hidden');
  renameInput.value = currentCourse;
  showModal(renameModal);
});

renameOk.addEventListener('click', () => {
  const newName = renameInput.value.trim();
  hideModal(renameModal);
  if (!newName) return;
  fetch(`/courses/${currentCourse}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  }).then(() => { refreshCourseList(); devLog(`Renamed course to ${newName}`); });
});
renameCancel.addEventListener('click', () => hideModal(renameModal));

deleteCourseBtn.addEventListener('click', () => {
  if (!currentCourse) return;
  courseMenu.classList.add('hidden');
  showConfirm(`Delete course ${currentCourse}?`, () => {
    fetch(`/courses/${currentCourse}`, { method: 'DELETE' })
      .then(() => {
        setNoActiveCourse();
        refreshCourseList();
        devLog('Course deleted');
      });
  });
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

deleteSelectedBtn.addEventListener('click', () => {
  if (selected.size === 0) return;
  const indices = Array.from(selected).sort((a,b) => a - b);
  socket.emit('deleteNotes', indices);
  exitBatchMode();
});

deselectAllBtn.addEventListener('click', () => {
  exitBatchMode();
});

function initSocket(url) {
  socket = io(url);
  socket.on('error', message => {
    showAlert(message);
  });
  devLog(`Connecting to ${url}`);
  socket.on('log', devLog);
  socket.on('connect', () => devLog('Connected to server'));
  socket.on('courseLoaded', data => {
    setActiveCourse(data.course, data.notes);
    refreshCourseList();
    devLog(`Course loaded ${data.course}`);
  });
  socket.on('noActiveCourse', () => {
    setNoActiveCourse();
    refreshCourseList();
    devLog('No active course');
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
  socket.on('notesDeleted', indices => {
    indices.sort((a,b) => b - a).forEach(i => notesArr.splice(i,1));
    renderNotes();
    devLog('Notes deleted');
  });
  socket.on('codeUpdate', value => {
    codeInput.value = value;
  });
  socket.on('error', message => {
    showAlert(message);
  });
}

function renderNotes() {
  notesLog.innerHTML = '';
  notesArr.forEach((n, i) => renderNote(n, i));
}

function renderNote(note, index) {
  const div = document.createElement('div');
  div.className = 'noteItem';
  div.dataset.index = index;
  if (selected.has(index)) {
    div.classList.add('selected');
  }

  const ts = document.createElement('span');
  ts.className = 'timestamp';
  ts.textContent = `[${note.timestamp}]`;

  const text = document.createElement('span');
  text.className = 'noteText';
  text.textContent = ` ${note.code} - ${note.note}`;

  const actions = document.createElement('span');
  actions.className = 'noteActions';
  const delBtn = document.createElement('span');
  delBtn.textContent = '🗑️';
  delBtn.style.cursor = 'pointer';
  delBtn.style.marginLeft = '10px';
  delBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    showConfirm('Delete this note?', () => {
      socket.emit('deleteNote', index);
    });
  });
  actions.appendChild(delBtn);

  div.appendChild(ts);
  div.appendChild(text);
  div.appendChild(actions);
  notesLog.appendChild(div);
  notesLog.scrollTop = notesLog.scrollHeight;

  if (batchMode) {
    actions.classList.add('hidden');
  }

  div.addEventListener('click', (e) => {
if (e.shiftKey && !batchMode) {
  enterBatchMode();
}

if (batchMode) {
  if (selected.has(index)) {
    selected.delete(index);
    div.classList.remove('selected');
  } else {
    selected.add(index);
    div.classList.add('selected');
  }
  return;
}

openEditNoteModal(note, index);
  });
}
