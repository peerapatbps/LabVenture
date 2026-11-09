const http = require('http');

const BELLBEAST_STAGE_URL = process.env.BELLBEAST_STAGE_URL || 'http://localhost:443/api/stage';
const POLL_INTERVAL_MS = 30_000;

let _stage = 1;
let _known = false; // true only when BellBeast's stage came from Aquadat.ping (not its "default" fallback / unreachable)
let _lastPoll = null;
const _listeners = [];

// Stage for data paths (daily report, writes, queue). Unknown → keeps last value / 1, as before.
function getStage() { return _stage; }

function isStageKnown() { return _known; }

// Stage for the login page + bypass: unknown → 0 (offline), so the bypass buttons show
// when Aquadat.ping isn't running or BellBeast can't be reached.
function getLoginStage() { return _known ? _stage : 0; }

function onStageChange(cb) { _listeners.push(cb); }

function _notify(prev, next) {
  if (prev === next) return;
  for (const cb of _listeners) {
    try { cb(next, prev); } catch {}
  }
}

function _fetchStage() {
  return new Promise((resolve) => {
    const req = http.get(BELLBEAST_STAGE_URL, { timeout: 5000 }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const obj = JSON.parse(raw);
          if (typeof obj.stage !== 'number') return resolve(null);
          resolve({ stage: obj.stage, known: obj.source !== 'default' });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function _poll() {
  const prev = _stage;
  const result = await _fetchStage();
  _lastPoll = new Date().toISOString();
  const known = !!result?.known;
  if (known !== _known) console.log(`[stageMonitor] stage ${known ? 'known (Aquadat.ping)' : 'unknown → login offline'}`);
  _known = known;
  if (result !== null && result.stage !== prev) {
    _stage = result.stage;
    console.log(`[stageMonitor] stage ${prev} → ${result.stage}`);
    _notify(prev, result.stage);
  }
}

function start() {
  _poll(); // immediate first check
  setInterval(_poll, POLL_INTERVAL_MS);
}

module.exports = { getStage, isStageKnown, getLoginStage, onStageChange, start };
