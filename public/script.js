let socket;
let currentCourse = null;
let notesArr = [];
let atemState = null;

function updateTimecode() {
  const now = new Date();
  const frames = Math.floor(now.getMilliseconds() / 40);
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
const courseSelectWrap = document.getElementById('courseSelectWrap');
const courseSelectTrigger = document.getElementById('courseSelectTrigger');
const courseSelectLabel = document.getElementById('courseSelectLabel');
const courseSelectMenu = document.getElementById('courseSelectMenu');
const newCourse = document.getElementById('newCourse');
const createCourse = document.getElementById('createCourse');
const addCourseBtn = document.getElementById('addCourseBtn');
const newCourseControls = document.getElementById('newCourseControls');
const addCourseWrapper = document.getElementById('addCourseWrapper');
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
const toggleNotesLog = document.getElementById('toggleNotesLog');
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
const toastContainer = document.getElementById('toastContainer');
const atemRecordToggleBtn = document.getElementById('atemRecordToggleBtn');
const atemStatusStripRecording = document.getElementById('atemStatusStripRecording');
const atemStatusStripConnection = document.getElementById('atemStatusStripConnection');
const atemIpInput = document.getElementById('atemIpInput');
const atemConnectBtn = document.getElementById('atemConnectBtn');
const atemDisconnectBtn = document.getElementById('atemDisconnectBtn');
const atemStatusText = document.getElementById('atemStatusText');
const atemSwitcherToggle = document.getElementById('atemSwitcherToggle');
const atemOutput4ToggleBtn = document.getElementById('atemOutput4ToggleBtn');
const atemSwitcherContent = document.getElementById('atemSwitcherContent');
const atemPanel = document.getElementById('atemPanel');
const atemPreviewRow = document.getElementById('atemPreviewRow');
const atemProgramRow = document.getElementById('atemProgramRow');
const recordFilenameInput = document.getElementById('recordFilenameInput');
const applyRecordNameBtn = document.getElementById('applyRecordNameBtn');

let batchMode = false;
const selected = new Set();
let atemSwitcherExpanded = false;

function closeCourseDropdown() {
  courseSelectMenu.classList.add('hidden');
  courseSelectTrigger.setAttribute('aria-expanded', 'false');
  courseSelectWrap.classList.remove('open');
}

function openCourseDropdown() {
  if (courseSelect.disabled) return;
  courseSelectMenu.classList.remove('hidden');
  courseSelectTrigger.setAttribute('aria-expanded', 'true');
  courseSelectWrap.classList.add('open');
}

function renderCourseDropdown(courses, current) {
  courseSelectMenu.innerHTML = '';
  courseSelectLabel.textContent = current || 'Select a course';

  if (courses.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'courseOption empty';
    empty.textContent = 'No courses available';
    courseSelectMenu.appendChild(empty);
    return;
  }

  courses.forEach(course => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'courseOption';
    option.textContent = course;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(course === current));
    if (course === current) {
      option.classList.add('selected');
    }
    option.addEventListener('click', () => {
      closeCourseDropdown();
      if (courseSelect.value === course) return;
      courseSelect.value = course;
      courseSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    courseSelectMenu.appendChild(option);
  });
}

function setNoActiveCourse() {
  currentCourse = null;
  notesArr = [];
  renderNotes();
  codeInput.disabled = true;
  noteInput.disabled = true;
  addNoteBtn.disabled = true;
  renameCourseBtn.disabled = true;
  deleteCourseBtn.disabled = true;
  syncAtemControlAvailability();
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
  syncAtemControlAvailability();
}

setNoActiveCourse();

toggleDevConsole.addEventListener('click', () => {
  devConsole.classList.toggle('show');
});

toggleNotesLog.addEventListener('click', () => {
  notesLog.classList.toggle('hidden');
  toggleNotesLog.textContent = notesLog.classList.contains('hidden') ? 'Show Log' : 'Hide Log';
});

courseSelectTrigger.addEventListener('click', e => {
  e.stopPropagation();
  newCourseControls.classList.add('hidden');
  courseMenu.classList.add('hidden');
  if (courseSelectMenu.classList.contains('hidden')) {
    openCourseDropdown();
  } else {
    closeCourseDropdown();
  }
});

courseMenuToggle.addEventListener('click', e => {
  e.stopPropagation();
  newCourseControls.classList.add('hidden');
  closeCourseDropdown();
  courseMenu.classList.toggle('hidden');
});

document.addEventListener('click', e => {
  if (!courseSelectWrap.contains(e.target)) {
    closeCourseDropdown();
  }
  if (!courseMenuWrapper.contains(e.target)) {
    courseMenu.classList.add('hidden');
  }
  if (!addCourseWrapper.contains(e.target)) {
    newCourseControls.classList.add('hidden');
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
  confirmOk.onclick = () => {
    hideModal(confirmModal);
    onOk();
  };
  confirmCancel.onclick = () => hideModal(confirmModal);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

function exitBatchMode() {
  batchMode = false;
  selected.clear();
  batchControls.classList.add('hidden');
  document.querySelectorAll('.noteActions').forEach(a => a.classList.remove('hidden'));
  document.querySelectorAll('.noteItem').forEach(n => n.classList.remove('selected'));
  document.querySelectorAll('.selectBox').forEach(cb => {
    cb.classList.add('hidden');
    cb.checked = false;
  });
}

function enterBatchMode() {
  batchMode = true;
  batchControls.classList.remove('hidden');
  document.querySelectorAll('.noteActions').forEach(a => a.classList.add('hidden'));
  document.querySelectorAll('.selectBox').forEach(cb => cb.classList.remove('hidden'));
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

function getInputLabel(inputId) {
  if (!atemState || !Array.isArray(atemState.inputs)) {
    return 'None';
  }
  const match = atemState.inputs.find(item => String(item.id) === String(inputId));
  return match ? match.label : 'None';
}

function setAtemSwitcherExpanded(expanded) {
  atemSwitcherExpanded = Boolean(expanded);
  atemSwitcherContent.classList.toggle('hidden', !atemSwitcherExpanded);
  atemSwitcherToggle.setAttribute('aria-expanded', String(atemSwitcherExpanded));
  atemSwitcherToggle.classList.toggle('is-open', atemSwitcherExpanded);
}

function syncAtemControlAvailability() {
  const connected = Boolean(atemState && atemState.connected);
  const bridgeAvailable = Boolean(atemState && atemState.bridgeAvailable);
  const recordAllowed = Boolean(currentCourse && connected);

  atemConnectBtn.disabled = false;
  atemDisconnectBtn.disabled = !connected;
  atemOutput4ToggleBtn.disabled = !connected;
  applyRecordNameBtn.disabled = !recordAllowed;
  atemRecordToggleBtn.disabled = !recordAllowed;
  recordFilenameInput.disabled = !recordAllowed;
  atemIpInput.disabled = !bridgeAvailable && connected;

  document.querySelectorAll('.atem-camera-btn.preview-row, .atem-camera-btn.program-row').forEach(button => {
    button.disabled = !connected;
  });
}

setAtemSwitcherExpanded(false);

function renderCameraRow(container, activeInputId, rowType) {
  container.innerHTML = '';

  for (let inputId = 1; inputId <= 6; inputId += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `atem-camera-btn ${rowType}-row`;
    button.textContent = `Cam ${inputId}`;

    if (String(activeInputId) === String(inputId)) {
      button.classList.add(rowType === 'preview' ? 'is-preview' : 'is-program');
    }

    if (rowType === 'preview') {
      button.addEventListener('click', () => {
        if (!socket) return;
        socket.emit('atemSetPreview', { inputId });
      });
    } else {
      button.addEventListener('click', () => {
        if (!socket) return;
        socket.emit('atemSetProgram', { inputId });
      });
    }

    container.appendChild(button);
  }

  syncAtemControlAvailability();
}

function renderAtemState(state) {
  atemState = state;
  atemIpInput.value = state.switcherIp || atemIpInput.value || '';

  if (state.recording && state.recording.isRecording) {
    atemStatusStripRecording.textContent = 'On';
    atemRecordToggleBtn.classList.add('is-recording');
  } else if (state.connected) {
    atemStatusStripRecording.textContent = 'Off';
    atemRecordToggleBtn.classList.remove('is-recording');
  } else {
    atemStatusStripRecording.textContent = 'Off';
    atemRecordToggleBtn.classList.remove('is-recording');
  }

  if (document.activeElement !== recordFilenameInput) {
    recordFilenameInput.value = state.recording && state.recording.filename ? state.recording.filename : '';
  }

  const statusParts = [];
  if (state.connected && state.switcherIp) {
    statusParts.push(state.switcherIp);
    atemStatusStripConnection.textContent = 'Connected';
    atemStatusStripConnection.classList.add('connected');
  } else if (!state.bridgeAvailable) {
    statusParts.push('Bridge unavailable');
    atemStatusStripConnection.textContent = 'ATEM bridge unavailable';
    atemStatusStripConnection.classList.remove('connected');
  } else {
    statusParts.push('Disconnected');
    atemStatusStripConnection.textContent = 'ATEM disconnected';
    atemStatusStripConnection.classList.remove('connected');
  }
  if (state.lastError) {
    statusParts.push(state.lastError);
  }
  if (state.recording && state.recording.isRecording) {
    statusParts.push(`REC ${state.recording.filename || 'unnamed'}`);
  } else if (state.recording && state.recording.filename) {
    statusParts.push(state.recording.filename);
  }
  atemStatusText.textContent = statusParts.join(' | ');

  if (state.output4 && state.output4.supported) {
    atemOutput4ToggleBtn.textContent = state.output4.mode === 'program' ? 'Program' : 'Multiview';
  } else {
    atemOutput4ToggleBtn.textContent = 'Output 4';
  }

  renderCameraRow(atemPreviewRow, state.previewInput, 'preview');
  renderCameraRow(atemProgramRow, state.programInput, 'program');
  syncAtemControlAvailability();
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
    renderCourseDropdown(data.courses, data.current);
    if (data.courses.length === 0) {
      courseSelectWrap.classList.add('hidden');
      noCourseText.classList.remove('hidden');
    } else {
      courseSelectWrap.classList.remove('hidden');
      noCourseText.classList.add('hidden');
    }
    if (data.current) {
      courseSelect.value = data.current;
      courseSelectLabel.textContent = data.current;
      if (socket && socket.connected && currentCourse !== data.current) {
        socket.emit('loadCourse', data.current);
      }
    } else {
      courseSelect.value = '';
      courseSelectLabel.textContent = 'Select a course';
      setNoActiveCourse();
    }
  });
}
refreshCourseList();

addCourseBtn.addEventListener('click', e => {
  e.stopPropagation();
  courseMenu.classList.add('hidden');
  closeCourseDropdown();
  newCourseControls.classList.toggle('hidden');
  if (!newCourseControls.classList.contains('hidden')) {
    newCourse.focus();
  }
});

createCourse.addEventListener('click', () => {
  const name = newCourse.value.trim();
  if (!name) return;
  fetch('/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(() => {
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
  }).then(() => {
    refreshCourseList();
    devLog(`Renamed course to ${newName}`);
  });
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
  fetch(`/courses/${course}/select`, { method: 'POST' }).then(() => {
    devLog(`Selected course ${course}`);
  });
});

codeInput.addEventListener('input', () => {
  if (socket) {
    socket.emit('codeUpdate', codeInput.value);
  }
});

function sendNote() {
  if (!currentCourse) return;
  socket.emit('addNote', {
    code: codeInput.value,
    note: noteInput.value
  });
  noteInput.value = '';
  devLog('Sent addNote');
}

addNoteBtn.addEventListener('click', sendNote);

noteInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendNote();
  }
});

