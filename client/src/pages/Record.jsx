import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api.js';
import { getRefDate, setRefDate } from '../utils/refDate.js';
import DateSyncBar from '../components/DateSyncBar.jsx';

const SLOTS_2H = ['01:00','03:00','05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','21:00','23:00'];
const SLOTS_4H = new Set(['01:00','05:00','09:00','13:00','17:00','21:00']);
const SLOTS_12H = new Set(['09:00','21:00']);

// Returns { slot, date } based on current clock time.
// Logic: the even hour between two odd slots is the boundary.
// If minutes past that even hour > 0  → pick the higher odd slot (same day)
// If minutes past that even hour <= 0 → pick the lower  odd slot
// Edge case: lower odd = -1 (i.e., at 00:00) → slot 23:00 of previous day
function getCurrentSlotAndDate() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const evenHour = h % 2 === 0 ? h : h + 1;
  const minutesPastEven = (h - evenHour) * 60 + m;

  let slotHour;
  let dateOffset = 0;
  if (minutesPastEven > 0) {
    slotHour = evenHour + 1;
  } else {
    slotHour = evenHour - 1;
    if (slotHour < 0) { slotHour = 23; dateOffset = -1; }
  }

  const d = new Date(now);
  if (dateOffset !== 0) d.setDate(d.getDate() + dateOffset);
  return {
    slot: `${String(slotHour).padStart(2, '0')}:00`,
    date: d.toISOString().split('T')[0],
  };
}

const DAILY_SLOT = 'daily';
const WEEKLY_SLOT = 'weekly';

function slotMatchesFreq(slot, freq) {
  if (slot === WEEKLY_SLOT) return freq === 'weekly';
  if (slot === DAILY_SLOT) return freq === 'daily';
  if (freq === 'daily' || freq === 'weekly') return false;
  if (freq === '2h') return true;
  if (freq === '4h') return SLOTS_4H.has(slot);
  if (freq === '12h') return SLOTS_12H.has(slot);
  return false;
}

const FREQ_LABEL = { '2h': '2ชม.', '4h': '4ชม.', '12h': '12ชม.', 'daily': 'รายวัน', 'weekly': 'รายสัปดาห์' };
const COLS = 4;

// Per-node color palette: [nodeHeader, subgroupEven, subgroupOdd, cellEven, cellOdd, border]
const NODE_PALETTE = {
  RW:        ['bg-emerald-700 text-white',  'bg-emerald-100', 'bg-emerald-50',  'bg-emerald-50',  'bg-white',        'border-emerald-100'],
  Incoming:  ['bg-teal-700 text-white',     'bg-teal-100',    'bg-teal-50',     'bg-teal-50',     'bg-white',        'border-teal-100'],
  JarTest:   ['bg-violet-700 text-white',   'bg-violet-100',  'bg-violet-50',   'bg-violet-50',   'bg-white',        'border-violet-100'],
  JarTestSummary: ['bg-fuchsia-700 text-white', 'bg-fuchsia-100', 'bg-fuchsia-50', 'bg-fuchsia-50', 'bg-white', 'border-fuchsia-100'],
  CW_Phase1: ['bg-blue-800 text-white',     'bg-blue-200',    'bg-blue-100',    'bg-blue-50',     'bg-white',        'border-blue-100'],
  CW_Phase2: ['bg-indigo-800 text-white',   'bg-indigo-200',  'bg-indigo-100',  'bg-indigo-50',   'bg-white',        'border-indigo-100'],
  CW_Phase3: ['bg-sky-800 text-white',      'bg-sky-200',     'bg-sky-100',     'bg-sky-50',      'bg-white',        'border-sky-100'],
  CW_Phase4: ['bg-cyan-800 text-white',     'bg-cyan-200',    'bg-cyan-100',    'bg-cyan-50',     'bg-white',        'border-cyan-100'],
  TW12:      ['bg-orange-700 text-white',   'bg-orange-100',  'bg-orange-50',   'bg-orange-50',   'bg-white',        'border-orange-100'],
  TW34:      ['bg-amber-700 text-white',    'bg-amber-100',   'bg-amber-50',    'bg-amber-50',    'bg-white',        'border-amber-100'],
};
const DEFAULT_PALETTE = ['bg-gray-700 text-white', 'bg-gray-100', 'bg-gray-50', 'bg-gray-50', 'bg-white', 'border-gray-100'];

