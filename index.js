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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/ip', (req, res) => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return res.json({ ip: iface.address });
      }
    }
  }
  res.json({ ip: 'unknown' });
});

const COURSES_DIR = path.join(__dirname, 'courses');
if (!fs.existsSync(COURSES_DIR)) {
  fs.mkdirSync(COURSES_DIR);
}

let currentCourse = null;
let notes = [];

function loadCourse(course) {
  const file = path.join(COURSES_DIR, course, 'notes.json');
  if (fs.existsSync(file)) {
    notes = JSON.parse(fs.readFileSync(file));
  } else {
    notes = [];
  }
  currentCourse = course;
  console.log(`Loaded course ${course} with ${notes.length} notes`);
}

function saveNotes() {
  if (!currentCourse) return;
  const dir = path.join(COURSES_DIR, currentCourse);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'notes.json');
  fs.writeFileSync(file, JSON.stringify(notes, null, 2));
  console.log(`Saved ${notes.length} notes for course ${currentCourse}`);
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
  console.log(`courseLoaded emitted for ${name}`);
  res.json({ course: name });
});

app.post('/courses/:course/select', (req, res) => {
  const course = req.params.course;
  const dir = path.join(COURSES_DIR, course);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not found' });
  loadCourse(course);
  io.emit('courseLoaded', { course, notes });
  console.log(`courseLoaded emitted for ${course}`);
  res.json({ course });
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
  if (currentCourse) {
    socket.emit('courseLoaded', { course: currentCourse, notes });
    console.log(`Sent courseLoaded to ${socket.id} for ${currentCourse}`);
  }

  socket.on('addNote', data => {
    if (!currentCourse) {
      socket.emit('error', 'No course loaded');
      return;
    }

    const note = {
      timestamp: new Date().toISOString(),
      code: data.code,
      note: data.note
    };
    notes.push(note);
    saveNotes();
    io.emit('noteAdded', note);
    console.log(`Added note to ${currentCourse}`, note);
  });

  socket.on('loadCourse', course => {
    if (fs.existsSync(path.join(COURSES_DIR, course))) {
      loadCourse(course);
      socket.emit('courseLoaded', { course, notes });
      socket.broadcast.emit('courseLoaded', { course, notes });
      console.log(`Socket ${socket.id} switched to course ${course}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server listening on', PORT);
});
