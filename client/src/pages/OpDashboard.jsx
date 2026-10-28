import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api.js';
import { Link, useNavigate } from 'react-router-dom';
import { getRefDate, setRefDate } from '../utils/refDate.js';
import DateSyncBar from '../components/DateSyncBar.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';
import MiniChartCard, { latestStreakInfo } from '../components/MiniChart.jsx';
import { MINI_FILTERS, CHART_REFRESH_MS, LAB_CHART_ENDPOINT, getThreshold } from '../config/chartConfig.js';
import { nowHours, useNow, SlotCell, SlotLegend } from '../components/SlotStrip.jsx';

const STATION_ACCENTS = {
  RWS1:  '#10b981',
  RWS2:  '#14b8a6',
  CHEM1: '#7c3aed',
  CHEM2: '#a21caf',
  TPS:   '#1d4ed8',
  DPS:   '#3730a3',
  FWS:   '#d97706',
  CWS:   '#ea580c',
};

const ACTIVE_STATIONS = new Set(['RWS1', 'RWS2', 'CHEM1', 'CHEM2', 'FWS1', 'FWS2', 'TPS', 'DPS', 'CWS1', 'CWS2']);

// Operator rounds run on the hour, 00:00 → 24:00 (next-day midnight) → 25 hourly columns
const HOURS = Array.from({ length: 25 }, (_, i) => i);
const HOUR_COLS = { gridTemplateColumns: 'repeat(25, minmax(0, 1fr))' };

// Row layout shared by the time axis, station rows and the "now" line so columns stay aligned
const OP_ROW_GRID = 'grid grid-cols-[8.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 px-3';

function toThaiDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
}

function stationAccent(id) {
  return STATION_ACCENTS[id] ?? STATION_ACCENTS[id.replace(/\d+$/, '')] ?? '#8CC0EB';
}

// Status per slot: done · partial · due (current round) · overdue · future · optional
// Values that exist before a round's time (pre-filled in AquaDAT) don't count, so a round that hasn't arrived is always "future".
function opSlotStatus(info, slot, isToday, hoursNow, isOptional) {
  const h = parseInt(slot, 10);
  const arrived = !isToday || hoursNow >= h;
  if (!arrived) return 'future';
  if (info.done) return 'done';
  if (info.partial) return 'partial';
  if (isOptional) return 'optional';
  if (!isToday) return 'overdue';
  return hoursNow >= h + 2 ? 'overdue' : 'due';
}

// Tooltip lines: one per sheet (topic row) when the server sends rows, otherwise a value count
function slotDetail(info) {
  if (Array.isArray(info.rows)) {
    return [`หัวข้อครบ ${info.rec}/${info.count}`,
      ...info.rows.map(r => `${r.done ? '✓' : '✗'} ${r.topic} ${r.rec}/${r.exp}`)];
  }
  return info.count ? `บันทึก ${info.rec}/${info.count} ค่า` : null;
}

function buildStationSlots(stationProgress, isToday, hoursNow) {
  const summary = stationProgress?.slotSummary ?? {};
  const isOptional = stationProgress?.isOptional ?? false;
  return Object.keys(summary).sort().map(slot => ({
    slot,
    status: opSlotStatus(summary[slot], slot, isToday, hoursNow, isOptional),
    extraText: slotDetail(summary[slot]),
  }));
}

function nextPendingOpSlot(slots) {
  return slots.find(d => d.status === 'overdue')?.slot
    ?? slots.find(d => d.status === 'due')?.slot
    ?? null;
}

// ── Station slot strip ─────────────────────────────────────────────────────

