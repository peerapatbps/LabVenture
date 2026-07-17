import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api.js';
import { Link, useNavigate } from 'react-router-dom';
import { getRefDate, setRefDate } from '../utils/refDate.js';
import DateSyncBar from '../components/DateSyncBar.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';
import WeeklyProgress from '../components/WeeklyProgress.jsx';
import MiniChartCard, { latestStreak, latestStreakInfo } from '../components/MiniChart.jsx';
import { MINI_FILTERS, CHART_REFRESH_MS, LAB_CHART_ENDPOINT, getThreshold } from '../config/chartConfig.js';

// Station IDs — update station_id values to match actual AquaDAT IDs
const AQUADAT_STATIONS = [
  { key: 'RWS1',  label: 'RWS#1',  station_id: 13 },
  { key: 'RWS2',  label: 'RWS#2',  station_id: 14 },
  { key: 'CDS1',  label: 'CDS#1',  station_id: 15 },
  { key: 'CDS2',  label: 'CDS#2',  station_id: 62 },
  { key: 'CWS1',  label: 'CWS#1',  station_id: 16 },
  { key: 'CWS2',  label: 'CWS#2',  station_id: 63 },
  { key: 'FWS1',  label: 'FWS#1',  station_id: 17 },
  { key: 'FWS2',  label: 'FWS#2',  station_id: 64 },
  { key: 'TPS',   label: 'TPS',    station_id: 18 },
  { key: 'DPS',   label: 'DPS',    station_id: 19 },
  { key: 'QWS',   label: 'QWS',    station_id: 20 },
];

const NODE_GROUPS = [
  { key: 'raw',     label: 'กลุ่มน้ำดิบ',        color: 'bg-emerald-700 text-white border-emerald-300', nodeIds: ['Incoming','JarTest','JarTestSummary','RW'] },
  { key: 'prod',    label: 'กลุ่มน้ำระบบผลิต',    color: 'bg-blue-800 text-white border-blue-300',     nodeIds: ['CW_Phase1','CW_Phase2','CW_Phase3','CW_Phase4'] },
  { key: 'tap',     label: 'กลุ่มน้ำประปา',        color: 'bg-amber-700 text-white border-amber-300',   nodeIds: ['TW12','TW34'] },
  { key: 'special', label: 'กลุ่มพิเศษ',           color: 'bg-rose-800 text-white border-rose-300',     nodeIds: ['Biological'] },
];

const FIXED_SLOTS = ['01:00','03:00','05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','21:00','23:00'];
const DAILY_POSITION = 6;


// ── Helpers ───────────────────────────────────────────────────────────────

function buildNodeDots(node) {
  const slotMap = {};
  for (const param of node.params) {
    if (param.skip_progress) continue;
    for (const s of param.slots) {
      if (!slotMap[s.slot]) slotMap[s.slot] = { hasDue: false, anyNotDone: false, anyModified: false, modifiedCount: 0 };
      if (s.due) {
        slotMap[s.slot].hasDue = true;
        if (!s.done) slotMap[s.slot].anyNotDone = true;
        if (s.done && s.modified) { slotMap[s.slot].anyModified = true; slotMap[s.slot].modifiedCount++; }
      }
    }
  }
  return FIXED_SLOTS.map((hourSlot, idx) => {
    const slot = (idx === DAILY_POSITION && slotMap['daily']) ? 'daily' : hourSlot;
    const info = slotMap[slot];
    let status;
    if (!info) status = 'gray';
    else if (!info.hasDue) status = 'future';
    else if (info.anyNotDone) status = 'red';
    else if (info.anyModified) status = 'amber';
    else status = 'green';
    return { slot, label: slot, status, modifiedCount: info?.modifiedCount ?? 0 };
  });
}

function nextPendingSlot(node) {
  return buildNodeDots(node).find(d => d.status === 'red')?.slot ?? null;
}

function toThaiDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── DotItem ───────────────────────────────────────────────────────────────

