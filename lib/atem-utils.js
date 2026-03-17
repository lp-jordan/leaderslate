const RESERVED_NOTE_CODE = 'ATEM';
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const SPACE_RUN = /\s+/g;
const UNDERSCORE_RUN = /_+/g;

function createTimestamp(date = new Date()) {
  const frames = Math.floor(date.getMilliseconds() / 40);
  return `${date.toTimeString().split(' ')[0]}:${String(frames).padStart(2, '0')}`;
}

function sanitizeCourseName(name) {
  if (!name || typeof name !== 'string') {
    return 'session';
  }

  const sanitized = name.trim()
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(SPACE_RUN, '_')
    .replace(UNDERSCORE_RUN, '_')
    .replace(/^[_ .-]+|[_ .-]+$/g, '');

  return sanitized || 'session';
}

function formatDateParts(date = new Date()) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return {
    dateStamp: `${month}-${day}-${year}`
  };
}

function generateRecordingBaseName(course, date = new Date()) {
  const safeCourse = sanitizeCourseName(course);
  const { dateStamp } = formatDateParts(date);
  return `${safeCourse}_${dateStamp}`;
}

function createNote(code, note, date = new Date()) {
  return {
    timestamp: createTimestamp(date),
    code,
    note
  };
}

function createAtemNote(note, date = new Date()) {
  return createNote(RESERVED_NOTE_CODE, note, date);
}

function labelForInput(state, inputId) {
  const input = state.inputs.find(item => String(item.id) === String(inputId));
  return input ? input.label : `Input ${inputId}`;
}

function createDefaultAtemState(overrides = {}) {
  return {
    bridgeAvailable: false,
    bridgeMode: 'unknown',
    connected: false,
    switcherIp: '',
    inputs: [],
    previewInput: null,
    programInput: null,
    recording: {
      isRecording: false,
      filename: '',
      status: 'disconnected'
    },
    lastError: '',
    lastCommandAt: null,
    ...overrides
  };
}

module.exports = {
  RESERVED_NOTE_CODE,
  createAtemNote,
  createDefaultAtemState,
  createNote,
  createTimestamp,
  formatDateParts,
  generateRecordingBaseName,
  labelForInput,
  sanitizeCourseName
};
