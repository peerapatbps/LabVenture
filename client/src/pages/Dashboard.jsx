import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api.js';
import { Link, useNavigate } from 'react-router-dom';
import { getRefDate, setRefDate } from '../utils/refDate.js';

const NODE_GROUPS = [
  {
    key: 'raw',
    label: 'กลุ่มน้ำดิบ',
    color: 'bg-emerald-700 text-white border-emerald-300',
    nodeIds: ['Incoming', 'JarTest', 'JarTestSummary', 'RW'],
  },
  {
    key: 'prod',
    label: 'กลุ่มน้ำระบบผลิต',
    color: 'bg-blue-800 text-white border-blue-300',
    nodeIds: ['CW_Phase1', 'CW_Phase2', 'CW_Phase3', 'CW_Phase4'],
  },
  {
    key: 'tap',
    label: 'กลุ่มน้ำประปา',
    color: 'bg-amber-700 text-white border-amber-300',
    nodeIds: ['TW12', 'TW34'],
  },
  {
    key: 'special',
    label: 'กลุ่มพิเศษ',
    color: 'bg-rose-800 text-white border-rose-300',
    nodeIds: ['Biological'],
  },
];

// 12 fixed positions based on 2h interval slots
const FIXED_SLOTS = [
  '01:00', '03:00', '05:00', '07:00', '09:00', '11:00',
  '13:00', '15:00', '17:00', '19:00', '21:00', '23:00',
];
const DAILY_POSITION = 6; // daily slot maps to index 6 (13:00 position)

function buildNodeDots(node) {
  const slotMap = {};
  for (const param of node.params) {
    if (param.skip_progress) continue;
    for (const s of param.slots) {
      if (!slotMap[s.slot]) slotMap[s.slot] = { hasDue: false, anyNotDone: false, anyModified: false, modifiedCount: 0 };
      if (s.due) {
        slotMap[s.slot].hasDue = true;
        if (!s.done) slotMap[s.slot].anyNotDone = true;
        if (s.done && s.modified) {
          slotMap[s.slot].anyModified = true;
          slotMap[s.slot].modifiedCount++;
        }
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

// ── DotItem ───────────────────────────────────────────────────────────────

function DotItem({ slot, label, status, modifiedCount, onClickSlot }) {
  const [show, setShow] = useState(false);
  const isClickable = status === 'red' || status === 'amber';

  const dotCls =
    status === 'green'  ? 'bg-green-500 border-green-700 ring-green-200' :
    status === 'red'    ? 'bg-red-400 border-red-600 ring-red-200 cursor-pointer' :
    status === 'amber'  ? 'bg-amber-400 border-amber-600 ring-amber-200 cursor-pointer' :
    status === 'future' ? 'bg-gray-200 border-gray-300' :
                          'bg-gray-100 border-gray-200';

  const tooltipStatus =
    status === 'green'  ? { text: '✓ บันทึกแล้ว',           cls: 'text-green-600' } :
    status === 'red'    ? { text: '✗ ยังไม่บันทึก',         cls: 'text-red-600'   } :
    status === 'amber'  ? { text: `✎ แก้ไขแล้ว (${modifiedCount} ค่า)`, cls: 'text-amber-600' } :
    status === 'future' ? { text: 'ยังไม่ถึงเวลา',           cls: 'text-gray-400'  } :
                          { text: 'ไม่มีรอบนี้',              cls: 'text-gray-400'  };

  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => isClickable && onClickSlot(slot)}
    >
      <div
        className={`w-2.5 h-2.5 rounded-full border-2 transition-transform duration-100
          ${dotCls}
          ${isClickable ? 'hover:scale-150 hover:ring-2' : ''}
        `}
      />
      {show && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none
          bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-md whitespace-nowrap">
          <span className="block text-xs font-mono font-semibold text-gray-800">{label}</span>
          <span className={`block text-xs ${tooltipStatus.cls}`}>{tooltipStatus.text}</span>
        </div>
      )}
    </div>
  );
}

// ── TimelineDots ──────────────────────────────────────────────────────────

function TimelineDots({ node, onClickSlot }) {
  const dots = buildNodeDots(node);
  return (
    <div className="relative flex-1 flex items-center h-6">
      <div className="absolute inset-x-0 h-0.5 bg-gray-200 rounded-full" />
      <div className="relative w-full flex justify-between items-center">
        {dots.map((d, i) => (
          <DotItem
            key={i}
            slot={d.slot}
            label={d.label}
            status={d.status}
            modifiedCount={d.modifiedCount}
            onClickSlot={onClickSlot}
          />
        ))}
      </div>
    </div>
  );
}

// ── NodeRow ───────────────────────────────────────────────────────────────

function NodeRow({ node, selectedDate }) {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];
  const pct = node.totalExpected
    ? Math.round((node.totalRecorded / node.totalExpected) * 100)
    : 0;
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
          <button
            onClick={() => goToRecord(pending)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200
              bg-white hover:bg-gray-50 transition-colors text-xs whitespace-nowrap"
          >
            <span className="font-medium text-gray-700">บันทึก</span>
            <span className="font-mono font-semibold bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-xs">
              {pending}
            </span>
          </button>
        ) : (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-100
            bg-gray-50 text-xs text-gray-400 whitespace-nowrap">
            ✓ ครบแล้ว
          </span>
        )}
      </div>
    </div>
  );
}

// ── GroupSection ──────────────────────────────────────────────────────────

