const http = require('http');

const BELLBEAST_STAGE_URL = process.env.BELLBEAST_STAGE_URL || 'http://localhost:443/api/stage';
const POLL_INTERVAL_MS = 30_000;

let _stage = 1;
let _lastPoll = null;
const _listeners = [];

function getStage() { return _stage; }

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
          resolve(typeof obj.stage === 'number' ? obj.stage : null);
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
  if (result !== null && result !== prev) {
    _stage = result;
    console.log(`[stageMonitor] stage ${prev} → ${result}`);
    _notify(prev, result);
  }
}

function start() {
  _poll(); // immediate first check
  setInterval(_poll, POLL_INTERVAL_MS);
}

module.exports = { getStage, onStageChange, start };