function DotItem({ slot, label, status, modifiedCount, onClickSlot }) {
  const [show, setShow] = useState(false);
  const isClickable = status === 'red' || status === 'amber';
  const dotCls =
    status === 'green'  ? 'bg-green-500 border-green-700 ring-green-200' :
    status === 'red'    ? 'bg-red-400 border-red-600 ring-red-200 cursor-pointer' :
    status === 'amber'  ? 'bg-amber-400 border-amber-600 ring-amber-200 cursor-pointer' :
    status === 'future' ? 'bg-gray-200 border-gray-300' : 'bg-gray-100 border-gray-200';
  const tooltipStatus =
    status === 'green'  ? { text: '✓ บันทึกแล้ว', cls: 'text-green-600' } :
    status === 'red'    ? { text: '✗ ยังไม่บันทึก', cls: 'text-red-600' } :
    status === 'amber'  ? { text: `✎ แก้ไขแล้ว (${modifiedCount} ค่า)`, cls: 'text-amber-600' } :
    status === 'future' ? { text: 'ยังไม่ถึงเวลา', cls: 'text-gray-400' } :
                          { text: 'ไม่มีรอบนี้', cls: 'text-gray-400' };
  return (
    <div className="relative flex items-center justify-center"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onClick={() => isClickable && onClickSlot(slot)}>
      <div className={`w-2.5 h-2.5 rounded-full border-2 transition-transform duration-100 ${dotCls} ${isClickable ? 'hover:scale-150 hover:ring-2' : ''}`} />
      {show && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-md whitespace-nowrap">
          <span className="block text-xs font-mono font-semibold text-gray-800">{label}</span>
          <span className={`block text-xs ${tooltipStatus.cls}`}>{tooltipStatus.text}</span>
        </div>
      )}
    </div>
  );
}

function TimelineDots({ node, onClickSlot }) {
  const dots = buildNodeDots(node);
  return (
    <div className="relative flex-1 flex items-center h-6">
      <div className="absolute inset-x-0 h-0.5 bg-gray-200 rounded-full" />
      <div className="relative w-full flex justify-between items-center">
        {dots.map((d, i) => <DotItem key={i} {...d} onClickSlot={onClickSlot} />)}
      </div>
    </div>
  );
}

function NodeRow({ node, selectedDate }) {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];
  const pct = node.totalExpected ? Math.round((node.totalRecorded / node.totalExpected) * 100) : 0;
  const pending = nextPendingSlot(node);
  function goToRecord(slot) {
    const dateParam = selectedDate !== today ? `&date=${selectedDate}` : '';
    navigate(slot === 'daily' ? `/record?slot=daily${dateParam}` : `/record?slot=${encodeURIComponent(slot)}${dateParam}`);
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-gray-50 transition-colors">
      <div className="w-32 shrink-0">
        <p className="text-sm font-semibold text-gray-700 leading-tight truncate">{node.label}</p>
        <p className="text-xs text-gray-400 leading-tight">{pct}%</p>
      </div>
      <TimelineDots node={node} onClickSlot={goToRecord} />
      <div className="shrink-0 w-32 flex justify-end">
        {pending ? (
          <button onClick={() => goToRecord(pending)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-xs whitespace-nowrap">
            <span className="font-medium text-gray-700">บันทึก</span>
            <span className="font-mono font-semibold bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-xs">{pending}</span>
          </button>
        ) : (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-100 bg-gray-50 text-xs text-gray-400 whitespace-nowrap">✓ ครบแล้ว</span>
        )}
      </div>
    </div>
  );
}

