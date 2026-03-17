const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const csvWriter = require('csv-writer').createObjectCsvWriter;
const os = require('os');
const { loadConfig, saveConfig } = require('./lib/app-config');
const { AtemBridgeClient } = require('./lib/atem-bridge-client');
const { SerialTaskQueue } = require('./lib/serial-task-queue');
const {
  createAtemNote,
  createDefaultAtemState,
  createTimestamp,
  generateRecordingBaseName,
  labelForInput
} = require('./lib/atem-utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function getHostIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function log(...args) {
  console.log(...args);
  const msg = args.map(a => {
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a);
      } catch (error) {
        return String(a);
      }
    }
    return String(a);
  }).join(' ');
  io.emit('log', msg);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/ip', (req, res) => {
  res.json({ ip: getHostIp() });
});

const COURSES_DIR = process.env.COURSES_DIR || path.join(process.cwd(), 'courses');
if (!fs.existsSync(COURSES_DIR)) {
  fs.mkdirSync(COURSES_DIR);
}

let currentCourse = null;
let notes = [];
let currentCodeText = '';
let config = loadConfig();
let atemState = createDefaultAtemState({
  switcherIp: config.atem.switcherIp
});
let atemFilenameBase = '';
const atemQueue = new SerialTaskQueue();
const atemBridge = new AtemBridgeClient({
  port: config.atem.bridgePort,
  log
});

function saveConfigState() {
  saveConfig(config);
}

function emitAtemState(target = io) {
  target.emit('atemState', {
    ...atemState,
    recording: {
      ...atemState.recording,
      filename: atemFilenameBase || atemState.recording.filename || ''
    }
  });
}

function emitAtemToast(target, type, message) {
  target.emit('atemCommandResult', { type, message });
}

function loadCourse(course) {
  const file = path.join(COURSES_DIR, course, 'notes.json');
  if (fs.existsSync(file)) {
    notes = JSON.parse(fs.readFileSync(file));
  } else {
    notes = [];
  }
  currentCourse = course;
  emitAtemState();
  log(`Loaded course ${course} with ${notes.length} notes`);
}

function saveNotes() {
  if (!currentCourse) return;
  const dir = path.join(COURSES_DIR, currentCourse);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'notes.json');
  fs.writeFileSync(file, JSON.stringify(notes, null, 2));
  log(`Saved ${notes.length} notes for course ${currentCourse}`);
}

function addNote(note, shouldBroadcast = true) {
  notes.push(note);
  saveNotes();
  if (shouldBroadcast) {
    io.emit('noteAdded', note);
  }
}

function addAutomaticAtemNote(message) {
  if (!currentCourse) return;
  const note = createAtemNote(message, new Date());
  addNote(note, true);
  log('ATEM note added', note);
}

function syncDerivedFilename() {
  if (!currentCourse) {
    atemFilenameBase = '';
  }
  emitAtemState();
}

async function refreshAtemState() {
  try {
    const bridgeAvailable = await atemBridge.ensureHelper();
    if (!bridgeAvailable) {
      atemState = createDefaultAtemState({
        bridgeAvailable: false,
        switcherIp: config.atem.switcherIp,
        lastError: 'ATEM bridge helper unavailable'
      });
      emitAtemState();
      return atemState;
    }

    const bridgeState = await atemBridge.getState();
    atemState = {
      ...createDefaultAtemState(),
      ...bridgeState,
      bridgeAvailable: true,
      switcherIp: bridgeState.switcherIp || config.atem.switcherIp || ''
    };

    if (!atemFilenameBase) {
      atemFilenameBase = atemState.recording.filename || '';
    }

    emitAtemState();
    return atemState;
  } catch (error) {
    atemState = {
      ...atemState,
      bridgeAvailable: false,
      connected: false,
      lastError: error.message
    };
    emitAtemState();
    return atemState;
  }
}

