# Timeslate

A simple production note logging app with realtime sync.

## Features
- Displays a timecode based on the system time.
- Input fields for `Code` and `Production Notes`.
- Notes are stored by course (project) and synced in realtime across clients.
- The `Code` field syncs live across connected clients.
- Press Enter in the Production Notes field or click Send to add a note.
- Export notes to CSV.

## Usage

```bash
npm install
node index.js
```

### Configuration

The application stores notes in a `courses` directory. When running a packaged
binary (e.g. using `pkg`), `__dirname` is read-only, so the location of this
directory defaults to a `courses` folder next to the executable. You can
override the path by setting the `COURSES_DIR` environment variable:

```bash
COURSES_DIR=/some/writable/path node index.js
```

Open `http://localhost:4000` in your browser. The server logs its URL on
startup so you can access it from other machines on the same network.