exportCsv.addEventListener('click', () => {
  if (!currentCourse) return;
  window.location = `/courses/${currentCourse}/export`;
  devLog(`Export CSV for ${currentCourse}`);
});

deleteSelectedBtn.addEventListener('click', () => {
  if (selected.size === 0) return;
  const indices = Array.from(selected).sort((a, b) => a - b);
  socket.emit('deleteNotes', indices);
  exitBatchMode();
});

deselectAllBtn.addEventListener('click', () => {
  exitBatchMode();
});

atemConnectBtn.addEventListener('click', () => {
  socket.emit('atemConnect', { ipAddress: atemIpInput.value.trim() });
});

atemDisconnectBtn.addEventListener('click', () => {
  socket.emit('atemDisconnect');
});

applyRecordNameBtn.addEventListener('click', () => {
  socket.emit('atemSetFilename', { filename: recordFilenameInput.value.trim() });
});

atemRecordToggleBtn.addEventListener('click', () => {
  if (!atemState || !atemState.connected) return;
  if (atemState.recording && atemState.recording.isRecording) {
    socket.emit('atemStopRecording');
    return;
  }
  socket.emit('atemStartRecording', { filename: recordFilenameInput.value.trim() });
});

atemOutput4ToggleBtn.addEventListener('click', () => {
  if (!atemState || !atemState.connected) return;
  const mode = atemState.output4 && atemState.output4.mode === 'program' ? 'multiview' : 'program';
  socket.emit('atemSetOutput4Mode', { mode });
});