async function executeAtemCommand(socket, label, action, options = {}) {
  return atemQueue.enqueue(async () => {
    try {
      const result = await action();
      await refreshAtemState();
      if (options.successMessage) {
        emitAtemToast(socket, 'success', options.successMessage);
      }
      return result;
    } catch (error) {
      atemState = {
        ...atemState,
        lastError: error.message
      };
      emitAtemState();
      emitAtemToast(socket, 'error', `${label} failed: ${error.message}`);
      throw error;
    }
  });
}

function ensureRecordActionsAllowed() {
  if (!currentCourse) {
    const error = new Error('Select a course before using recording controls');
    error.code = 'NO_COURSE';
    throw error;
  }
}

app.get('/courses', (req, res) => {
  const courses = fs.readdirSync(COURSES_DIR).filter(f => fs.lstatSync(path.join(COURSES_DIR, f)).isDirectory());
  res.json({ courses, current: currentCourse });
});

app.post('/courses', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const dir = path.join(COURSES_DIR, name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  loadCourse(name);
  atemFilenameBase = generateRecordingBaseName(name, new Date());
  saveNotes();
  io.emit('courseLoaded', { course: name, notes });
  log(`courseLoaded emitted for ${name}`);
  res.json({ course: name });
});

app.post('/courses/:course/select', (req, res) => {
  const course = req.params.course;
  const dir = path.join(COURSES_DIR, course);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not found' });
  loadCourse(course);
  io.emit('courseLoaded', { course, notes });
  log(`courseLoaded emitted for ${course}`);
  res.json({ course });
});

app.post('/courses/:course/rename', (req, res) => {
  const course = req.params.course;
  const newName = req.body.name;
  if (!newName) return res.status(400).json({ error: 'name required' });
  const dir = path.join(COURSES_DIR, course);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not found' });
  const newDir = path.join(COURSES_DIR, newName);
  fs.renameSync(dir, newDir);
  if (currentCourse === course) {
    loadCourse(newName);
    io.emit('courseLoaded', { course: newName, notes });
  }
  log(`Renamed course ${course} to ${newName}`);
  res.json({ course: newName });
});

app.delete('/courses/:course', (req, res) => {
  const course = req.params.course;
  const dir = path.join(COURSES_DIR, course);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not found' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (currentCourse === course) {
    currentCourse = null;
    notes = [];
    syncDerivedFilename();
    io.emit('noActiveCourse');
  }
  io.emit('courseDeleted', course);
  log(`Deleted course ${course}`);
  res.json({});
});

