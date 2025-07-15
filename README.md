# Timeslate

A simple production note logging app with realtime sync.

## Features
- Displays a timecode based on the system time.
- Input fields for `Code` and `Production Notes`.
- Notes are stored by course (project) and synced in realtime across clients.
- Export notes to CSV.

## Usage

```bash
npm install
node index.js
```

Open `http://localhost:3000` in your browser. Multiple clients on the same
network can access the same host to sync notes in realtime.
