import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api.js';
import { Link, useNavigate } from 'react-router-dom';
import { getRefDate, setRefDate } from '../utils/refDate.js';
import DateSyncBar from '../components/DateSyncBar.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';
import MiniChartCard, { latestStreakInfo } from '../components/MiniChart.jsx';
import { MINI_FILTERS, CHART_REFRESH_MS, LAB_CHART_ENDPOINT, getThreshold } from '../config/chartConfig.js';

const SLOTS_2H = ['01:00','03:00','05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','21:00','23:00'];
const DAILY_POSITION = 6;

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

const ACTIVE_STATIONS = new Set(['RWS1', 'RWS2']);

function toThaiDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── Station timeline dots ──────────────────────────────────────────────────

function StationDot({ slot, isActive, isPast, isCurrent }) {
  const [show, setShow] = useState(false);
  const cls = isActive
    ? 'bg-green-500 border-green-700 ring-green-200'
    : isPast
    ? 'bg-earth-border border-earth-ink3'
    : isCurrent
    ? 'bg-amber-400 border-amber-600 ring-amber-200'
    : 'bg-earth-card border-earth-border';
  const tip = isActive ? '✓ มีข้อมูล' : isPast ? 'ไม่ทราบสถานะ' : isCurrent ? 'รอบปัจจุบัน' : 'ยังไม่ถึงเวลา';
  return (
    <div className="relative flex items-center justify-center"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <div className={`w-2.5 h-2.5 rounded-full border-2 ${cls}`} />
      {show && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-earth-card border border-earth-border rounded-lg px-2 py-1.5 shadow-md whitespace-nowrap">
          <span className="block text-xs font-mono font-semibold text-earth-ink">{slot}</span>
          <span className="block text-xs text-earth-ink2">{tip}</span>
        </div>
      )}
    </div>
  );
}

function StationRow({ station, selectedDate, today }) {
  const navigate = useNavigate();
  const now = new Date();
  const todayStr = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  const isToday = selectedDate === todayStr;
  const currentH = now.getHours();

  const accent = STATION_ACCENTS[station.id] ?? '#8CC0EB';
  const topicCount = station.topics?.length ?? 0;
  const paramCount = station.topics?.reduce((s, t) => s + t.params.length, 0) ?? 0;
  const isActive = ACTIVE_STATIONS.has(station.id);

  function getDotStatus(slot) {
    const slotH = parseInt(slot.split(':')[0], 10);
    if (!isToday) return { isPast: true, isCurrent: false, isActive: false };
    const isCurrent = slotH === currentH || (slotH === currentH - 1);
    const isPast = slotH < currentH;
    return { isPast: isPast && !isCurrent, isCurrent, isActive: false };
  }

  return (
    <div className="rounded-xl border border-earth-border overflow-hidden shadow-sm"
         style={{ borderLeftColor: accent, borderLeftWidth: 4 }}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-earth-card">
        <div>
          <span className="text-sm font-bold text-earth-ink">{station.label}</span>
          <span className="ml-2 text-xs text-earth-ink3">{station.id}</span>
        </div>
        <div className="flex items-center gap-2">
          {isActive ? (
            <button
              onClick={() => navigate(`/op-record?station=${station.id}`)}
              className="text-xs bg-earth-DEFAULT hover:bg-earth-border px-2.5 py-1 rounded-lg border border-earth-border transition-colors text-earth-ink2"
            >
              บันทึก →
            </button>
          ) : (
            <span className="text-xs text-earth-ink3 bg-earth-DEFAULT px-2 py-0.5 rounded-full border border-earth-border">เร็วๆ นี้</span>
          )}
        </div>
      </div>

      {isActive && (
        <div className="flex items-center gap-3 px-3 py-2.5 bg-earth-DEFAULT">
          <div className="w-28 shrink-0">
            <p className="text-xs text-earth-ink3 leading-tight">{topicCount} หัวข้อ · {paramCount} ค่า</p>
          </div>
          {/* Timeline dots */}
          <div className="relative flex-1 flex items-center h-6">
            <div className="absolute inset-x-0 h-0.5 bg-earth-border rounded-full" />
            <div className="relative w-full flex justify-between items-center">
              {SLOTS_2H.map((slot) => {
                const { isPast, isCurrent, isActive: dotActive } = getDotStatus(slot);
                return (
                  <StationDot key={slot} slot={slot} isActive={dotActive} isPast={isPast} isCurrent={isCurrent} />
                );
              })}
            </div>
          </div>
        </div>
      )}
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
    queryKey: ['op-todos'],
    queryFn: () => get('/api/operator/todos'),
    refetchInterval: 60000,
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
  { key: 'RWS1', label: 'RWS#1', station_id: 13 },
  { key: 'RWS2', label: 'RWS#2', station_id: 14 },
  { key: 'TPS',  label: 'TPS',   station_id: 18 },
  { key: 'DPS',  label: 'DPS',   station_id: 19 },
];

function AquadatRemarks({ selectedDate }) {
  const [activeStation, setActiveStation] = useState(AQUADAT_STATIONS[0]);
  const [idx, setIdx] = useState(0);
  const dt = selectedDate.replace(/-/g, '');
  const { data: remarks = [], isLoading } = useQuery({
    queryKey: ['aquadat-remarks-op', dt, activeStation.station_id],
    queryFn: () => get(`/api/data/remarks?plant_id=2&station_id=${activeStation.station_id}&begin_dt=${dt}&end_dt=${dt}&load_file_data=false`),
    refetchInterval: 300000,
    retry: false,
    onSuccess: () => setIdx(0),
  });
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
          <div className="grid grid-cols-2 gap-1">
            {AQUADAT_STATIONS.map(st => (
              <button key={st.key} onClick={() => { setActiveStation(st); setIdx(0); }}
                className={`text-xs font-semibold py-1.5 px-1 rounded-md border transition-colors leading-tight text-center
                  ${activeStation.key === st.key ? 'bg-brand text-white border-brand' : 'bg-earth-card text-earth-ink2 border-earth-border hover:bg-earth-card'}`}>
                {st.label}
              </button>
            ))}
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
  const scenarioName = scenarioData?.name ?? 'ปกติ';
  const rule = getThreshold(activeFilter, scenarioName, isEpidemic);

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
            <MiniChartCard title={def.cards[0]?.title ?? ''} unit={def.unit} data={cards[0]} rule={rule} {...yProps} />
          </div>
        ) : (
          <>
            {[0, 1, 2, 3].map(i => (
              <MiniChartCard key={i} title={def.cards[i]?.title ?? ''} unit={def.unit} data={cards[i]} rule={rule} {...yProps} />
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
          <h2 className="text-sm font-semibold text-earth-ink">สถานะสถานี</h2>
          {stations.length === 0 ? (
            <div className="text-center py-8 text-earth-ink3">กำลังโหลด...</div>
          ) : (
            <div className="space-y-2">
              {[...stations].sort((a, b) => a.sort - b.sort).map(station => (
                <StationRow key={station.id} station={station} selectedDate={selectedDate} today={today} />
              ))}
            </div>
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