function GroupSection({ group, nodes, selectedDate }) {
  const [open, setOpen] = useState(true);

  const totalRecorded = nodes.reduce((s, n) => s + (n.totalRecorded || 0), 0);
  const totalExpected = nodes.reduce((s, n) => s + (n.totalExpected || 0), 0);
  const pct = totalExpected ? Math.round((totalRecorded / totalExpected) * 100) : 0;

  const borderCls = group.color.split(' ').find(c => c.startsWith('border-')) ?? 'border-gray-200';
  const bgCls     = group.color.split(' ').filter(c => !c.startsWith('border-')).join(' ');

  return (
    <div className={`rounded-xl border overflow-hidden shadow-sm ${borderCls}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 ${bgCls} hover:opacity-90 transition-opacity`}
      >
        <span className="text-sm font-bold tracking-wide">{group.label}</span>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
            ${pct === 100 ? 'bg-green-400 text-white' : 'bg-white/20 text-white'}`}>
            {pct}%
          </span>
          <span className="text-white/80 text-xs font-mono w-4 text-right">{open ? '−' : '+'}</span>
        </div>
      </button>

      {open && (
        <div className="divide-y divide-gray-100">
          {nodes.length === 0 ? (
            <p className="text-xs text-gray-400 px-4 py-3">ไม่มีข้อมูล</p>
          ) : (
            nodes.map(node => <NodeRow key={node.id} node={node} selectedDate={selectedDate} />)
          )}
        </div>
      )}
    </div>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────────

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

// ── RightColumn ───────────────────────────────────────────────────────────

function RightColumn({ carAnalytics }) {
  const overdue = carAnalytics?.overdue?.length ?? 0;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">สถานะ CAR เดือนนี้</h3>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">ค้างเกิน 10 วัน</span>
          <span className={`font-bold ${overdue > 0 ? 'text-red-600' : 'text-green-600'}`}>{overdue} เคส</span>
        </div>
        <Link
          to="/car"
          className="mt-3 block text-center bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium py-1.5 rounded-lg transition-colors"
        >
          ออก CAR ใหม่
        </Link>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">แนวโน้มค่า</h3>
        <div className="h-40 flex items-center justify-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <span className="text-xs text-gray-300">Chart (coming soon)</span>
        </div>
      </div>
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

  const { data: progress, isLoading } = useQuery({
    queryKey: ['progress-nodes-today', selectedDate],
    queryFn: () => get(`/api/progress/nodes-today?date=${selectedDate}`),
    refetchInterval: selectedDate === today ? 60000 : false,
  });

  const { data: carAnalytics } = useQuery({
    queryKey: ['car-analytics'],
    queryFn: () => get('/api/car/analytics'),
  });

  async function syncDateToDb(date) {
    const result = await post('/api/aquadat/sync', { date });
    qc.invalidateQueries({ queryKey: ['progress-nodes-today', date] });
    return result;
  }

  // Auto-init on mount (case 3.2 / 3.3): fill today's gaps from AquaDAT
  useEffect(() => {
    if (didAutoInit.current) return;
    didAutoInit.current = true;
    syncDateToDb(today).catch(() => {}); // silently ignore if AquaDAT unreachable
  }, []);

  // When date changes, init that date from AquaDAT then refetch progress
  async function handleDateChange(newDate) {
    setSelectedDate(newDate);
    setRefDate(newDate);
    setSyncMsg(null);
    try {
      await syncDateToDb(newDate);
    } catch {
      // ignore — progress will still show local data
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await syncDateToDb(selectedDate);
      const inserted = result.inserted ?? 0;
      const skipped = result.skipped ?? 0;
      const rawRows = inserted + skipped;
      const mapped  = inserted;
      if (inserted === 0) {
        setSyncMsg('AquaDAT ไม่มีข้อมูลวันนี้ (อาจต้อง login ใหม่)');
      } else if (false) {
        setSyncMsg(`AquaDAT: ${rawRows} rows — ไม่มี param ที่ตรงกัน`);
      } else {
        setSyncMsg(`อัปเดตแล้ว ${mapped} รายการ`);
      }
    } catch (e) {
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

  return (
    <div className="space-y-5 w-full">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">
          ภาพรวมประจำวัน
          {isPast && (
            <span className="ml-2 text-sm font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              ย้อนหลัง
            </span>
          )}
        </h1>

        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">{syncMsg}</span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            title="ดึงข้อมูลจาก AquaDAT"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white
              hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors text-xs disabled:opacity-40"
          >
            <span className={syncing ? 'animate-spin inline-block' : ''}>⟳</span>
            <span>Sync</span>
          </button>
          <div className="flex flex-col items-end">
            <input
              type="date"
              value={selectedDate}
              max={today}
              onChange={e => handleDateChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <span className="text-xs text-gray-400 mt-0.5">{displayDate}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-5 items-start flex-col lg:flex-row">
        {/* Left 60% */}
        <div className="w-full lg:w-[60%] space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-gray-400">กำลังโหลดข้อมูล...</div>
          ) : progress ? (
            <>
              <ProgressBar value={progress.totalRecorded} max={progress.totalExpected} />
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">สถานะรายหัวข้อ</h2>
                <div className="space-y-2">
                  {NODE_GROUPS.map(group => {
                    const nodeMap = Object.fromEntries((progress.nodes || []).map(n => [n.id, n]));
                    const groupNodes = group.nodeIds.map(id => nodeMap[id]).filter(Boolean);
                    return (
                      <GroupSection
                        key={group.key}
                        group={group}
                        nodes={groupNodes}
                        selectedDate={selectedDate}
                      />
                    );
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

        {/* Right 40% */}
        <div className="w-full lg:w-[40%]">
          <RightColumn carAnalytics={carAnalytics} />
        </div>
      </div>
    </div>
  );
}