function GroupSection({ group, nodes, selectedDate }) {
  const [open, setOpen] = useState(true);
  const totalRecorded = nodes.reduce((s, n) => s + (n.totalRecorded || 0), 0);
  const totalExpected = nodes.reduce((s, n) => s + (n.totalExpected || 0), 0);
  const pct = totalExpected ? Math.round((totalRecorded / totalExpected) * 100) : 0;
  const borderCls = group.color.split(' ').find(c => c.startsWith('border-')) ?? 'border-gray-200';
  const bgCls = group.color.split(' ').filter(c => !c.startsWith('border-')).join(' ');
  return (
    <div className={`rounded-xl border overflow-hidden shadow-sm ${borderCls}`}>
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 ${bgCls} hover:opacity-90 transition-opacity`}>
        <span className="text-sm font-bold tracking-wide">{group.label}</span>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pct === 100 ? 'bg-green-400 text-white' : 'bg-white/20 text-white'}`}>{pct}%</span>
          <span className="text-white/80 text-xs font-mono w-4 text-right">{open ? '−' : '+'}</span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-gray-100">
          {nodes.length === 0 ? <p className="text-xs text-gray-400 px-4 py-3">ไม่มีข้อมูล</p> :
            nodes.map(node => <NodeRow key={node.id} node={node} selectedDate={selectedDate} />)}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  const barColor = pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-yellow-400';
  return (
    <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center gap-3">
      <span className="text-sm text-gray-600 shrink-0">รอบที่บันทึกแล้ว</span>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-bold shrink-0 ${pct === 100 ? 'text-green-600' : 'text-brand'}`}>{pct}%</span>
    </div>
  );
}

// ── Mini Calendar ─────────────────────────────────────────────────────────

function MiniCalendar({ selectedDate, today, onSelectDate }) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const { year, month } = viewDate;
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = new Date(year, month, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
  const DAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  function prevMonth() {
    setViewDate(v => {
      const d = new Date(v.year, v.month - 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function nextMonth() {
    setViewDate(v => {
      const d = new Date(v.year, v.month + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return (
    <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 select-none">
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="text-gray-400 hover:text-gray-700 px-1 text-xl leading-none">‹</button>
        <span className="text-sm font-semibold text-gray-700">{monthLabel}</span>
        <button onClick={nextMonth} className="text-gray-400 hover:text-gray-700 px-1 text-xl leading-none">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-center text-xs text-gray-500 font-semibold py-0.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds = dateStr(day);
          const isToday = ds === today;
          const isSelected = ds === selectedDate;
          const isFuture = ds > today;
          return (
            <button
              key={i}
              disabled={isFuture}
              onClick={() => !isFuture && onSelectDate(ds)}
              className={`text-sm rounded-md py-1 leading-none transition-colors font-medium
                ${isSelected ? 'bg-brand text-white font-bold' :
                  isToday ? 'bg-blue-100 text-blue-700 font-semibold' :
                  isFuture ? 'text-gray-200 cursor-default' :
                  'text-gray-600 hover:bg-gray-100'}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Today's Todo ──────────────────────────────────────────────────────────

function AquadatQueueBanner() {
  const qc = useQueryClient();
  const { data: queueStatus } = useQuery({
    queryKey: ['aquadat-queue'],
    queryFn: () => get('/api/write/queue'),
    refetchInterval: 60000,
  });
  const retryMutation = useMutation({
    mutationFn: () => post('/api/write/queue/retry'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['aquadat-queue'] }),
  });

  const items = queueStatus?.items ?? [];
  if (items.length === 0) return null;

  const pendingCount = items.filter(i => i.status === 'pending').length;
  const deadCount = items.filter(i => i.status === 'dead').length;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 shadow-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-amber-800">⚠️ AquaDAT ค้างส่ง</p>
          <p className="text-xs text-amber-600">
            {pendingCount > 0 && `รอส่งใหม่ ${pendingCount} รายการ`}
            {pendingCount > 0 && deadCount > 0 && ' · '}
            {deadCount > 0 && <span className="text-red-600 font-semibold">ส่งไม่สำเร็จ {deadCount} รายการ (ครบ 3 ครั้ง)</span>}
          </p>
        </div>
        {pendingCount > 0 && (
          <button
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            {retryMutation.isPending ? 'กำลังส่ง...' : 'ส่งใหม่ทั้งหมด'}
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {items.map(item => (
          <div
            key={item.id}
            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs ${
              item.status === 'dead' ? 'bg-red-50 border border-red-200' : 'bg-amber-100'
            }`}
          >
            <span className="font-mono text-gray-600">{item.script_name}</span>
            <span className={`font-semibold ${item.status === 'dead' ? 'text-red-600' : 'text-amber-700'}`}>
              {item.status === 'dead' ? `ล้มเหลว ${item.attempts} ครั้ง` : `รอส่ง (${item.attempts} ครั้ง)`}
            </span>
          </div>
        ))}
      </div>
      {retryMutation.data && (
        <p className="text-xs text-green-700 font-medium">
          ส่งสำเร็จ {retryMutation.data.succeeded} รายการ
          {retryMutation.data.failed > 0 && ` · ยังล้มเหลว ${retryMutation.data.failed} รายการ`}
        </p>
      )}
    </div>
  );
}

function TodayTodo({ progressNodes, selectedDate, today, carAnalytics }) {
  const navigate = useNavigate();
  const allPending = [];
  for (const node of (progressNodes || [])) {
    for (const param of node.params) {
      if (param.skip_progress) continue;
      for (const s of param.slots) {
        if (s.due && !s.done) {
          allPending.push({ nodeLabel: node.label, paramLabel: param.label, slot: s.slot, nodeId: node.id });
        }
      }
    }
  }

  // Deduplicate by slot
  const bySlot = {};
  for (const item of allPending) {
    if (!bySlot[item.slot]) bySlot[item.slot] = { slot: item.slot, count: 0 };
    bySlot[item.slot].count++;
  }
  const slots = Object.values(bySlot).sort((a, b) => a.slot.localeCompare(b.slot)).slice(0, 8);

  const overdueCount = carAnalytics?.overdue?.length ?? 0;
  const totalCount = allPending.length + overdueCount;

  return (
    <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex flex-col">
      <h3 className="text-base font-semibold text-gray-700 mb-2">
        รายการค้างวันนี้
        {totalCount > 0 && (
          <span className="ml-1.5 text-red-500 font-bold">{totalCount}</span>
        )}
      </h3>
      {slots.length === 0 && overdueCount === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-base text-green-500 font-medium">✓ ครบทุกรอบแล้ว</span>
        </div>
      ) : (
        <div className="space-y-1 overflow-y-auto max-h-40">
          {slots.map(({ slot, count }) => (
            <button
              key={slot}
              onClick={() => {
                const dateParam = selectedDate !== today ? `&date=${selectedDate}` : '';
                navigate(`/record?slot=${encodeURIComponent(slot)}${dateParam}`);
              }}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors text-left"
            >
              <span className="text-base font-mono font-semibold text-red-700">{slot}</span>
              <span className="text-base text-red-500">{count} รายการ →</span>
            </button>
          ))}
          {overdueCount > 0 && (
            <button
              onClick={() => navigate('/car')}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg bg-orange-50 hover:bg-orange-100 transition-colors text-left"
            >
              <span className="text-base font-semibold text-orange-700">CAR ค้างเกิน 10 วัน</span>
              <span className="text-base text-orange-500">{overdueCount} เคส →</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Remarks Panels ────────────────────────────────────────────────────────

function weekRange(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = dt => dt.toISOString().split('T')[0].replace(/-/g, '');
  return { from: fmt(mon), to: fmt(sun) };
}

function AquadatRemarks({ selectedDate }) {
  const [activeStation, setActiveStation] = useState(AQUADAT_STATIONS[0]);
  const [idx, setIdx] = useState(0);
  const dt = selectedDate.replace(/-/g, '');
  const { data: remarks = [], isLoading } = useQuery({
    queryKey: ['aquadat-remarks', dt, activeStation.station_id],
    queryFn: () => get(`/api/data/remarks?plant_id=2&station_id=${activeStation.station_id}&begin_dt=${dt}&end_dt=${dt}&load_file_data=false`),
    refetchInterval: 300000,
    retry: false,
    onSuccess: () => setIdx(0),
  });

  const total = remarks.length;
  const safeIdx = total > 0 ? Math.min(idx, total - 1) : 0;
  const r = remarks[safeIdx];

  function changeStation(st) {
    setActiveStation(st);
    setIdx(0);
  }

  return (
    <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-gray-700">หมายเหตุจาก AquaDAT</h3>
        {total > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={safeIdx === 0}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default text-sm leading-none"
            >‹</button>
            <span className="text-xs text-gray-400 font-mono">{safeIdx + 1}/{total}</span>
            <button
              onClick={() => setIdx(i => Math.min(total - 1, i + 1))}
              disabled={safeIdx === total - 1}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default text-sm leading-none"
            >›</button>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {/* Left: station picker */}
        <div className="shrink-0">
          <div className="grid grid-cols-3 gap-1">
            {AQUADAT_STATIONS.map(st => (
              <button
                key={st.key}
                onClick={() => changeStation(st)}
                className={`text-xs font-semibold py-1.5 px-1 rounded-md border transition-colors leading-tight text-center
                  ${activeStation.key === st.key
                    ? 'bg-brand text-white border-brand'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: single remark, fixed height */}
        <div className="flex-1 min-w-0 border border-gray-200 rounded-lg p-2 overflow-y-auto" style={{ height: '9rem' }}>
          {isLoading ? (
            <p className="text-sm text-gray-400">กำลังโหลด...</p>
          ) : total === 0 ? (
            <p className="text-sm text-gray-400">ไม่มีหมายเหตุ</p>
          ) : (
            <div className="bg-gray-50 rounded-lg px-2.5 py-2 h-full">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-mono text-gray-400">{r.trans_remark_date}</span>
                <span className="text-xs text-gray-500 truncate">{r.created_user || r.user_fullname}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{r.description.replace(/\|/g, '\n')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualRemarks({ selectedDate, me }) {
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const dt = selectedDate.replace(/-/g, '');

  const { data: remarks = [], isLoading } = useQuery({
    queryKey: ['manual-remarks', dt],
    queryFn: () => get(`/api/data/remarks?plant_id=2&station_id=20&begin_dt=${dt}&end_dt=${dt}&load_file_data=false`),
    refetchInterval: 300000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: ({ description }) => post('/api/data/remarks', {
      description,
      trans_remark_date: selectedDate.replace(/-/g, ''),
    }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['aquadat-remarks', dt] });
      qc.invalidateQueries({ queryKey: ['manual-remarks', dt] });
    },
  });

  const myName = me?.name;
  const myRemarks = myName
    ? remarks.filter(r => (r.created_user || r.user_fullname) === myName)
    : remarks;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header — clickable to toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <span className="text-base font-semibold text-gray-700">หมายเหตุนักวิทยาศาสตร์</span>
        <span className="text-gray-400 text-lg leading-none font-light">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Remarks list — bordered box */}
          <div className="overflow-y-auto border border-gray-200 rounded-lg p-2" style={{ minHeight: '6rem', maxHeight: '10rem' }}>
            {myRemarks.length === 0 ? (
              <p className="text-sm text-gray-400">ยังไม่มีหมายเหตุของคุณสัปดาห์นี้</p>
            ) : (
              <div className="space-y-1.5">
                {myRemarks.map(r => (
                  <div key={r.trans_remark_id} className="bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
                    <span className="text-xs font-mono text-blue-400 block mb-0.5">{r.trans_remark_date}</span>
                    <p className="text-base text-gray-700">{r.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="บันทึกหมายเหตุ..."
            rows={2}
            className="w-full text-base border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {mutation.error && (
            <p className="text-base text-red-500">{mutation.error.message}</p>
          )}
          <button
            onClick={() => text.trim() && mutation.mutate({ description: text.trim() })}
            disabled={!text.trim() || mutation.isPending}
            className="w-full py-2 rounded-lg bg-brand text-white text-base font-medium
              hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกหมายเหตุ'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Mini Charts Section ───────────────────────────────────────────────────

function MiniChartsSection() {
  const [activeFilter, setActiveFilter] = useState('cw_turbid');

  const def = MINI_FILTERS.find(f => f.key === activeFilter) ?? MINI_FILTERS[0];

  const { data: epidemicData } = useQuery({
    queryKey: ['epidemic'],
    queryFn: () => get('/api/scenarios/epidemic'),
    refetchInterval: 30000,
  });
  const isEpidemic = !!epidemicData?.epidemic;

  const { data: scenarioData } = useQuery({
    queryKey: ['active-scenario'],
    queryFn: () => get('/api/scenarios/active'),
    refetchInterval: 30000,
  });
  const scenarioName = scenarioData?.name ?? 'ปกติ';

  const rule = getThreshold(activeFilter, scenarioName, isEpidemic);

  const { data, isLoading } = useQuery({
    queryKey: ['lab-chart', activeFilter],
    queryFn: () =>
      fetch(LAB_CHART_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ filter: activeFilter }),
      }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    staleTime: CHART_REFRESH_MS,
    refetchInterval: CHART_REFRESH_MS,
  });

  // Resolve Y-axis bounds for the active filter
  function resolveYAxis(yAxisCfg) {
    if (!yAxisCfg) return {};
    // epidemic-aware range
    if (yAxisCfg.normal && yAxisCfg.epidemic) {
      const range = isEpidemic ? yAxisCfg.epidemic : yAxisCfg.normal;
      return { yMin: range.min, yMax: range.max };
    }
    return { yMin: yAxisCfg.min, yMax: yAxisCfg.max };
  }

  const yProps = resolveYAxis(def.yAxis);

  // cards[0..3] from server; fallback to empty arrays while loading
  const cards = data?.cards ?? [[], [], [], []];
  const isSingle = !!def.singleChart;

  // Detect which card indices are BAD (streak ≥ 2) and collect time + value info
  const badInfoMap = {};
  cards.forEach((cardData, i) => {
    const info = latestStreakInfo(cardData, rule);
    if (info.streak >= 2) {
      const vals = cardData.map(d => d.value).filter(v => v != null && !isNaN(v));
      const latestVal = vals.at(-1);
      badInfoMap[i] = { ...info, latestVal };
    }
  });
  const badIndices = Object.keys(badInfoMap).map(Number);
  const hasBad = badIndices.length > 0;

  const [selectedBad, setSelectedBad] = useState(new Set());

  // Clear selection when filter changes or bad set changes
  React.useEffect(() => { setSelectedBad(new Set()); }, [activeFilter, badIndices.join(',')]);

  function toggleBad(i) {
    setSelectedBad(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const { data: carTemplates } = useQuery({
    queryKey: ['car-templates'],
    queryFn: () => get('/api/scenarios/car-templates'),
    staleTime: 60000,
  });
  const templateText = carTemplates?.car_templates?.[activeFilter] ?? '';

  // Format threshold for display
  function fmtThreshold(r) {
    if (!r) return '';
    if (r.type === 'max')   return `≤ ${r.max}`;
    if (r.type === 'range') return `${r.min}–${r.max}`;
    return '';
  }

  // Build message from selected bad cards
  const [carMsg, setCarMsg] = useState('');
  React.useEffect(() => {
    const sel = [...selectedBad].sort();
    if (sel.length === 0) { setCarMsg(''); return; }
    const lines = sel.map(i => {
      const { startSlot, endSlot, latestVal } = badInfoMap[i] ?? {};
      const title = def.cards[i]?.title ?? `#${i + 1}`;
      const timeRange = startSlot && endSlot && startSlot !== endSlot
        ? `${startSlot}–${endSlot}` : startSlot ?? '';
      const valStr = latestVal != null ? `${latestVal} ${def.unit}` : '';
      const threshold = fmtThreshold(rule);
      return `${title} - ${timeRange} - ${valStr} (เกณฑ์: ${threshold})`;
    });
    setCarMsg(templateText ? `${templateText}\n${lines.join('\n')}` : lines.join('\n'));
  }, [selectedBad, templateText, activeFilter]);

  const navigate = useNavigate();

  function goCreateCAR() {
    navigate('/car', { state: { prefill: { parameter_name: carMsg } } });
  }

  function renderCard(i) {
    const isBad = i in badInfoMap;
    const isSelected = selectedBad.has(i);
    const card = (
      <MiniChartCard
        title={def.cards[i]?.title ?? ''}
        unit={def.unit}
        data={cards[i]}
        rule={rule}
        {...yProps}
      />
    );
    if (!isBad) return <React.Fragment key={i}>{card}</React.Fragment>;
    return (
      <div
        key={i}
        onClick={() => toggleBad(i)}
        className={`rounded-xl cursor-pointer transition-all ${
          isSelected
            ? 'ring-2 ring-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.25)]'
            : 'bg-orange-50 ring-1 ring-orange-200'
        }`}
      >
        {card}
      </div>
    );
  }

  // Layout:
  //   normal → 3-col grid, C1 = buttons (spans 2 rows), C2+C3 = 2×2 charts
  //   single → 2-col grid, C1 = buttons, C2 = single chart spanning both rows
  return (
    <div className="space-y-2">
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: isSingle ? '1fr 2fr' : '1fr 1fr 1fr',
          gridTemplateRows: 'auto auto',
        }}
      >
        {/* Filter buttons — always span both rows */}
        <div className="flex flex-col gap-1" style={{ gridRow: '1 / 3' }}>
          {MINI_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex-1 w-full rounded-lg border text-xs font-semibold leading-snug transition-colors text-center whitespace-pre-line px-1 py-1.5
                ${activeFilter === f.key
                  ? 'bg-amber-500 border-amber-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="col-span-2 flex items-center justify-center h-32 text-gray-400 text-sm" style={{ gridRow: '1 / 3' }}>
            กำลังโหลด...
          </div>
        ) : isSingle ? (
          <div style={{ gridRow: '1 / 3' }}>{renderCard(0)}</div>
        ) : (
          <>
            {renderCard(0)}
            {renderCard(1)}
            {renderCard(2)}
            {renderCard(3)}
          </>
        )}
      </div>

      {/* CAR prompt — shown only when any card is BAD */}
      {hasBad && (
        <div className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <textarea
            value={carMsg || 'เลือก chart ที่ต้องการออก CAR...'}
            onChange={e => setCarMsg(e.target.value)}
            rows={selectedBad.size > 1 ? selectedBad.size + 1 : 2}
            readOnly={selectedBad.size === 0}
            className={`flex-1 text-xs border border-red-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-red-400 bg-white ${selectedBad.size === 0 ? 'text-gray-400 italic' : ''}`}
          />
          <button
            onClick={goCreateCAR}
            disabled={selectedBad.size === 0}
            className="shrink-0 px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
          >
            + CAR
          </button>
        </div>
      )}
    </div>
  );
}

// ── Right Column ──────────────────────────────────────────────────────────

function RightColumn({ selectedDate, today, progressNodes, carAnalytics, onSelectDate, me }) {
  return (
    <div className="space-y-4">
      {/* Row 1: Calendar + Todo */}
      <div className="grid grid-cols-2 gap-3">
        <MiniCalendar selectedDate={selectedDate} today={today} onSelectDate={onSelectDate} />
        <TodayTodo progressNodes={progressNodes} selectedDate={selectedDate} today={today} carAnalytics={carAnalytics} />
      </div>

      {/* AquaDAT Queue Banner — แสดงเมื่อมีรายการค้าง */}
      <AquadatQueueBanner />

      {/* Row 2: AquaDAT Remarks */}
      <AquadatRemarks selectedDate={selectedDate} />

      {/* Row 3: Manual Remarks */}
      <ManualRemarks selectedDate={selectedDate} me={me} />

      {/* Row 4: Mini Charts */}
      <MiniChartsSection />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(() => getRefDate());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const qc = useQueryClient();
  const didAutoInit = useRef(false);
  const { collapsed } = useSidebar();

  const { data: progress, isLoading } = useQuery({
    queryKey: ['progress-nodes-today', selectedDate],
    queryFn: () => get(`/api/progress/nodes-today?date=${selectedDate}`),
    refetchInterval: selectedDate === today ? 60000 : false,
  });

  const { data: carAnalytics } = useQuery({
    queryKey: ['car-analytics'],
    queryFn: () => get('/api/car/analytics'),
  });

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });

  async function syncDateToDb(date) {
    const result = await post('/api/aquadat/sync', { date });
    qc.invalidateQueries({ queryKey: ['progress-nodes-today', date] });
    return result;
  }

  useEffect(() => {
    if (didAutoInit.current) return;
    didAutoInit.current = true;
    syncDateToDb(today).catch(() => {});
  }, []);

  async function handleDateChange(newDate) {
    setSelectedDate(newDate);
    setRefDate(newDate);
    setSyncMsg(null);
    try { await syncDateToDb(newDate); } catch {}
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

  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const isPast = selectedDate < today;

  // Layout: 50-50 when sidebar collapsed, 60-40 otherwise
  const leftCls  = collapsed ? 'w-full lg:w-1/2' : 'w-full lg:w-[60%]';
  const rightCls = collapsed ? 'w-full lg:w-1/2' : 'w-full lg:w-[40%]';

  return (
    <div className="space-y-5 w-full">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">
          ภาพรวมประจำวัน
          {isPast && (
            <span className="ml-2 text-sm font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">ย้อนหลัง</span>
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

      <div className="flex gap-5 items-start flex-col lg:flex-row transition-all duration-300">
        {/* Left column */}
        <div className={`${leftCls} space-y-3 transition-all duration-300`}>
          {isLoading ? (
            <div className="text-center py-8 text-gray-400">กำลังโหลดข้อมูล...</div>
          ) : progress ? (
            <>
              <ProgressBar value={progress.totalRecorded} max={progress.totalExpected} />

              {/* Weekly tracking */}
              <WeeklyProgress selectedDate={selectedDate} progressNodes={progress.nodes} />

              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">สถานะรายหัวข้อ</h2>
                <div className="space-y-2">
                  {NODE_GROUPS.map(group => {
                    const nodeMap = Object.fromEntries((progress.nodes || []).map(n => [n.id, n]));
                    const groupNodes = group.nodeIds.map(id => nodeMap[id]).filter(Boolean);
                    return <GroupSection key={group.key} group={group} nodes={groupNodes} selectedDate={selectedDate} />;
                  })}
                  {(() => {
                    const allGrouped = new Set(NODE_GROUPS.flatMap(g => g.nodeIds));
                    const HIDDEN = new Set(['Chemical']);
                    return (progress.nodes || [])
                      .filter(n => !allGrouped.has(n.id) && !HIDDEN.has(n.id))
                      .map(node => <NodeRow key={node.id} node={node} selectedDate={selectedDate} />);
                  })()}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-yellow-800 text-sm">
              ไม่สามารถดึงข้อมูลได้ — กรุณาตรวจสอบการเชื่อมต่อ
            </div>
          )}
        </div>

        {/* Right column */}
        <div className={`${rightCls} transition-all duration-300`}>
          <RightColumn
            selectedDate={selectedDate}
            today={today}
            progressNodes={progress?.nodes}
            carAnalytics={carAnalytics}
            onSelectDate={handleDateChange}
            me={me}
          />
        </div>
      </div>
    </div>
  );
}