atemSwitcherToggle.addEventListener('click', () => {
  setAtemSwitcherExpanded(!atemSwitcherExpanded);
});

function initSocket(url) {
  socket = io(url);
  socket.on('error', message => {
    showAlert(message);
  });
  devLog(`Connecting to ${url}`);
  socket.on('log', devLog);
  socket.on('connect', () => {
    devLog('Connected to server');
    refreshCourseList();
    socket.emit('requestAtemState');
  });
  socket.on('courseLoaded', data => {
    setActiveCourse(data.course, data.notes);
    refreshCourseList();
    devLog(`Course loaded ${data.course}`);
    showToast(`Loaded course ${data.course}`);
  });
  socket.on('noActiveCourse', () => {
    setNoActiveCourse();
    refreshCourseList();
    devLog('No active course');
    showToast('No active course');
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
    showToast('Note edited');
  });
  socket.on('noteDeleted', index => {
    notesArr.splice(index, 1);
    renderNotes();
    devLog('Note deleted');
    showToast('Note deleted');
  });
  socket.on('notesDeleted', indices => {
    indices.sort((a, b) => b - a).forEach(i => notesArr.splice(i, 1));
    renderNotes();
    devLog('Notes deleted');
    showToast('Notes deleted');
  });
  socket.on('courseDeleted', course => {
    refreshCourseList();
    devLog(`Course deleted ${course}`);
    showToast(`Deleted course ${course}`);
  });
  socket.on('codeUpdate', value => {
    codeInput.value = value;
  });
  socket.on('atemState', state => {
    renderAtemState(state);
    devLog(`ATEM state updated (${state.connected ? 'connected' : 'disconnected'})`);
  });
  socket.on('atemCommandResult', payload => {
    if (!payload || !payload.message) return;
    showToast(payload.message);
    devLog(payload.message);
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
  text.textContent = note.code ? `${note.code} - ${note.note}` : note.note;

  const actions = document.createElement('span');
  actions.className = 'noteActions';
  const delBtn = document.createElement('span');
  delBtn.textContent = 'Delete';
  delBtn.style.cursor = 'pointer';
  delBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    showConfirm('Delete this note?', () => {
      socket.emit('deleteNote', index);
    });
  });
  actions.appendChild(delBtn);

  const selectBox = document.createElement('input');
  selectBox.type = 'checkbox';
  selectBox.className = 'selectBox hidden';
  if (selected.has(index)) selectBox.checked = true;
  selectBox.addEventListener('click', e => {
    e.stopPropagation();
    toggleSelection();
  });

  div.appendChild(selectBox);
  div.appendChild(ts);
  div.appendChild(text);
  div.appendChild(actions);
  notesLog.appendChild(div);
  notesLog.scrollTop = notesLog.scrollHeight;

  if (batchMode) {
    actions.classList.add('hidden');
    selectBox.classList.remove('hidden');
  }

  div.addEventListener('click', e => {
    if (batchMode) {
      toggleSelection();
      if (selected.size === 0) exitBatchMode();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      enterBatchMode();
      toggleSelection();
      return;
    }
    openEditNoteModal(note, index);
  });

  function toggleSelection() {
    if (selected.has(index)) {
      selected.delete(index);
      div.classList.remove('selected');
      selectBox.checked = false;
    } else {
      selected.add(index);
      div.classList.add('selected');
      selectBox.checked = true;
    }
  }
}
