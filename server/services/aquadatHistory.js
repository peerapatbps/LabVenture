const fetch = require('node-fetch');
const AQUADAT_PATTERNS = require('../config/aquadat_patterns.json');

const GRAPHQL_URL = process.env.AQUADAT_GRAPHQL_URL || 'https://aquadat.mwa.co.th/graphql';

async function fetchOnePattern(topic, pattern_id, date, dayshift_id, token, out) {
  const query = `{\n  get_transaction_datavalues_pattern(\n    pattern_id: ${pattern_id}\n    trans_dtm: "${date}"\n    dayshift_id: ${dayshift_id}\n    dtl_flag: false\n  ) {\n    var_data\n    __typename\n  }\n}\n`;
  const body = JSON.stringify({ variables: {}, query });
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${token}` };

  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      r = await fetch(GRAPHQL_URL, { method: 'POST', headers, body, timeout: 20000 });
      break;
    } catch (e) {
      if (attempt === 2) throw new Error(`network timeout at: ${GRAPHQL_URL}`);
      console.warn(`[aquadatHistory] ${topic} pattern ${pattern_id} retry (attempt ${attempt})...`);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
  const data = await r.json();
  if (data.errors || !data.data) {
    console.warn(`[aquadatHistory] ${topic} pattern ${pattern_id} error:`, data.errors?.[0]?.message);
    return;
  }
  const dataRows = data.data.get_transaction_datavalues_pattern ?? [];
  let count = 0;
  for (const row of dataRows) {
    let outerArr;
    try { outerArr = JSON.parse('[' + row.var_data + ']'); } catch { continue; }
    if (!Array.isArray(outerArr)) continue;
    for (const slotArr of outerArr) {
      const items = Array.isArray(slotArr) ? slotArr : [slotArr];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (item.bgColor === 'time_series' || !item._id || !item._time) continue;
        const val = item.value;
        if (val == null || val === '') continue;
        if (typeof val === 'string' && val.startsWith('=')) continue;
        const cid = String(item._id);
        if (!out[cid]) out[cid] = {};
        out[cid][item._time] = String(val);
        count++;
      }
    }
  }
  console.log(`[aquadatHistory] ${topic} pattern ${pattern_id}: ${count} values`);
}

// Returns { [configparam_id]: { [slot]: value_string } }
async function fetchAquadatHistory(station_id, topic_filter, date, token) {
  const allPatterns = AQUADAT_PATTERNS.stations[station_id];
  if (!allPatterns || !token) return {};

  const patterns = topic_filter
    ? allPatterns.filter(p =>
        (Array.isArray(p.node_topics) && p.node_topics.includes(topic_filter)) ||
        p.topic === topic_filter
      )
    : allPatterns;
  if (!patterns.length) return {};

  const thHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  const dayshift_id = thHour < 8 ? 1 : thHour < 16 ? 2 : 3;

  const out = {};
  for (const { topic, pattern_id } of patterns) {
    try {
      await fetchOnePattern(topic, pattern_id, date, dayshift_id, token, out);
    } catch (e) {
      console.warn(`[aquadatHistory] ${station_id}/${topic} pattern ${pattern_id} failed:`, e.message);
    }
  }
  return out;
}

// Curated patterns for daily report — one or more patterns per station
// Multiple patterns per station are fetched serially and merged into one cfgId map.
const DAILY_REPORT_ENTRIES = [
  { sid: 'RWS1',  patterns: [111] },
  { sid: 'RWS2',  patterns: [112] },
  { sid: 'CHEM1', patterns: [113, 346, 350, 351, 367] }, // 113=daily summary, 346=Alum received(8037), 350=Alum DR, 351=Chlorine DR, 367=PACl DR
  { sid: 'CHEM2', patterns: [114, 347, 323, 366, 352] }, // 114=daily summary, 347=Alum received(8036), 323=Alum DR, 366=PACl DR, 352=Chlorine DR
  { sid: 'FWS1',  patterns: [109, 1, 10] },   // 109=main daily, 1=energy RMU301A/302A, 10=filter status P#12
  { sid: 'FWS2',  patterns: [110, 28, 11] },  // 110=main daily, 28=energy RMU301B/302B, 11=filter status P#34
  { sid: 'TPS',   patterns: [116, 255] }, // 116=flow/service, 255=SS1B+SS3 energy
  { sid: 'DPS',   patterns: [115] },
  { sid: 'CWS1',  patterns: [3] },
  { sid: 'CWS2',  patterns: [14] },
];
const DAILY_REPORT_STATIONS = DAILY_REPORT_ENTRIES.map(e => e.sid);

// Fetch all daily-report patterns serially, one pattern at a time.
// Calls onStep(sid, 'loading'|'done'|'error', count?) for UI progress.
// Returns { [stationId]: { [configparam_id]: { [slot]: value_string } } }
async function fetchDailyReportHistory(date, token, onStep, onPattern) {
  const thHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  const dayshift_id = thHour < 8 ? 1 : thHour < 16 ? 2 : 3;
  const map = {};
  for (const { sid, patterns } of DAILY_REPORT_ENTRIES) {
    if (onStep) onStep(sid, 'loading');
    const out = {};
    let failed = false;
    for (const pattern_id of patterns) {
      const before = Object.values(out).reduce((s, m) => s + Object.keys(m).length, 0);
      try {
        await fetchOnePattern(sid, pattern_id, date, dayshift_id, token, out);
        const after = Object.values(out).reduce((s, m) => s + Object.keys(m).length, 0);
        if (onPattern) onPattern(sid, pattern_id, 'done', after - before);
      } catch (e) {
        console.warn(`[aquadatHistory] daily-report ${sid} pattern ${pattern_id} failed:`, e.message);
        failed = true;
        if (onPattern) onPattern(sid, pattern_id, 'error', 0);
      }
    }
    const count = Object.values(out).reduce((s, slots) => s + Object.keys(slots).length, 0);
    if (onStep) onStep(sid, failed && count === 0 ? 'error' : 'done', count);
    map[sid] = out;
  }
  return map;
}

// Legacy: full station fetch (all patterns) used by operator history UI
async function fetchAllStationsHistory(date, token) {
  const results = await Promise.allSettled(
    DAILY_REPORT_STATIONS.map(sid => fetchAquadatHistory(sid, null, date, token))
  );
  const map = {};
  for (let i = 0; i < DAILY_REPORT_STATIONS.length; i++) {
    const sid = DAILY_REPORT_STATIONS[i];
    map[sid] = results[i].status === 'fulfilled' ? results[i].value : {};
  }
  return map;
}

module.exports = { fetchOnePattern, fetchAquadatHistory, fetchAllStationsHistory, fetchDailyReportHistory, DAILY_REPORT_ENTRIES, DAILY_REPORT_STATIONS };
