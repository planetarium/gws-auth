const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN_DIR = path.join(os.homedir(), '.config', 'gws-auth');
const TOKEN_PATH = path.join(TOKEN_DIR, 'tokens.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function save(tokens) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function clear() {
  try {
    fs.unlinkSync(TOKEN_PATH);
  } catch {
    // ignore
  }
}

module.exports = { load, save, clear };