function OpTimeAxis() {
  return (
    <div className={`${OP_ROW_GRID} pt-2 pb-1 bg-earth-card rounded-t-xl`}>
      <div />
      <div className="grid gap-[2px]" style={HOUR_COLS}>
        {HOURS.map(h => (
          <span key={h} className="text-center text-[10px] font-mono text-earth-ink3 tabular-nums">
            {h % 2 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <div />
    </div>
  );
}

// Vertical "now" marker. Column h is centred on hour h.
function OpNowLine({ hours }) {
  const pct = Math.min(100, Math.max(0, ((hours + 0.5) / HOURS.length) * 100));
  return (
    <div className={`${OP_ROW_GRID} absolute inset-0 pointer-events-none`} aria-hidden="true">
      <div />
      <div className="relative h-full">
        <div className="absolute top-1 bottom-1 w-0.5 -ml-px rounded-full bg-brand-dark/80" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

function StationRow({ station, selectedDate, isToday, hoursNow, stationProgress }) {
  const navigate = useNavigate();
  const accent = stationAccent(station.id);
  const hasRecord = ACTIVE_STATIONS.has(station.id);
  const isOptional = stationProgress?.isOptional ?? false;
  const slots = buildStationSlots(stationProgress, isToday, hoursNow);
  const pending = hasRecord ? nextPendingOpSlot(slots) : null;

  const stExp = stationProgress?.totalExpected ?? 0;
  const stRec = stationProgress?.totalRecorded ?? 0;
  const slotDone = slots.filter(d => d.status === 'done').length;
  const [rec, exp] = stExp > 0 ? [stRec, stExp] : [slotDone, slots.length];
  const pct = exp ? Math.round((rec / exp) * 100) : 0;

  function goToRecord() {
    navigate(`/op-record?station=${station.id}${isToday ? '' : `&date=${selectedDate}`}`);
  }

  return (
    <div className={`${OP_ROW_GRID} py-2.5 bg-earth-card hover:bg-earth-DEFAULT/60 transition-colors last:rounded-b-xl`}>
      <div className="flex items-stretch gap-2 min-w-0">
        <span className="w-[3px] shrink-0 rounded-full" style={{ backgroundColor: accent }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-earth-ink leading-tight truncate" title={station.label}>{station.label}</p>
            {exp > 0 && <span className="text-xs text-earth-ink2 tabular-nums shrink-0">{rec}/{exp}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-earth-ink3 font-mono">{station.id}</span>
            {isOptional && <span className="text-[10px] text-earth-ink3 bg-earth-DEFAULT px-1.5 rounded border border-earth-border">ไม่บังคับ</span>}
          </div>
          {exp > 0 && (
            <div className="mt-1 h-[3px] rounded-full bg-earth-border overflow-hidden">
              <div className="h-full rounded-full bg-[#A9C08A] transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-[2px]" style={HOUR_COLS}>
        {slots.map(d => (
          <SlotCell key={d.slot} {...d} onClickSlot={goToRecord}
            style={{ gridColumnStart: Math.min(parseInt(d.slot, 10), 24) + 1, gridRowStart: 1 }} />
        ))}
      </div>

      <div className="flex justify-end">
        {!hasRecord ? (
          <span className="text-xs text-earth-ink3 bg-earth-DEFAULT px-2 py-0.5 rounded-full border border-earth-border">เร็วๆ นี้</span>
        ) : pending ? (
          <button onClick={goToRecord}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-earth-border bg-earth-DEFAULT hover:bg-white/60 transition-colors text-xs whitespace-nowrap">
            <span className="font-medium text-earth-ink2">บันทึก</span>
            <span className="font-mono font-semibold bg-[#FBE3DC] text-[#B84A36] px-1.5 py-0.5 rounded text-xs">{pending}</span>
          </button>
        ) : exp > 0 && rec >= exp ? (
          <span className="flex items-center gap-1 px-2.5 py-1 text-xs text-[#5E7A40] whitespace-nowrap">✓ ครบแล้ว</span>
        ) : (
          <button onClick={goToRecord}
            className="text-xs bg-earth-DEFAULT hover:bg-white/60 px-2.5 py-1 rounded-lg border border-earth-border transition-colors text-earth-ink2 whitespace-nowrap">
            บันทึก →
          </button>
        )}
      </div>
    </div>
  );
}

function StationPanel({ stations, progressByStation, selectedDate, isToday }) {
  const now = useNow();
  const hoursNow = nowHours(now);
  return (
    <div className="relative rounded-xl border border-earth-border shadow-sm">
      <OpTimeAxis />
      <div className="divide-y divide-earth-border">
        {stations.map(station => (
          <StationRow key={station.id} station={station} selectedDate={selectedDate}
            isToday={isToday} hoursNow={hoursNow} stationProgress={progressByStation[station.id]} />
        ))}
      </div>
      {isToday && <OpNowLine hours={hoursNow} />}
    </div>
  );
}

function OpProgressBar({ value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  const barColor = pct === 100 ? 'bg-[#A9C08A]' : pct > 50 ? 'bg-brand' : 'bg-[#E8C47A]';
  return (
    <div className="bg-earth-card rounded-xl px-4 py-3 shadow-sm border border-earth-border flex items-center gap-3">
      <span className="text-sm text-earth-ink2 shrink-0">รอบที่บันทึกแล้ว</span>
      <div className="flex-1 h-2.5 bg-earth-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-earth-ink3 font-mono shrink-0 tabular-nums">{value}/{max}</span>
      <span className={`text-sm font-bold shrink-0 tabular-nums ${pct === 100 ? 'text-[#5E7A40]' : 'text-brand-dark'}`}>{pct}%</span>
    </div>
  );
}

// ── Reused components from Dashboard (right column) ───────────────────────

function MiniCalendar({ selectedDate, today, onSelectDate }) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const { year, month } = viewDate;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthLabel = new Date(year, month, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
  const DAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return (
    <div className="bg-earth-card rounded-xl p-3 shadow-sm border border-earth-border select-none">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setViewDate(v => { const d = new Date(v.year, v.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-earth-ink3 hover:text-earth-ink px-1 text-xl leading-none">‹</button>
        <span className="text-sm font-semibold text-earth-ink">{monthLabel}</span>
        <button onClick={() => setViewDate(v => { const d = new Date(v.year, v.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-earth-ink3 hover:text-earth-ink px-1 text-xl leading-none">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAY_LABELS.map(d => <div key={d} className="text-center text-xs text-earth-ink2 font-semibold py-0.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds = dateStr(day);
          const isToday = ds === today;
          const isSelected = ds === selectedDate;
          const isFuture = ds > today;
          return (
            <button key={i} disabled={isFuture} onClick={() => !isFuture && onSelectDate(ds)}
              className={`text-sm rounded-md py-1 leading-none transition-colors font-medium
                ${isSelected ? 'bg-brand text-white font-bold' :
                  isToday ? 'bg-brand-dark text-white font-semibold' :
                  isFuture ? 'text-earth-border cursor-default' :
                  'text-earth-ink2 hover:bg-earth-DEFAULT'}`}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OpTodoPanel({ selectedDate, today }) {
  const navigate = useNavigate();
  const { data: todos } = useQuery({
    queryKey: ['op-todos', selectedDate],
    queryFn: () => get('/api/operator/todos'),
    refetchInterval: selectedDate === today ? 15 * 60 * 1000 : false,
  });
  const items = todos?.todos ?? [];

  return (
    <div className="bg-earth-DEFAULT rounded-xl p-3 shadow-sm border border-earth-border flex flex-col">
      <h3 className="text-base font-semibold text-earth-ink mb-2">
        รายการค้างวันนี้
        {items.length > 0 && <span className="ml-1.5 text-red-500 font-bold">{items.length}</span>}
      </h3>
      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-base text-green-500 font-medium">✓ ไม่มีรายการค้าง</span>
        </div>
      ) : (
        <div className="space-y-1 overflow-y-auto max-h-40">
          {items.map((item, i) => (
            <button key={i}
              onClick={() => navigate(`/op-record?station=${item.station_id}`)}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors text-left">
              <span className="text-base font-mono font-semibold text-red-700">{item.station_id}</span>
              <span className="text-base text-red-500">{item.message} →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Reuse AquadatRemarks and ManualRemarks logic from Dashboard
const AQUADAT_STATIONS = [
  { key: 'RWS1', label: 'RWS#1', station_id: 13, trans_type: 'rws' },
  { key: 'RWS2', label: 'RWS#2', station_id: 14, trans_type: 'rws' },
  { key: 'CDS1', label: 'CDS#1', station_id: 15, trans_type: 'cds' },
  { key: 'CDS2', label: 'CDS#2', station_id: 62, trans_type: 'cds' },
  { key: 'CWS1', label: 'CWS#1', station_id: 16, trans_type: 'cws' },
  { key: 'CWS2', label: 'CWS#2', station_id: 63, trans_type: 'cws' },
  { key: 'FWS1', label: 'FWS#1', station_id: 17, trans_type: 'fws' },
  { key: 'FWS2', label: 'FWS#2', station_id: 64, trans_type: 'fws' },
  { key: 'TPS',  label: 'TPS',   station_id: 18, trans_type: 'tps' },
  { key: 'DPS',  label: 'DPS',   station_id: 19, trans_type: 'dps' },
  { key: 'QWS',  label: 'QWS',   station_id: 20, trans_type: 'qws' },
];

function AquadatRemarks({ selectedDate }) {
  const [activeStation, setActiveStation] = useState(AQUADAT_STATIONS[0]);
  const [idx, setIdx] = useState(0);
  const dt = selectedDate.replace(/-/g, '');
  const { data: allRemarks = [], isLoading } = useQuery({
    queryKey: ['aquadat-remarks-op', dt],
    queryFn: () => get(`/api/data/remarks?plant_id=2&station_id=0&begin_dt=${dt}&end_dt=${dt}&load_file_data=false`),
    refetchInterval: 300000,
    retry: false,
  });
  const typesWithData = new Set(allRemarks.map(r => r.trans_type));
  const remarks = allRemarks.filter(r => r.trans_type === activeStation.trans_type);
  const total = remarks.length;
  const safeIdx = total > 0 ? Math.min(idx, total - 1) : 0;
  const r = remarks[safeIdx];

  return (
    <div className="bg-earth-DEFAULT rounded-xl p-3 shadow-sm border border-earth-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-earth-ink">หมายเหตุจาก AquaDAT</h3>
        {total > 1 && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={safeIdx === 0}
              className="w-6 h-6 flex items-center justify-center rounded border border-earth-border text-earth-ink2 hover:bg-earth-card disabled:opacity-30 text-sm leading-none">‹</button>
            <span className="text-xs text-earth-ink3 font-mono">{safeIdx + 1}/{total}</span>
            <button onClick={() => setIdx(i => Math.min(total - 1, i + 1))} disabled={safeIdx === total - 1}
              className="w-6 h-6 flex items-center justify-center rounded border border-earth-border text-earth-ink2 hover:bg-earth-card disabled:opacity-30 text-sm leading-none">›</button>
          </div>
        )}
      </div>
      <div className="flex gap-3">
        <div className="shrink-0">
          <div className="grid grid-cols-3 gap-1">
            {AQUADAT_STATIONS.map(st => {
              const isActive = activeStation.key === st.key;
              const hasData = typesWithData.has(st.trans_type);
              return (
                <button key={st.key} onClick={() => { setActiveStation(st); setIdx(0); }}
                  className={`text-xs font-semibold py-1.5 px-1 rounded-md border transition-colors leading-tight text-center
                    ${isActive ? 'bg-brand text-white border-brand'
                      : hasData ? 'bg-earth-card text-brand border-brand hover:bg-earth-DEFAULT'
                      : 'bg-earth-card text-earth-ink2 border-earth-border hover:bg-earth-card'}`}>
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 min-w-0 border border-earth-border rounded-lg p-2 overflow-y-auto" style={{ height: '9rem' }}>
          {isLoading ? <p className="text-sm text-earth-ink3">กำลังโหลด...</p> :
            total === 0 ? <p className="text-sm text-earth-ink3">ไม่มีหมายเหตุ</p> : (
              <div className="bg-earth-DEFAULT rounded-lg px-2.5 py-2 h-full">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-mono text-earth-ink3">{r.trans_remark_date}</span>
                  <span className="text-xs text-earth-ink2 truncate">{r.created_user || r.user_fullname}</span>
                </div>
                <p className="text-sm text-earth-ink leading-relaxed whitespace-pre-line">{r.description.replace(/\|/g, '\n')}</p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function MiniChartsSection() {
  const [activeFilter, setActiveFilter] = useState('cw_turbid');
  const def = MINI_FILTERS.find(f => f.key === activeFilter) ?? MINI_FILTERS[0];

  const { data: epidemicData } = useQuery({ queryKey: ['epidemic'], queryFn: () => get('/api/scenarios/epidemic'), refetchInterval: 30000 });
  const isEpidemic = !!epidemicData?.epidemic;
  const { data: scenarioData } = useQuery({ queryKey: ['active-scenario'], queryFn: () => get('/api/scenarios/active'), refetchInterval: 30000 });
  // one rule per chart card (phase) from the active scenario's LCL/UCL
  const rules = [0, 1, 2, 3].map(i => getThreshold(activeFilter, scenarioData?.thresholds, i));

  const { data, isLoading } = useQuery({
    queryKey: ['lab-chart', activeFilter],
    queryFn: () => fetch(LAB_CHART_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ filter: activeFilter }),
    }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    staleTime: CHART_REFRESH_MS,
    refetchInterval: CHART_REFRESH_MS,
  });

  const cards = data?.cards ?? [[], [], [], []];
  const isSingle = !!def.singleChart;

  function resolveYAxis(yAxisCfg) {
    if (!yAxisCfg) return {};
    if (yAxisCfg.normal && yAxisCfg.epidemic) {
      const range = isEpidemic ? yAxisCfg.epidemic : yAxisCfg.normal;
      return { yMin: range.min, yMax: range.max };
    }
    return { yMin: yAxisCfg.min, yMax: yAxisCfg.max };
  }
  const yProps = resolveYAxis(def.yAxis);

  return (
    <div className="space-y-2">
      <div className="grid gap-2" style={{ gridTemplateColumns: isSingle ? '1fr 2fr' : '1fr 1fr 1fr', gridTemplateRows: 'auto auto' }}>
        <div className="flex flex-col gap-1" style={{ gridRow: '1 / 3' }}>
          {MINI_FILTERS.map(f => (
            <button key={f.key} onClick={() => setActiveFilter(f.key)}
              className={`flex-1 w-full rounded-lg border text-xs font-semibold leading-snug transition-colors text-center whitespace-pre-line px-1 py-1.5
                ${activeFilter === f.key ? 'bg-amber-500 border-amber-600 text-white' : 'bg-earth-DEFAULT border-earth-border text-earth-ink2 hover:bg-earth-card'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {isLoading ? (
          <div className="col-span-2 flex items-center justify-center h-32 text-earth-ink3 text-sm" style={{ gridRow: '1 / 3' }}>กำลังโหลด...</div>
        ) : isSingle ? (
          <div style={{ gridRow: '1 / 3' }}>
            <MiniChartCard title={def.cards[0]?.title ?? ''} unit={def.unit} data={cards[0]} rule={rules[0]} {...yProps} />
          </div>
        ) : (
          <>
            {[0, 1, 2, 3].map(i => (
              <MiniChartCard key={i} title={def.cards[i]?.title ?? ''} unit={def.unit} data={cards[i]} rule={rules[i]} {...yProps} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function RightColumn({ selectedDate, today, onSelectDate, me }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MiniCalendar selectedDate={selectedDate} today={today} onSelectDate={onSelectDate} />
        <OpTodoPanel selectedDate={selectedDate} today={today} />
      </div>
      <AquadatRemarks selectedDate={selectedDate} />
      <MiniChartsSection />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function OpDashboard() {
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(() => getRefDate());
  const { collapsed } = useSidebar();

  const { data: opNodes } = useQuery({
    queryKey: ['op-nodes'],
    queryFn: () => get('/api/operator/nodes'),
    staleTime: 300000,
  });

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });

  const isToday = selectedDate === today;
  const { data: progressData } = useQuery({
    queryKey: ['op-progress', selectedDate],
    queryFn: () => get(`/api/operator/progress?date=${selectedDate}`),
    refetchInterval: isToday ? 5 * 60 * 1000 : false,
    staleTime: isToday ? 4.5 * 60 * 1000 : 300000,
  });

  const progressByStation = useMemo(() => {
    const map = {};
    for (const st of (progressData?.stations ?? [])) map[st.station_id] = st;
    return map;
  }, [progressData]);

  function handleDateChange(newDate) {
    setSelectedDate(newDate);
    setRefDate(newDate);
  }

  const isPast = selectedDate < today;
  const leftCls  = collapsed ? 'w-full lg:w-1/2' : 'w-full lg:w-[60%]';
  const rightCls = collapsed ? 'w-full lg:w-1/2' : 'w-full lg:w-[40%]';

  const stations = opNodes?.stations ?? [];

  return (
    <div className="space-y-5 w-full">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-earth-ink">
          ภาพรวม Operator
          {isPast && (
            <span className="ml-2 text-sm font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">ย้อนหลัง</span>
          )}
        </h1>
        <DateSyncBar
          date={selectedDate}
          onDateChange={handleDateChange}
          onSync={() => {}}
          syncing={false}
          syncMsg={null}
          maxDate={today}
        />
      </div>

      <div className="flex gap-5 items-start flex-col lg:flex-row transition-all duration-300">
        {/* Left column — station list */}
        <div className={`${leftCls} space-y-3 transition-all duration-300`}>
          {progressData && (
            <OpProgressBar value={progressData.totalRecorded} max={progressData.totalExpected} />
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-earth-ink">สถานะสถานี</h2>
            <SlotLegend items={['done', 'partial', 'due', 'overdue', 'future', 'optional']} />
          </div>
          {stations.length === 0 ? (
            <div className="text-center py-8 text-earth-ink3">กำลังโหลด...</div>
          ) : (
            <StationPanel stations={[...stations].sort((a, b) => a.sort - b.sort)}
              progressByStation={progressByStation} selectedDate={selectedDate} isToday={isToday} />
          )}
        </div>

        {/* Right column */}
        <div className={`${rightCls} transition-all duration-300`}>
          <RightColumn
            selectedDate={selectedDate}
            today={today}
            onSelectDate={handleDateChange}
            me={me}
          />
        </div>
      </div>
    </div>
  );
}
