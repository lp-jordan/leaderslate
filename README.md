# Timeslate

A simple production note logging app with realtime sync.

## Features
- Displays a timecode based on the system time.
- Input fields for `Code` and `Production Notes`.
- Notes are stored by course (project) and synced in realtime across clients.
- The `Code` field syncs live across connected clients.
- Export notes to CSV.

## Usage

```bash
npm install
node index.js
```

Open `http://localhost:4000` in your browser. The server logs its URL on
startup so you can access it from other machines on the same network.