app.get('/courses/:course/export', (req, res) => {
  const course = req.params.course;
  const file = path.join(COURSES_DIR, course, 'notes.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  const notesData = JSON.parse(fs.readFileSync(file));
  const csvFile = path.join(COURSES_DIR, course, 'notes.csv');
  const writer = csvWriter({
    path: csvFile,
    header: [
      { id: 'timestamp', title: 'Timestamp' },
      { id: 'code', title: 'Code' },
      { id: 'note', title: 'Note' }
    ]
  });
  writer.writeRecords(notesData).then(() => {
    res.download(csvFile, 'notes.csv');
  });
});

app.get('/atem/state', (req, res) => {
  res.json({
    ...atemState,
    recording: {
      ...atemState.recording,
      filename: atemFilenameBase || atemState.recording.filename || ''
    }
  });
});

app.post('/atem/connect', async (req, res) => {
  const { ipAddress } = req.body;
  if (!ipAddress) {
    return res.status(400).json({ error: 'ipAddress required' });
  }

  try {
    await executeAtemCommand(io, 'Connect', async () => {
      config.atem.switcherIp = ipAddress;
      saveConfigState();
      await atemBridge.connect(ipAddress);
    });
    res.json(atemState);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

io.on('connection', socket => {
  log('Client connected', socket.id);
  if (currentCourse) {
    socket.emit('courseLoaded', { course: currentCourse, notes });
    log(`Sent courseLoaded to ${socket.id} for ${currentCourse}`);
  } else {
    socket.emit('noActiveCourse');
  }
  if (currentCodeText) {
    socket.emit('codeUpdate', currentCodeText);
  }
  emitAtemState(socket);

  socket.on('addNote', data => {
    if (!currentCourse) {
      socket.emit('error', 'No course loaded');
      return;
    }

    const note = {
      timestamp: createTimestamp(new Date()),
      code: data.code,
      note: data.note
    };

    addNote(note, true);
    log(`Added note to ${currentCourse}`, note);
  });

  socket.on('editNote', data => {
    if (typeof data.index !== 'number' || !notes[data.index]) return;
    notes[data.index].code = data.code;
    notes[data.index].note = data.note;
    saveNotes();
    io.emit('noteEdited', { index: data.index, note: notes[data.index] });
    log(`Edited note ${data.index} in ${currentCourse}`);
  });

  socket.on('deleteNote', index => {
    if (typeof index !== 'number' || !notes[index]) return;
    notes.splice(index, 1);
    saveNotes();
    io.emit('noteDeleted', index);
    log(`Deleted note ${index} from ${currentCourse}`);
  });

  socket.on('deleteNotes', indices => {
    if (!Array.isArray(indices)) return;
    const unique = [...new Set(indices.filter(i => typeof i === 'number' && notes[i]))]
      .sort((a, b) => b - a);
    if (unique.length === 0) return;
    const removed = [];
    for (const idx of unique) {
      if (notes[idx]) {
        notes.splice(idx, 1);
        removed.push(idx);
      }
    }
    if (removed.length > 0) {
      saveNotes();
      io.emit('notesDeleted', removed);
      log(`Deleted notes ${removed.join(',')} from ${currentCourse}`);
    }
  });

  socket.on('loadCourse', course => {
    if (fs.existsSync(path.join(COURSES_DIR, course))) {
      loadCourse(course);
      socket.emit('courseLoaded', { course, notes });
      socket.broadcast.emit('courseLoaded', { course, notes });
      log(`Socket ${socket.id} switched to course ${course}`);
    }
  });

  socket.on('codeUpdate', value => {
    currentCodeText = value;
    socket.broadcast.emit('codeUpdate', value);
    log('codeUpdate', value);
  });

  socket.on('requestAtemState', () => {
    emitAtemState(socket);
  });

  socket.on('atemConnect', async payload => {
    const ipAddress = (payload && payload.ipAddress ? String(payload.ipAddress) : '').trim();
    if (!ipAddress) {
      emitAtemToast(socket, 'error', 'Enter the ATEM IP address first');
      return;
    }

    try {
      await executeAtemCommand(socket, 'Connect', async () => {
        config.atem.switcherIp = ipAddress;
        saveConfigState();
        await atemBridge.connect(ipAddress);
      }, {
        successMessage: `Connected to ATEM at ${ipAddress}`
      });
    } catch (error) {
      log('ATEM connect failed', error.message);
    }
  });

  socket.on('atemDisconnect', async () => {
    try {
      await executeAtemCommand(socket, 'Disconnect', async () => {
        await atemBridge.disconnect();
      }, {
        successMessage: 'Disconnected from ATEM'
      });
    } catch (error) {
      log('ATEM disconnect failed', error.message);
    }
  });

  socket.on('atemSetPreview', async payload => {
    const inputId = payload && payload.inputId;
    if (inputId == null) return;

    try {
      await executeAtemCommand(socket, 'Set preview', async () => {
        await atemBridge.setPreviewInput(inputId);
      }, {
        successMessage: `Preview set to ${labelForInput(atemState, inputId)}`
      });
    } catch (error) {
      log('ATEM preview failed', error.message);
    }
  });

  socket.on('atemSetProgram', async payload => {
    const inputId = payload && payload.inputId;
    if (inputId == null) return;

    try {
      await executeAtemCommand(socket, 'Set program', async () => {
        await atemBridge.setProgramInput(inputId);
      }, {
        successMessage: `Program set to ${labelForInput(atemState, inputId)}`
      });
    } catch (error) {
      log('ATEM program failed', error.message);
    }
  });

  socket.on('atemCut', async () => {
    try {
      await executeAtemCommand(socket, 'Cut', async () => {
        await atemBridge.performCut();
      }, {
        successMessage: `Cut to ${labelForInput(atemState, atemState.programInput)}`
      });
    } catch (error) {
      log('ATEM cut failed', error.message);
    }
  });

  socket.on('atemAuto', async () => {
    try {
      await executeAtemCommand(socket, 'Auto transition', async () => {
        await atemBridge.performAuto();
      }, {
        successMessage: `Auto transition to ${labelForInput(atemState, atemState.programInput)}`
      });
    } catch (error) {
      log('ATEM auto failed', error.message);
    }
  });

  socket.on('atemSetFilename', async payload => {
    const filename = (payload && payload.filename ? String(payload.filename) : '').trim();
    if (!filename) {
      emitAtemToast(socket, 'error', 'Enter a recording filename');
      return;
    }

    try {
      ensureRecordActionsAllowed();
      atemFilenameBase = filename;
      await executeAtemCommand(socket, 'Set filename', async () => {
        await atemBridge.setRecordingFilename(filename);
      }, {
        successMessage: `Recording filename set to ${filename}`
      });
    } catch (error) {
      log('ATEM filename failed', error.message);
    }
  });

  socket.on('atemStartRecording', async payload => {
    const filename = (payload && payload.filename ? String(payload.filename) : atemFilenameBase).trim();
    if (!filename) {
      emitAtemToast(socket, 'error', 'Recording filename is required');
      return;
    }

    try {
      ensureRecordActionsAllowed();
      atemFilenameBase = filename;
      await executeAtemCommand(socket, 'Start recording', async () => {
        await atemBridge.setRecordingFilename(filename);
        await atemBridge.startRecording();
      }, {
        successMessage: `Recording started: ${filename}`
      });
      addAutomaticAtemNote(`Recording started (${filename})`);
    } catch (error) {
      log('ATEM start recording failed', error.message);
    }
  });

  socket.on('atemStopRecording', async () => {
    try {
      ensureRecordActionsAllowed();
      await executeAtemCommand(socket, 'Stop recording', async () => {
        await atemBridge.stopRecording();
      }, {
        successMessage: 'Recording stopped'
      });
      addAutomaticAtemNote(`Recording stopped (${atemFilenameBase || atemState.recording.filename || 'unnamed'})`);
      emitAtemState();
    } catch (error) {
      log('ATEM stop recording failed', error.message);
    }
  });

  socket.on('atemSetOutput4Mode', async payload => {
    const mode = payload && payload.mode === 'program' ? 'program' : payload && payload.mode === 'multiview' ? 'multiview' : '';
    if (!mode) {
      emitAtemToast(socket, 'error', 'Choose program or multiview for Output 4');
      return;
    }

    try {
      await executeAtemCommand(socket, 'Set output 4 mode', async () => {
        await atemBridge.setOutput4Mode(mode);
      }, {
        successMessage: `Output 4 set to ${mode === 'program' ? 'Fullscreen Program' : 'Multiview'}`
      });
    } catch (error) {
      log('ATEM output 4 mode failed', error.message);
    }
  });

  socket.on('disconnect', () => {
    log('Client disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  const ip = getHostIp();
  log('Server listening on', `http://${ip}:${PORT}`);
  await refreshAtemState();
  if (config.atem.switcherIp) {
    try {
      await executeAtemCommand(io, 'Auto-connect', async () => {
        await atemBridge.connect(config.atem.switcherIp);
      });
    } catch (error) {
      log('ATEM auto-connect skipped', error.message);
    }
  }
});

setInterval(() => {
  refreshAtemState().catch(error => {
    log('ATEM state refresh failed', error.message);
  });
}, 2000);
