const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const csvWriter = require('csv-writer').createObjectCsvWriter;
const os = require('os');

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
      try { return JSON.stringify(a); } catch (e) { return String(a); }
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

const COURSES_DIR = path.join(__dirname, 'courses');
if (!fs.existsSync(COURSES_DIR)) {
  fs.mkdirSync(COURSES_DIR);
}

let currentCourse = null;
let notes = [];
let currentCodeText = '';

function loadCourse(course) {
  const file = path.join(COURSES_DIR, course, 'notes.json');
  if (fs.existsSync(file)) {
    notes = JSON.parse(fs.readFileSync(file));
  } else {
    notes = [];
  }
  currentCourse = course;
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
  const writer = csvWriter({ path: csvFile, header: [
    { id: 'timestamp', title: 'Timestamp' },
    { id: 'code', title: 'Code' },
    { id: 'note', title: 'Note' }
  ]});
  writer.writeRecords(notesData).then(() => {
    res.download(csvFile, 'notes.csv');
  });
});

io.on('connection', (socket) => {
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

  socket.on('addNote', data => {
    if (!currentCourse) {
      socket.emit('error', 'No course loaded');
      return;
    }

    const now = new Date();
    const frames = Math.floor(now.getMilliseconds() / 40); // approx 25fps
    const timestamp = now.toTimeString().split(' ')[0] + ':' + String(frames).padStart(2, '0');
    const note = { timestamp, code: data.code, note: data.note };

    notes.push(note);
    saveNotes();
    io.emit('noteAdded', note);
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

  socket.on('disconnect', () => {
    log('Client disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  const ip = getHostIp();
  log('Server listening on', `http://${ip}:${PORT}`);
});