function groupBySubgroup(params) {
  const order = [];
  const map = {};
  for (const p of params) {
    const key = p.subgroup ?? '__flat__';
    if (!map[key]) { map[key] = []; order.push(key); }
    map[key].push(p);
  }
  return order.map(k => ({ subgroup: k === '__flat__' ? null : k, params: map[k] }));
}

function isTextParam(paramKey) {
  return /RecommendDose/.test(paramKey);
}

function isBacteriaParam(paramKey) {
  return /^Bacteria\./.test(paramKey);
}

const STATIONS = ['RW', 'CW1', 'CW2', 'CW3', 'CW4', 'TW1', 'TW2'];

function isFC(category) { return !!category?.includes('FC'); }
const DIVISIONS = [
  'Division Bacillariophyceae',
  'Division Chlorophyta',
  'Division Cyanophyta',
  'Division Euglenophyta',
  'Division Cryptophyta',
  'Division Pyrrhophyta',
  'Division Chrysophyta',
];

function AlgaeSpeciesPanel({ selectedDate, onSpeciesChange, canRecord = true }) {
  const [station, setStation] = useState('RW');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({}); // { [station]: [{species_id, species_name, division, category, count}] }
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ division: '', species_name: '', category: '' });
  const [saveStatus, setSaveStatus] = useState(null);
  const [exportStatus, setExportStatus] = useState(null); // null | 'exporting' | { sheet, written } | 'error'
  const qc = useQueryClient();

  const { data: searchResults = [] } = useQuery({
    queryKey: ['algae-species-search', query],
    queryFn: () => get(`/api/algae/species?q=${encodeURIComponent(query)}`),
    staleTime: 5000,
  });

  const { data: existingRecords } = useQuery({
    queryKey: ['algae-records', selectedDate, station],
    queryFn: () => get(`/api/algae/records?date=${selectedDate}&station=${station}`),
  });

  // Pre-fill from DB when switching station or date
  useEffect(() => {
    if (!existingRecords || existingRecords.length === 0) return;
    setSelected(prev => {
      if (prev[station]?.length > 0) return prev; // don't overwrite in-progress edits
      return {
        ...prev,
        [station]: existingRecords.map(r => ({ species_id: r.species_id, species_name: r.species_name, division: r.division, category: r.category, count: r.count ?? '' })),
      };
    });
  }, [existingRecords, station]);

  useEffect(() => { onSpeciesChange?.(selected); }, [selected]);

  const stationSelected = selected[station] ?? [];
  const selectedIds = new Set(stationSelected.map(s => s.species_id));

  function addSpecies(sp) {
    if (selectedIds.has(sp.id)) return;
    setSelected(prev => ({
      ...prev,
      [station]: [...(prev[station] ?? []), { species_id: sp.id, species_name: sp.species_name, division: sp.division, category: sp.category, count: '' }],
    }));
  }

  function removeSpecies(species_id) {
    setSelected(prev => ({ ...prev, [station]: (prev[station] ?? []).filter(s => s.species_id !== species_id) }));
  }

  function setCount(species_id, val) {
    setSelected(prev => ({
      ...prev,
      [station]: (prev[station] ?? []).map(s => s.species_id === species_id ? { ...s, count: val } : s),
    }));
  }

  async function handleSave() {
    setSaveStatus('saving');
    const items = stationSelected.map(s => ({ species_id: s.species_id, count: s.count === '' ? null : Number(s.count) }));
    try {
      await post('/api/algae/records', { date: selectedDate, station, items });
      qc.invalidateQueries(['algae-records', selectedDate, station]);
      setSaveStatus('ok');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus('error');
    }
  }

  async function handleExport() {
    setExportStatus('exporting');
    try {
      const result = await post('/api/algae/export', { date: selectedDate });
      setExportStatus(result);
      setTimeout(() => setExportStatus(null), 5000);
    } catch {
      setExportStatus('error');
      setTimeout(() => setExportStatus(null), 3000);
    }
  }

  async function handleAddSpecies() {
    if (!addForm.species_name.trim()) return;
    try {
      const newSp = await post('/api/algae/species', addForm);
      qc.invalidateQueries(['algae-species-search']);
      addSpecies(newSp);
      setAddForm({ division: '', species_name: '', category: '' });
      setShowAddForm(false);
    } catch (e) {
      alert(e.message || 'เกิดข้อผิดพลาด');
    }
  }

  return (
    <div className="rounded-xl shadow-sm border border-rose-200 overflow-hidden">
      {/* Header */}
      <div className="bg-rose-700 text-white px-4 py-2.5 flex items-center justify-between">
        <span className="text-sm font-bold">บันทึกชนิดสาหร่าย</span>
        <button
          onClick={() => setShowAddForm(v => !v)}
          className="text-xs bg-rose-500 hover:bg-rose-400 px-2.5 py-1 rounded-lg transition-colors"
        >
          + เพิ่มสาหร่ายใหม่
        </button>
      </div>

      {/* Add species form */}
      {showAddForm && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-3 space-y-2">
          <p className="text-xs font-bold text-rose-800">เพิ่มชนิดสาหร่ายใหม่</p>
          <select
            value={addForm.division}
            onChange={e => setAddForm(f => ({ ...f, division: e.target.value }))}
            className="w-full border border-rose-200 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">— เลือก Division —</option>
            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input
            placeholder="ชื่อสาหร่าย (เช่น Navicula sp.)"
            value={addForm.species_name}
            onChange={e => setAddForm(f => ({ ...f, species_name: e.target.value }))}
            className="w-full border border-rose-200 rounded-lg px-3 py-1.5 text-sm"
          />
          <input
            placeholder="หมวด (FC Algae, PW Algae, TOX Algae, ...)"
            value={addForm.category}
            onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
            className="w-full border border-rose-200 rounded-lg px-3 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={handleAddSpecies} className="bg-rose-700 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-rose-600">บันทึก</button>
            <button onClick={() => setShowAddForm(false)} className="text-sm px-4 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-100">ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="p-3 space-y-3">
        {/* Station tabs */}
        <div className="flex gap-2">
          {STATIONS.map(st => (
            <button
              key={st}
              onClick={() => setStation(st)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors
                ${station === st ? 'bg-rose-700 text-white border-rose-700' : 'bg-white text-rose-700 border-rose-200 hover:border-rose-500'}`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="ค้นหาชนิดสาหร่าย..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
        />

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
            {searchResults.map(sp => {
              const already = selectedIds.has(sp.id);
              return (
                <button
                  key={sp.id}
                  onClick={() => addSpecies(sp)}
                  disabled={already}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-rose-50 transition-colors flex items-center justify-between
                    ${already ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <span>
                    <span className="font-medium">{sp.species_name}</span>
                    {sp.category && <span className="ml-2 text-xs text-gray-400">{sp.category}</span>}
                  </span>
                  {already ? <span className="text-xs text-green-600">✓</span> : <span className="text-xs text-rose-400">+ เลือก</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Selected species */}
        {stationSelected.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500">รายการที่เลือก ({station})</p>
            {stationSelected.map(sp => (
              <div key={sp.species_id} className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5">
                <span className="flex-1 text-sm font-medium text-gray-700">{sp.species_name}</span>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={sp.count}
                  onChange={e => setCount(sp.species_id, e.target.value)}
                  placeholder="—"
                  className="w-28 border border-rose-200 rounded-md px-2 py-1 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-rose-300 bg-white"
                />
                <span className="text-xs text-gray-400 whitespace-nowrap">cells/100mL</span>
                <button onClick={() => removeSpecies(sp.species_id)} className="text-rose-400 hover:text-rose-600 text-base leading-none">×</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-400 text-sm py-2">ยังไม่มีรายการ — ค้นหาและเลือกสาหร่าย</p>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={stationSelected.length === 0 || saveStatus === 'saving' || !canRecord}
          title={!canRecord ? 'ปิดการบันทึกเมื่ออยู่ใน Bypass Mode' : undefined}
          className="w-full bg-rose-700 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
        >
          {saveStatus === 'saving' ? 'กำลังบันทึก...' : saveStatus === 'ok' ? '✅ บันทึกสำเร็จ' : `บันทึกสาหร่าย ${station} (${stationSelected.length} ชนิด)`}
        </button>
        {saveStatus === 'error' && <p className="text-red-600 text-sm text-center">เกิดข้อผิดพลาด กรุณาลองใหม่</p>}

        {/* Export to Excel */}
        <div className="border-t border-rose-100 pt-3 space-y-2">
          <button
            onClick={handleExport}
            disabled={exportStatus === 'exporting'}
            className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            {exportStatus === 'exporting'
              ? 'กำลัง Export...'
              : '📥 Export สาหร่ายลง Excel'}
          </button>
          {exportStatus && exportStatus !== 'exporting' && exportStatus !== 'error' && (
            <p className="text-emerald-700 text-xs text-center font-medium">
              ✅ บันทึก sheet <strong>{exportStatus.sheet}</strong> แล้ว ({exportStatus.written} รายการ)
            </p>
          )}
          {exportStatus === 'error' && (
            <p className="text-red-600 text-xs text-center">Export ล้มเหลว กรุณาลองใหม่</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Record() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const urlDate = new URLSearchParams(window.location.search).get('date');
    if (urlDate) { setRefDate(urlDate); return urlDate; }
    return getRefDate();
  });
  const [selectedSlot, setSelectedSlot] = useState(() => {
    const urlSlot = new URLSearchParams(window.location.search).get('slot');
    return urlSlot || getCurrentSlotAndDate().slot;
  });
  const [values, setValues] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [carPrompts, setCarPrompts] = useState([]);
  const [algaeSpecies, setAlgaeSpecies] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const qc = useQueryClient();

  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];

  async function syncDateToDb(date) {
    const result = await post('/api/aquadat/sync', { date });
    qc.invalidateQueries({ queryKey: ['progress-nodes', date] });
    qc.invalidateQueries({ queryKey: ['progress-nodes-today', date] });
    return result;
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      const result = await syncDateToDb(selectedDate);
      const inserted = result.inserted ?? 0;
      setSyncMsg(inserted === 0 ? 'AquaDAT ไม่มีข้อมูลวันนี้' : `อัปเดตแล้ว ${inserted} รายการ`);
    } catch {
      setSyncMsg('เชื่อมต่อ AquaDAT ไม่ได้');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 3000);
    }
  }

  function handleDateChange(newDate) {
    setSelectedDate(newDate);
    setRefDate(newDate);
    setValues({});
    setSubmitted(false);
    setCarPrompts([]);
    syncDateToDb(newDate).catch(() => {});
  }

  // Auto-update slot every minute based on wall clock — only when viewing today
  useEffect(() => {
    if (selectedDate !== today) return;
    const tick = () => {
      const { slot } = getCurrentSlotAndDate();
      setSelectedSlot(prev => {
        if (prev !== slot) { setValues({}); setSubmitted(false); setCarPrompts([]); }
        return slot;
      });
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [selectedDate, today]);

  const { data: progress } = useQuery({
    queryKey: ['progress-nodes', selectedDate],
    queryFn: () => get(`/api/progress/nodes-today?date=${selectedDate}`),
    refetchInterval: selectedDate === today ? 30000 : false,
  });

  // slot → { anyDue, allDone } across ALL params
  const slotStatus = useMemo(() => {
    const map = {};
    for (const node of progress?.nodes ?? []) {
      for (const param of node.params) {
        if (param.skip_progress) continue;
        for (const s of param.slots) {
          if (!map[s.slot]) map[s.slot] = { anyDue: false, allDone: true };
          if (s.due) map[s.slot].anyDue = true;
          if (s.due && !s.done) map[s.slot].allDone = false;
        }
      }
    }
    return map;
  }, [progress]);

  const { data: nodesConfig } = useQuery({ queryKey: ['nodes-config'], queryFn: () => get('/api/config/nodes') });
  const { data: scenario } = useQuery({ queryKey: ['active-scenario'], queryFn: () => get('/api/scenarios/active') });

  // Pre-fill from DB whenever date or slot changes
  const { data: existingValues } = useQuery({
    queryKey: ['node-values', selectedDate, selectedSlot],
    queryFn: () => get(`/api/write/nodes?date=${selectedDate}&slot=${encodeURIComponent(selectedSlot)}`),
    enabled: !!selectedDate && !!selectedSlot,
  });
  useEffect(() => {
    if (existingValues?.values) setValues(existingValues.values);
  }, [existingValues]);

  // Auto-fill Biological Analysis values from algae species counts
  useEffect(() => {
    if (selectedSlot !== WEEKLY_SLOT) return;
    setValues(prev => {
      const next = { ...prev };
      for (const st of STATIONS) {
        const species = algaeSpecies[st] ?? [];
        const total = species.reduce((s, sp) => s + (Number(sp.count) || 0), 0);
        const fc = species.filter(sp => isFC(sp.category)).reduce((s, sp) => s + (Number(sp.count) || 0), 0);
        next[`Algae.${st}.Total`] = total > 0 ? String(total) : '';
        next[`Algae.${st}.ClogFilter`] = fc > 0 ? String(fc) : '';
      }
      return next;
    });
  }, [algaeSpecies, selectedSlot]);

  const thresholdMap = useMemo(() => {
    const map = {};
    for (const t of scenario?.thresholds ?? []) map[t.param_key] = t;
    return map;
  }, [scenario]);

  // Nodes with only params relevant to selected slot
  const visibleNodes = useMemo(() => {
    if (!nodesConfig?.nodes) return [];
    return nodesConfig.nodes
      .map(node => ({
        ...node,
        params: node.parameters.filter(p => slotMatchesFreq(selectedSlot, p.frequency)),
      }))
      .filter(node => node.params.length > 0)
      .sort((a, b) => a.sort - b.sort);
  }, [nodesConfig, selectedSlot]);

  const allParamKeys = useMemo(() => visibleNodes.flatMap(n => n.params.map(p => p.param_key)), [visibleNodes]);

  function isOutOfRange(param_key, value) {
    const t = thresholdMap[param_key];
    if (!t || value === '' || value === undefined) return false;
    const v = parseFloat(value);
    if (isNaN(v)) return false;
    if (t.max !== null && t.max !== undefined && v > t.max) return true;
    if (t.min !== null && t.min !== undefined && v < t.min) return true;
    return false;
  }

  function getThresholdLabel(param_key) {
    const t = thresholdMap[param_key];
    if (!t) return null;
    const parts = [];
    if (t.min !== null && t.min !== undefined) parts.push(`≥${t.min}`);
    if (t.max !== null && t.max !== undefined) parts.push(`≤${t.max}`);
    return parts.join(' – ') || null;
  }

  const filledKeys = allParamKeys.filter(k => values[k] !== '' && values[k] !== undefined);
  const canSubmit = allParamKeys.length > 0 && filledKeys.length > 0;

  const isRetroactive = selectedDate < today;

  // Load snapshots for past dates (to detect changes)
  const { data: snapshots } = useQuery({
    queryKey: ['snapshots', selectedDate],
    queryFn: () => get(`/api/progress/snapshots?date=${selectedDate}`),
    enabled: isRetroactive,
  });

  const [confirmDialog, setConfirmDialog] = useState({ open: false, diffs: [], keysToSubmit: [] });

  const { data: queueStatus } = useQuery({
    queryKey: ['aquadat-queue'],
    queryFn: () => get('/api/write/queue'),
    refetchInterval: 30000,
  });
  const queueCount = queueStatus?.count ?? 0;

  const retryMutation = useMutation({
    mutationFn: () => post('/api/write/queue/retry'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['aquadat-queue'] }),
  });

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });
  const me = meData;
  const bypassRole = (me?.bypass && me?.role) ? me.role : null;
  const canRecord = !bypassRole;

  const mutation = useMutation({
    mutationFn: async (keysToSubmit) => {
      const records = keysToSubmit.map(k => ({
        param_key: k,
        trans_dtm: selectedDate,
        trans_time: selectedSlot,
        trans_value: String(values[k]),
      }));
      return post('/api/write/nodes', { records, plant_id: nodesConfig.plant_id, recorder_name: me?.name ?? null });
    },
    onSuccess: (data) => {
      const oor = allParamKeys.filter(k => isOutOfRange(k, values[k]));
      setCarPrompts(oor);
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ['progress-nodes', selectedDate] });
      qc.invalidateQueries({ queryKey: ['progress-nodes-today', selectedDate] });
      if (data?.warnings?.aquadat || data?.warnings?.excel) {
        qc.invalidateQueries({ queryKey: ['aquadat-queue'] });
      }
    },
  });

  function handleSubmit() {
    if (!canRecord) return;
    setSubmitted(false);
    setCarPrompts([]);

    if (isRetroactive && snapshots && Object.keys(snapshots).length > 0) {
      // Build diff list: filled params where value differs from snapshot
      const diffs = [];
      const keysToSubmit = [];
      for (const k of filledKeys) {
        const snapKey = `${k}|${selectedSlot}`;
        const snapshotVal = snapshots[snapKey] ?? null;
        const myVal = String(values[k]);
        if (snapshotVal === null || myVal !== snapshotVal) {
          const node = visibleNodes.find(n => n.params.some(p => p.param_key === k));
          const param = node?.params.find(p => p.param_key === k);
          diffs.push({ key: k, label: param?.label ?? k, unit: param?.unit ?? '', snapshotVal, myVal });
          keysToSubmit.push(k);
        }
      }
      if (diffs.length === 0) {
        // All values match snapshot — nothing changed, but still allow save
        mutation.mutate(filledKeys);
        return;
      }
      setConfirmDialog({ open: true, diffs, keysToSubmit });
      return;
    }

    mutation.mutate(filledKeys);
  }

  function handleConfirm() {
    if (!canRecord) { setConfirmDialog(d => ({ ...d, open: false })); return; }
    setConfirmDialog(d => ({ ...d, open: false }));
    mutation.mutate(confirmDialog.keysToSubmit);
  }

  function handleSlotChange(slot) {
    setSelectedSlot(slot);
    setValues({});
    setSubmitted(false);
    setCarPrompts([]);
  }

  const currentSlot = getCurrentSlotAndDate().slot;

  return (
    <div className="w-full space-y-4">
      {/* Retroactive confirm modal */}
      {confirmDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900">ยืนยันการบันทึกย้อนหลัง</h2>
            <p className="text-sm text-gray-500">ค่าต่อไปนี้ต่างจากข้อมูล AquaDAT — จะบันทึกเฉพาะค่าที่มีการเปลี่ยนแปลง:</p>
            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {confirmDialog.diffs.map(d => (
                <div key={d.key} className="flex justify-between text-sm px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="font-medium text-gray-700">{d.label}</span>
                  <span className="text-gray-500">
                    {d.snapshotVal !== null
                      ? <><span className="text-gray-400">{d.snapshotVal}</span>{' → '}<span className="text-amber-700 font-semibold">{d.myVal}</span></>
                      : <span className="text-blue-700 font-semibold">{d.myVal} (ใหม่)</span>
                    }
                    {d.unit && <span className="ml-1 text-gray-400">{d.unit}</span>}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(d => ({ ...d, open: false }))}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canRecord}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                ยืนยันบันทึก {confirmDialog.keysToSubmit.length} ค่า
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">
          บันทึกข้อมูล
          {isRetroactive && (
            <span className="ml-2 text-sm font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              ย้อนหลัง
            </span>
          )}
        </h1>
        <DateSyncBar
          date={selectedDate}
          onDateChange={handleDateChange}
          onSync={handleSync}
          syncing={syncing}
          syncMsg={syncMsg}
          maxDate={today}
        />
      </div>

      {/* Time slot selector */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">เลือกรอบเวลา</p>
          {queueCount > 0 && (
            <button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              {retryMutation.isPending ? 'กำลังส่ง...' : `⚠️ AquaDAT ค้าง ${queueCount} รายการ — ส่งใหม่`}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {SLOTS_2H.map(slot => {
            const isActive = slot === selectedSlot;
            const isCurrent = slot === currentSlot;
            const st = slotStatus[slot];
            const color = !st?.anyDue ? 'none' : st.allDone ? 'green' : 'red';
            return (
              <button
                key={slot}
                onClick={() => handleSlotChange(slot)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors touch-target
                  ${isActive
                    ? 'bg-brand text-white border-brand'
                    : color === 'green'
                    ? 'bg-green-100 border-green-400 text-green-800 hover:bg-green-200'
                    : color === 'red'
                    ? 'bg-red-100 border-red-400 text-red-800 hover:bg-red-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-brand hover:text-brand'
                  }`}
              >
                {slot}
                {isCurrent && !isActive && <span className="ml-1 text-xs opacity-60">←</span>}
              </button>
            );
          })}
          {(() => {
            const st = slotStatus['daily'];
            const color = !st?.anyDue ? 'none' : st.allDone ? 'green' : 'red';
            const isActive = selectedSlot === DAILY_SLOT;
            return (
              <button
                onClick={() => handleSlotChange(DAILY_SLOT)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors touch-target
                  ${isActive
                    ? 'bg-purple-600 text-white border-purple-600'
                    : color === 'green'
                    ? 'bg-green-100 border-green-400 text-green-800 hover:bg-green-200'
                    : color === 'red'
                    ? 'bg-red-100 border-red-400 text-red-800 hover:bg-red-200'
                    : 'bg-white text-purple-600 border-purple-200 hover:border-purple-600'
                  }`}
              >
                วันละ 1 ครั้ง
              </button>
            );
          })()}
          {(() => {
            const isActive = selectedSlot === WEEKLY_SLOT;
            return (
              <button
                onClick={() => handleSlotChange(WEEKLY_SLOT)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors touch-target
                  ${isActive
                    ? 'bg-rose-700 text-white border-rose-700'
                    : 'bg-white text-rose-700 border-rose-200 hover:border-rose-700 hover:text-rose-700'
                  }`}
              >
                สัปดาห์ละ 1 ครั้ง
              </button>
            );
          })()}
        </div>
        {scenario && (
          <p className="text-xs text-blue-600">เกณฑ์: <strong>{scenario.name}</strong></p>
        )}
      </div>

      {/* Node sections */}
      {selectedSlot === WEEKLY_SLOT && (
        <AlgaeSpeciesPanel selectedDate={selectedDate} onSpeciesChange={setAlgaeSpecies} canRecord={canRecord} />
      )}

      {visibleNodes.length === 0 ? (
        <div className="text-center text-gray-400 py-8">ไม่มีพารามิเตอร์สำหรับรอบนี้</div>
      ) : (
        <div className="space-y-3">
          {visibleNodes.map(node => {
            const pal = NODE_PALETTE[node.id] ?? DEFAULT_PALETTE;
            const [hdrCls, sgEven, sgOdd, cellEven, cellOdd, borderCls] = pal;
            const groups = groupBySubgroup(node.params);
            return (
            <div key={node.id} className={`rounded-xl shadow-sm border overflow-hidden ${borderCls}`}>
              {/* Node header */}
              <div className={`flex items-center justify-between px-4 py-2.5 ${hdrCls}`}>
                <span className="text-sm font-bold">{node.label}</span>
                <span className="text-xs opacity-70">{node.params.length} ค่า</span>
              </div>

              {/* Sub-group rows */}
              {groups.map(({ subgroup, params: sgParams }, sgIdx) => {
                const isEven = sgIdx % 2 === 0;
                const sgBg = subgroup ? (isEven ? sgEven : sgOdd) : 'bg-white';
                const cellBg = isEven ? cellEven : cellOdd;
                return (
                <div key={subgroup ?? 'flat'}>
                  {subgroup && (
                    <div className={`px-3 py-1 border-t ${borderCls} ${sgBg}`}>
                      <span className="text-xs font-bold tracking-wide opacity-80">{subgroup}</span>
                    </div>
                  )}
                  <div
                    className={`grid border-t ${borderCls}`}
                    style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
                  >
                    {sgParams.map((p, idx) => {
                      const val = values[p.param_key] ?? '';
                      const oor = isOutOfRange(p.param_key, val);
                      const threshold = getThresholdLabel(p.param_key);
                      return (
                        <div
                          key={p.param_key}
                          className={`p-2.5 ${idx % COLS > 0 ? `border-l ${borderCls}` : ''} ${oor ? 'bg-red-50' : cellBg}`}
                        >
                          {/* Inline label row */}
                          <div className="flex flex-wrap items-baseline gap-x-1 mb-1.5 leading-tight">
                            <span className="text-xs font-bold text-gray-700">{p.label}</span>
                            {p.unit && <span className="text-xs text-gray-400">({p.unit})</span>}
                            {threshold && (
                              <span className="text-xs font-semibold text-blue-600">{threshold}</span>
                            )}
                          </div>
                          {isBacteriaParam(p.param_key) ? (
                            <select
                              value={val}
                              onChange={e => setValues(v => ({ ...v, [p.param_key]: e.target.value }))}
                              className={`w-full border rounded-md px-2 py-1.5 text-base font-semibold text-center focus:outline-none focus:ring-2 bg-white
                                ${val === 'found' ? 'border-red-300 text-red-700 focus:ring-red-300' : 'border-gray-200 focus:ring-brand'}`}
                            >
                              <option value="">—</option>
                              <option value="none">none</option>
                              <option value="found">found</option>
                            </select>
                          ) : (
                            <input
                              type={isTextParam(p.param_key) ? 'text' : 'number'}
                              step={isTextParam(p.param_key) ? undefined : 'any'}
                              inputMode={isTextParam(p.param_key) ? 'text' : 'decimal'}
                              value={val}
                              onChange={e => setValues(v => ({ ...v, [p.param_key]: e.target.value }))}
                              placeholder="—"
                              className={`w-full border rounded-md px-2 py-1.5 text-base font-semibold text-center focus:outline-none focus:ring-2 bg-white
                                ${oor
                                  ? 'border-red-300 text-red-700 focus:ring-red-300'
                                  : 'border-gray-200 focus:ring-brand'
                                }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
            );
          })}

          <button
            onClick={handleSubmit}
            disabled={mutation.isPending || !canSubmit || !canRecord}
            title={!canRecord ? 'ปิดการบันทึกเมื่ออยู่ใน Bypass Mode' : undefined}
            className="w-full bg-brand hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl touch-target transition-colors text-base"
          >
            {mutation.isPending ? 'กำลังบันทึก...' : `บันทึก ${allParamKeys.length} ค่า — รอบ ${selectedSlot}`}
          </button>

          {mutation.isError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
              เกิดข้อผิดพลาด: {mutation.error?.message}
            </div>
          )}

          {submitted && (
            <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl px-4 py-4 text-sm space-y-2">
              <p className="font-semibold">✅ บันทึกสำเร็จ — รอบ {selectedSlot}</p>
              {carPrompts.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-red-700">พบค่าเกินเกณฑ์:</p>
                  {carPrompts.map(k => {
                    const node = visibleNodes.find(n => n.params.some(p => p.param_key === k));
                    const param = node?.params.find(p => p.param_key === k);
                    return (
                      <p key={k} className="text-red-600">• {param?.label ?? k}: {values[k]} {param?.unit}</p>
                    );
                  })}
                  <a href="/car" className="inline-block mt-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    ไปออก CAR
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
