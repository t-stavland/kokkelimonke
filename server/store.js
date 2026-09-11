const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

let saveTimer = null;
function save(roomsById) {
  // Debounce so a burst of state changes (every keystroke's not saved, but every
  // phase/vote/answer change is) only hits disk once per tick.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const serializable = {};
    for (const [code, room] of Object.entries(roomsById)) {
      const { timer, ...persistable } = room; // the live setTimeout handle isn't serializable
      serializable[code] = persistable;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(serializable, null, 2));
  }, 250);
}

module.exports = { load, save };
