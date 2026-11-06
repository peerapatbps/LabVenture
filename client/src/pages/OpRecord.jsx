import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GridLayout } from 'react-grid-layout';
import { get, post, patch, del, BASE } from '../api.js';
import { isSuperadmin } from '../config/pageAccess.js';
import { initRefDate, setRefDate, confirmNonToday, isToday, fmtThaiDate, todayThai } from '../utils/refDate.js';
import DateSyncBar from '../components/DateSyncBar.jsx';
import MiniChartCard from '../components/MiniChart.jsx';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { ChemAccuracyWall, buildChemDonutRows } from '../components/ChemAccuracyWall.jsx';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { FWS_BW_PHASES, parseBWPhase } from '../../../server/shared/dailyReportRules.mjs';

// ── Constants ────────────────────────────────────────────────────────────────

// Reference slot arrays for heatmap display (hourly reference grid)
const SLOTS_2H = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');
const SLOTS_1H = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');

function topicSlots(topic) {
  if (Array.isArray(topic?.time_slots)) return topic.time_slots;
  const count = topic?.time_slot;
  if (count === 13) return Array.from({ length: 13 }, (_, i) => String(i * 2).padStart(2, '0') + ':00');
  if (count === 25) return Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');
  if (count === 9)  return Array.from({ length: 9 },  (_, i) => String(i * 3).padStart(2, '0') + ':00');
  // legacy fallback
  const ra = topic?.record_at;
  if (ra === 'every2h') return Array.from({ length: 13 }, (_, i) => String(i * 2).padStart(2, '0') + ':00');
  if (ra === 'every1h') return Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');
  if (Array.isArray(ra)) return ra;
  return Array.from({ length: 13 }, (_, i) => String(i * 2).padStart(2, '0') + ':00');
}

const STATION_TABS = [
  { id: 'DAILY', label: 'Daily Report', color: 'bg-slate-800' },
  { id: 'RWS1',  label: 'RWS#1',  color: 'bg-emerald-700' },
  { id: 'RWS2',  label: 'RWS#2',  color: 'bg-teal-700'    },
  { id: 'CHEM1', label: 'CHEM#1', color: 'bg-violet-700'  },
  { id: 'CHEM2', label: 'CHEM#2', color: 'bg-fuchsia-700' },
  { id: 'TPS',   label: 'TPS',     color: 'bg-blue-700'    },
  { id: 'DPS',   label: 'DPS',     color: 'bg-indigo-700'  },
  { id: 'CWS1',  label: 'CWS#1',   color: 'bg-orange-700'  },
  { id: 'CWS2',  label: 'CWS#2',   color: 'bg-orange-800'  },
  { id: 'FWS1',  label: 'FWS#1',   color: 'bg-amber-700'   },
  { id: 'FWS2',  label: 'FWS#2',   color: 'bg-amber-800'   },
];

const ACTIVE_STATIONS = new Set(['DAILY', 'RWS1', 'RWS2', 'CHEM1', 'CHEM2', 'TPS', 'DPS', 'CWS1', 'CWS2', 'FWS1', 'FWS2']);

const TOPIC_COLORS = {
  // Legacy names
  'Flow':          { header: 'bg-emerald-700 text-white', border: 'border-emerald-300', tag: 'bg-emerald-100 text-emerald-800' },
  'Status':        { header: 'bg-sky-700 text-white',     border: 'border-sky-300',     tag: 'bg-sky-100 text-sky-800'         },
  'Power':         { header: 'bg-yellow-700 text-white',  border: 'border-yellow-300',  tag: 'bg-yellow-100 text-yellow-800'   },
  'Energy Feeder': { header: 'bg-purple-700 text-white',  border: 'border-purple-300',  tag: 'bg-purple-100 text-purple-800'   },
  'Energy Pump':   { header: 'bg-indigo-700 text-white',  border: 'border-indigo-300',  tag: 'bg-indigo-100 text-indigo-800'   },
  'Temperature':   { header: 'bg-rose-700 text-white',    border: 'border-rose-300',    tag: 'bg-rose-100 text-rose-800'       },
  'Compensate':    { header: 'bg-cyan-700 text-white',    border: 'border-cyan-300',    tag: 'bg-cyan-100 text-cyan-800'       },
  'Other':         { header: 'bg-gray-600 text-white',    border: 'border-earth-border',    tag: 'bg-earth-card text-earth-ink'       },
  'Overview':      { header: 'bg-teal-700 text-white',    border: 'border-teal-300',    tag: 'bg-teal-100 text-teal-800'       },
  'Property':      { header: 'bg-blue-700 text-white',    border: 'border-blue-300',    tag: 'bg-blue-100 text-blue-800'       },
  'Energy':        { header: 'bg-amber-700 text-white',   border: 'border-amber-300',   tag: 'bg-amber-100 text-amber-800'     },
  'Sludge':        { header: 'bg-orange-800 text-white',  border: 'border-orange-300',  tag: 'bg-orange-100 text-orange-800'   },
  'Drain':         { header: 'bg-slate-700 text-white',   border: 'border-slate-300',   tag: 'bg-slate-100 text-slate-700'     },
  'Speed':         { header: 'bg-violet-700 text-white',  border: 'border-violet-300',  tag: 'bg-violet-100 text-violet-800'   },
  'FTR Runtime':   { header: 'bg-lime-700 text-white',    border: 'border-lime-300',    tag: 'bg-lime-100 text-lime-800'       },
  'Backwashing':   { header: 'bg-cyan-800 text-white',    border: 'border-cyan-300',    tag: 'bg-cyan-100 text-cyan-900'       },
  'Backwashing#3': { header: 'bg-cyan-800 text-white',    border: 'border-cyan-300',    tag: 'bg-cyan-100 text-cyan-900'       },
  'Backwashing#4': { header: 'bg-cyan-700 text-white',    border: 'border-cyan-300',    tag: 'bg-cyan-100 text-cyan-800'       },
  'LEVEL':         { header: 'bg-indigo-700 text-white',  border: 'border-indigo-300',  tag: 'bg-indigo-100 text-indigo-800'   },
  'Level':         { header: 'bg-indigo-700 text-white',  border: 'border-indigo-300',  tag: 'bg-indigo-100 text-indigo-800'   },
  // Excel-sourced topic names
  'FLOW RPS1':               { header: 'bg-emerald-700 text-white', border: 'border-emerald-300', tag: 'bg-emerald-100 text-emerald-800' },
  'FLOW RPS2':               { header: 'bg-emerald-600 text-white', border: 'border-emerald-300', tag: 'bg-emerald-100 text-emerald-800' },
  'CURRENT TEMP':            { header: 'bg-rose-700 text-white',    border: 'border-rose-300',    tag: 'bg-rose-100 text-rose-800'       },
  'PUMP TEMP':               { header: 'bg-rose-600 text-white',    border: 'border-rose-300',    tag: 'bg-rose-100 text-rose-800'       },
  'POWER / SPEED / BATTERY': { header: 'bg-yellow-700 text-white',  border: 'border-yellow-300',  tag: 'bg-yellow-100 text-yellow-800'   },
  'PUMP STATUS':             { header: 'bg-sky-700 text-white',     border: 'border-sky-300',     tag: 'bg-sky-100 text-sky-800'         },
  'PUMP TOTALIZER & IHM':   { header: 'bg-teal-700 text-white',    border: 'border-teal-300',    tag: 'bg-teal-100 text-teal-800'       },
  'FEEDER 5&6':              { header: 'bg-purple-700 text-white',  border: 'border-purple-300',  tag: 'bg-purple-100 text-purple-800'   },
  'COMPENSATE':              { header: 'bg-cyan-700 text-white',    border: 'border-cyan-300',    tag: 'bg-cyan-100 text-cyan-800'       },
  'other':                   { header: 'bg-gray-600 text-white',    border: 'border-earth-border',    tag: 'bg-earth-card text-earth-ink'       },
};
const DEFAULT_TOPIC_COLOR = { header: 'bg-gray-700 text-white', border: 'border-earth-border', tag: 'bg-earth-card text-earth-ink' };

// ── Cell type detection ──────────────────────────────────────────────────────

function getCellType(param) {
  const t = (param.type || '').trim();
  if (t.startsWith('TEXT{')) return 'text';
  return 'number';
}

// Returns options array for TEXT{...} type, or null for numeric types
function getCellOptions(param) {
  const t = (param.type || '').trim();
  if (t.startsWith('TEXT{') && t.endsWith('}')) {
    return t.slice(5, -1).split(',').map(s => s.trim()).filter(Boolean);
  }
  return null;
}

// ── Widget catalog ───────────────────────────────────────────────────────────

const WIDGET_CATALOG = [
  { type: 'trend_line',   label: 'Trend Line',    icon: '📈', desc: 'Time-series ของ parameter ตลอดวัน',   dW: 4, dH: 4 },
  { type: 'gauge',        label: 'Gauge',          icon: '🔵', desc: 'ค่าปัจจุบัน vs ช่วงปกติ',             dW: 2, dH: 3 },
  { type: 'pump_status',  label: 'Pump Status',    icon: '⚙️', desc: 'ตาราง ON/OFF ของทุก pump',            dW: 4, dH: 3 },
  { type: 'totalizer',    label: 'Totalizer',      icon: '💧', desc: 'ปริมาณน้ำสะสม + progress',            dW: 3, dH: 2 },
  { type: 'temp_matrix',  label: 'Temp Matrix',    icon: '🌡️', desc: 'Heatmap อุณหภูมิ sensor × pump',      dW: 4, dH: 4 },
  { type: 'energy_bar',   label: 'Energy Bar',     icon: '⚡', desc: 'Bar chart พลังงานต่อ pump',           dW: 4, dH: 3 },
  { type: 'running_hrs',  label: 'Running Hours',  icon: '⏱️', desc: 'I.H.M. ชั่วโมงทำงานแต่ละ pump',      dW: 3, dH: 3 },
  { type: 'basin_level',  label: 'Basin Level',    icon: '🏊', desc: 'ระดับน้ำใน basin',                    dW: 2, dH: 3 },
  { type: 'comparison',   label: 'Day Compare',    icon: '📊', desc: 'เปรียบเทียบวันนี้ vs เมื่อวาน',       dW: 4, dH: 3 },
  { type: 'slot_heatmap', label: 'Slot Heatmap',   icon: '🗓️', desc: 'ภาพรวมการบันทึกข้อมูลแต่ละรอบ',      dW: 6, dH: 2 },
];

// ── Widget body renderers ────────────────────────────────────────────────────

function WidgetBody({ widget, history, stationDef }) {
  const { widget_type, config } = widget;

  if (widget_type === 'trend_line') {
    const topic = stationDef?.topics?.find(t => t.topic === config?.topic);
    const param = topic?.params?.find(p => p.configparam_id === config?.configparam_id);
    if (!param) return <Empty icon="📈">คลิก ⚙️ เพื่อเลือก parameter</Empty>;
    const slots = topicSlots(topic);
    const data = slots.map(s => ({ slot: s, value: parseFloat(history[param.configparam_id]?.[s]) || null })).filter(d => d.value !== null);
    return <div className="flex-1 min-h-0"><MiniChartCard title={`${param.equipment_name} ${param.param_name}`} data={data} unit={param.unit} rule={null} /></div>;
  }

  if (widget_type === 'slot_heatmap') {
    const topics = stationDef?.topics || [];
    return (
      <div className="flex-1 overflow-auto p-2">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr>
              <th className="px-1 pb-1 text-earth-ink3 font-normal text-left text-[11px]">Topic</th>
              {SLOTS_2H.map(s => <th key={s} className="px-0.5 text-earth-ink3 font-normal text-[10px]">{s.replace(':00','')}</th>)}
            </tr>
          </thead>
          <tbody>
            {topics.map(t => {
              const tSlots = topicSlots(t);
              return (
                <tr key={t.topic}>
                  <td className="pr-2 text-earth-ink2 font-medium whitespace-nowrap text-[11px]">{t.topic}</td>
                  {SLOTS_2H.map(s => {
                    const ok = tSlots.includes(s);
                    const filled = ok && t.params.some(p => history[p.configparam_id]?.[s] !== undefined);
                    return (
                      <td key={s} className="p-0.5">
                        <div className={`w-4 h-4 rounded-sm mx-auto ${!ok ? 'bg-gray-100' : filled ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (widget_type === 'pump_status') {
    const statusTopic = stationDef?.topics?.find(t => t.topic === 'Status');
    const pumps = {};
    statusTopic?.params?.forEach(p => {
      if (!pumps[p.equipment_name]) pumps[p.equipment_name] = {};
      const slot = SLOTS_2H.filter(s => history[p.configparam_id]?.[s] !== undefined).at(-1);
      pumps[p.equipment_name][p.param_name] = slot ? history[p.configparam_id]?.[slot] : null;
    });
    return (
      <div className="flex-1 overflow-auto p-2 flex flex-wrap gap-2 content-start">
        {Object.entries(pumps).map(([pump, vals]) => {
          const st = vals['STATUS PUMP'];
          const isOn = st === 'ON' || st === '1' || st === 'RUN';
          return (
            <div key={pump} className={`rounded-lg px-2 py-1 text-xs font-semibold border ${isOn ? 'bg-green-100 border-green-300 text-green-800' : st == null ? 'bg-gray-100 border-earth-border text-earth-ink3' : 'bg-red-100 border-red-200 text-red-700'}`}>
              {pump}
              <div className="text-[10px] font-normal">{isOn ? 'RUN' : st == null ? '—' : st}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (widget_type === 'basin_level') {
    const fp = stationDef?.topics?.find(t => t.topic === 'Flow')?.params?.find(p => p.param_name === 'LEVEL');
    const slot = fp ? SLOTS_2H.filter(s => history[fp.configparam_id]?.[s] !== undefined).at(-1) : null;
    const val = slot ? parseFloat(history[fp?.configparam_id]?.[slot]) : null;
    const pct = val !== null ? Math.min(100, Math.max(0, (val / 5) * 100)) : 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <div className="text-3xl font-bold text-blue-700">{val !== null ? `${val} m` : '—'}</div>
        <div className="w-full h-4 bg-earth-border rounded-full overflow-hidden">
          <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-earth-ink3">Basin Level</div>
      </div>
    );
  }

  const meta = WIDGET_CATALOG.find(c => c.type === widget_type);
  return <Empty icon={meta?.icon || '📦'}>{meta?.label} — coming soon</Empty>;
}

function Empty({ icon, children }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-earth-ink3 gap-1 p-4 text-center">
      <span className="text-3xl">{icon}</span>
      <span className="text-xs">{children}</span>
    </div>
  );
}

// ── Widget card in canvas ────────────────────────────────────────────────────

function WidgetCard({ widget, history, stationDef, onRemove, onConfigure }) {
  const meta         = WIDGET_CATALOG.find(c => c.type === widget.widget_type);
  const configurable = CONFIGURABLE.has(widget.widget_type);
  return (
    <div className="h-full flex flex-col bg-earth-DEFAULT rounded-xl border border-earth-border shadow-sm overflow-hidden">
      <div className="drag-handle flex items-center justify-between px-2 py-1.5 bg-gray-800 text-white shrink-0 cursor-grab select-none">
        <span className="text-xs font-semibold flex items-center gap-1.5">{meta?.icon} {meta?.label}</span>
        <div className="flex items-center gap-1 no-drag">
          {configurable && (
            <button
              onClick={() => onConfigure(widget)}
              className="text-earth-ink3 hover:text-white text-xs px-1.5 py-0.5 rounded transition-colors"
              title="ตั้งค่า parameter"
            >⚙️</button>
          )}
          <button onClick={() => onRemove(widget.id)} className="text-earth-ink3 hover:text-white text-sm px-1 leading-none">✕</button>
        </div>
      </div>
      <WidgetBody widget={widget} history={history} stationDef={stationDef} />
    </div>
  );
}

// ── Widget config modal ──────────────────────────────────────────────────────

// Widget types that support param selection
const CONFIGURABLE = new Set(['trend_line', 'gauge', 'totalizer', 'comparison']);

function WidgetConfigModal({ widget, stationDef, onSave, onClose }) {
  const meta  = WIDGET_CATALOG.find(c => c.type === widget.widget_type);
  const cfg   = widget.config || {};

  const [selTopic, setSelTopic]   = useState(cfg.topic || stationDef?.topics?.[0]?.topic || '');
  const [selParam, setSelParam]   = useState(cfg.configparam_id ?? null);
  const [rangeMin, setRangeMin]   = useState(cfg.rangeMin ?? '');
  const [rangeMax, setRangeMax]   = useState(cfg.rangeMax ?? '');

  const topicDef  = stationDef?.topics?.find(t => t.topic === selTopic);
  const paramList = topicDef?.params || [];

  // When topic changes, reset param selection
  function handleTopicChange(t) {
    setSelTopic(t);
    setSelParam(null);
  }

  function handleConfirm() {
    if (!selParam) return;
    const newConfig = { topic: selTopic, configparam_id: selParam };
    if (widget.widget_type === 'gauge') {
      if (rangeMin !== '') newConfig.rangeMin = parseFloat(rangeMin);
      if (rangeMax !== '') newConfig.rangeMax = parseFloat(rangeMax);
    }
    onSave(newConfig);
  }

  const selectedParamMeta = paramList.find(p => p.configparam_id === selParam);
  const isReady = !!selParam;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-earth-DEFAULT rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-earth-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">{meta?.icon}</span>
            <div>
              <p className="font-bold text-earth-ink text-sm">ตั้งค่า {meta?.label}</p>
              <p className="text-xs text-earth-ink3">เลือก topic และ parameter ที่ต้องการแสดง</p>
            </div>
          </div>
          <button onClick={onClose} className="text-earth-ink3 hover:text-earth-ink text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Step 1 — Topic */}
          <div>
            <p className="text-xs font-semibold text-earth-ink2 uppercase tracking-wider mb-2">① Topic</p>
            <div className="flex flex-wrap gap-2">
              {stationDef?.topics?.map(t => {
                const tc  = TOPIC_COLORS[t.topic] ?? DEFAULT_TOPIC_COLOR;
                const on  = selTopic === t.topic;
                return (
                  <button
                    key={t.topic}
                    onClick={() => handleTopicChange(t.topic)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-all
                      ${on ? `${tc.header} border-transparent shadow-sm` : 'bg-earth-DEFAULT text-earth-ink2 border-earth-border hover:border-earth-border'}`}
                  >
                    {t.topic}
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${on ? 'bg-white/25' : tc.tag}`}>{t.params.length}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2 — Parameter */}
          {topicDef && (
            <div>
              <p className="text-xs font-semibold text-earth-ink2 uppercase tracking-wider mb-2">② Parameter</p>
              <div className="border border-earth-border rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                {paramList.map((p, i) => {
                  const on = selParam === p.configparam_id;
                  return (
                    <button
                      key={p.configparam_id}
                      onClick={() => setSelParam(p.configparam_id)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors
                        ${i > 0 ? 'border-t border-gray-50' : ''}
                        ${on ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-earth-DEFAULT'}`}
                    >
                      <div>
                        <span className="text-sm font-semibold text-earth-ink">{p.equipment_name}</span>
                        <span className="text-sm text-earth-ink2 ml-2">{p.param_name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.unit && <span className="text-xs text-earth-ink3 bg-earth-card px-2 py-0.5 rounded-full">{p.unit}</span>}
                        {on && <span className="text-blue-500 text-base">✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 3 — Range (gauge only) */}
          {widget.widget_type === 'gauge' && selParam && (
            <div>
              <p className="text-xs font-semibold text-earth-ink2 uppercase tracking-wider mb-2">③ Range (ตัวเลือก)</p>
              <div className="flex gap-3">
                <label className="flex-1">
                  <span className="text-xs text-earth-ink3 block mb-1">Min</span>
                  <input type="number" step="any" value={rangeMin} onChange={e => setRangeMin(e.target.value)}
                    placeholder="auto" className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </label>
                <label className="flex-1">
                  <span className="text-xs text-earth-ink3 block mb-1">Max</span>
                  <input type="number" step="any" value={rangeMax} onChange={e => setRangeMax(e.target.value)}
                    placeholder="auto" className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Preview strip */}
        {selectedParamMeta && (
          <div className="mx-5 mb-0 px-4 py-2.5 bg-blue-50 rounded-xl border border-blue-100 flex items-center gap-2">
            <span className="text-blue-400 text-sm">👁</span>
            <span className="text-sm text-blue-700">
              <strong>{selectedParamMeta.equipment_name}</strong> — {selectedParamMeta.param_name}
              {selectedParamMeta.unit && <span className="text-blue-400 ml-1">({selectedParamMeta.unit})</span>}
            </span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-earth-border mt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-earth-ink2 border border-earth-border hover:border-gray-400 transition-colors">
            ยกเลิก
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isReady}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Widget picker drawer ─────────────────────────────────────────────────────

function WidgetPicker({ open, onClose, onAdd }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-72 bg-earth-card border-l border-earth-border shadow-2xl h-full overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-earth-border shrink-0">
          <span className="font-bold text-earth-ink">เพิ่ม Widget</span>
          <button onClick={onClose} className="text-earth-ink3 hover:text-earth-ink text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 p-3 space-y-2">
          {WIDGET_CATALOG.map(wt => (
            <button
              key={wt.type}
              onClick={() => { onAdd(wt); onClose(); }}
              className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-earth-border hover:border-blue-300 hover:bg-blue-50 transition-colors"
            >
              <span className="text-2xl shrink-0 mt-0.5">{wt.icon}</span>
              <div>
                <div className="text-sm font-semibold text-earth-ink">{wt.label}</div>
                <div className="text-xs text-earth-ink3 mt-0.5">{wt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Marching-ants CSS (injected once globally) ───────────────────────────────

function injectMarchingAntsCSS() {
  if (document.getElementById('op-march-css')) return;
  const s = document.createElement('style');
  s.id = 'op-march-css';
  s.textContent = `
    @keyframes opMarchH { to { background-position: -16px 0; } }
    @keyframes opMarchV { to { background-position: 0 16px; } }
    .op-march-t { position:absolute; top:0; left:0; right:0; height:2px; pointer-events:none;
      background:repeating-linear-gradient(90deg,#2563eb 0 8px,transparent 8px 16px);
      background-size:16px 2px; animation:opMarchH .4s linear infinite; }
    .op-march-b { position:absolute; bottom:0; left:0; right:0; height:2px; pointer-events:none;
      background:repeating-linear-gradient(90deg,#2563eb 0 8px,transparent 8px 16px);
      background-size:16px 2px; animation:opMarchH .4s linear infinite; }
    .op-march-l { position:absolute; top:0; bottom:0; left:0; width:2px; pointer-events:none;
      background:repeating-linear-gradient(180deg,#2563eb 0 8px,transparent 8px 16px);
      background-size:2px 16px; animation:opMarchV .4s linear infinite; }
    .op-march-r { position:absolute; top:0; bottom:0; right:0; width:2px; pointer-events:none;
      background:repeating-linear-gradient(180deg,#2563eb 0 8px,transparent 8px 16px);
      background-size:2px 16px; animation:opMarchV .4s linear infinite; }
  `;
  document.head.appendChild(s);
}

// ── Validation Panel ──────────────────────────────────────────────────────────

const STATUS_ICON = { PASSED: '✓', WARNING: '⚠', FAILED: '✗', SKIPPED: '—' };
const STATUS_COLOR = {
  PASSED:  'text-emerald-600',
  WARNING: 'text-amber-500',
  FAILED:  'text-red-600',
  SKIPPED: 'text-earth-ink3',
};

function ValidationPanel({ result, loading, stationId }) {
  const [expanded, setExpanded] = useState(new Set());

  function toggle(idx) {
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(idx) ? s.delete(idx) : s.add(idx);
      return s;
    });
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-earth-ink3">
        <svg className="w-5 h-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
        </svg>
        กำลัง validate...
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-earth-ink3 p-4 text-center">
        <svg className="w-8 h-8 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <p>กด <strong>Validate</strong> เพื่อตรวจสอบข้อมูล<br/>{stationId}</p>
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="flex-1 p-3 text-sm text-red-600 bg-red-50 m-2 rounded-lg">
        ❌ {result.error}
      </div>
    );
  }

  const { steps, summary } = result;

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      {/* Summary bar */}
      <div className="px-3 py-2 border-b border-earth-border bg-earth-DEFAULT flex items-center gap-3 text-sm shrink-0">
        <span className={`font-bold ${summary.errors > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
          {summary.errors > 0 ? `✗ ${summary.errors} error` : '✓ No errors'}
        </span>
        {summary.warnings > 0 && (
          <span className="text-amber-500 font-medium">⚠ {summary.warnings} warning</span>
        )}
      </div>

      {/* Steps */}
      <div className="divide-y divide-earth-border">
        {steps.map(s => {
          const isOpen = expanded.has(s.index);
          const hasDetail = s.messages.length > 0;
          return (
            <div key={s.index} className="text-xs">
              <button
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-earth-DEFAULT ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => hasDetail && toggle(s.index)}
              >
                <span className={`font-bold text-sm w-4 shrink-0 ${STATUS_COLOR[s.status]}`}>
                  {STATUS_ICON[s.status]}
                </span>
                <span className="flex-1 font-medium text-earth-ink">{s.label}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  s.status === 'PASSED'  ? 'bg-emerald-100 text-emerald-700' :
                  s.status === 'WARNING' ? 'bg-amber-100 text-amber-700' :
                  s.status === 'FAILED'  ? 'bg-red-100 text-red-700' :
                  'bg-earth-card text-earth-ink3'
                }`}>{s.status}</span>
                {hasDetail && (
                  <svg className={`w-3 h-3 text-earth-ink3 transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="currentColor">
                    <path d="M6 4l4 4-4 4"/>
                  </svg>
                )}
              </button>
              {isOpen && hasDetail && (
                <div className="px-3 pb-2 bg-earth-DEFAULT space-y-0.5">
                  {s.messages.map((m, i) => (
                    <div key={i} className="text-earth-ink2 leading-snug pl-5">• {m}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Recording table — Excel-like navigation + copy/paste series ───────────────

// formulaStr syntax:
//   {123}      → value of cfgId 123 at current slot
//   {123,-1}   → value of cfgId 123 at previous slot (offset -1)
//   [slot]     → current time string e.g. "00:00"
function computeFormula(formulaStr, slot, allHistory, slots, si) {
  try {
    let expr = formulaStr.replace(/\[slot\]/g, JSON.stringify(slot));

    expr = expr.replace(/\{(\d+),(-?\d+)\}/g, (_, cid, offset) => {
      const targetIdx = (si ?? 0) + parseInt(offset, 10);
      if (targetIdx < 0 || !slots) return 'NaN';
      const v = allHistory[cid]?.[slots[targetIdx]];
      return (v !== undefined && v !== '') ? parseFloat(v) : 'NaN';
    });

    expr = expr.replace(/\{(\d+)\}/g, (_, cid) => {
      const v = allHistory[cid]?.[slot];
      return (v !== undefined && v !== '') ? parseFloat(v) : 'NaN';
    });

    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${expr})`)();
    if (result === undefined || result === null) return null; // sentinel: cell is not a formula slot
    if (!isFinite(result)) return '';
    return parseFloat(result.toFixed(4));
  } catch {
    return '';
  }
}

function RecordingTable({ topic, history, allHistory, dirtyValues, onCellChange, cellMarks, focusId }) {
  const markMap = useMemo(() => {
    const m = new Map();
    if (!cellMarks) return m;
    for (const mk of cellMarks) m.set(`${mk.configparam_id}:${mk.slot}`, mk.color);
    return m;
  }, [cellMarks]);
  const slots  = topicSlots(topic);
  const params = topic.params;
  const colors = TOPIC_COLORS[topic.topic] ?? DEFAULT_TOPIC_COLOR;
  const dirty  = dirtyValues[topic.topic] || {};

  const [selCell,    setSelCell]    = useState({ si: 0, pi: 0 });
  const [editCell,   setEditCell]   = useState(null);
  const [selAnchor,  setSelAnchor]  = useState(null);
  const [clipboard,  setClipboard]  = useState(null);
  const [copiedRange, setCopiedRange] = useState(null); // { r1,c1,r2,c2 } for marching ants

  const wrapRef    = useRef(null);
  const inputRefs  = useRef({});
  const cellRefs   = useRef({});
  const isDragging        = useRef(false);
  const skipNextChangeRef = useRef(false);
  const preEditValueRef   = useRef(null);

  // Refs for stale-closure-free document listeners
  const editCellRef     = useRef(null);
  const handleCopyRef   = useRef(null);
  const handlePasteRef  = useRef(null);
  editCellRef.current   = editCell;

  // Inject marching ants CSS once
  useEffect(() => { injectMarchingAntsCSS(); }, []);

  // Focus the cell matching focusId (configparam_id from URL ?focus=)
  useEffect(() => {
    if (!focusId || !topic?.params) return;
    const pi = topic.params.findIndex(p => String(p.configparam_id) === String(focusId));
    if (pi >= 0) setSelCell({ si: 0, pi });
  }, [focusId, topic?.params]); // eslint-disable-line

  // Reset to cell (0,0) and focus table whenever the sub-tab (topic) changes
  useEffect(() => {
    if (!focusId) setSelCell({ si: 0, pi: 0 }); // skip reset when focusId will position the cell
    setSelAnchor(null);
    setEditCell(null);
    setCopiedRange(null);
    if (wrapRef.current) {
      wrapRef.current.scrollTop  = 0;
      wrapRef.current.scrollLeft = 0;
      wrapRef.current.focus();
    }
  }, [topic.topic]); // eslint-disable-line

  // Scroll selected cell into view, respecting the sticky Time column and sticky header
  useEffect(() => {
    const el  = cellRefs.current[`${selCell.si}:${selCell.pi}`];
    const box = wrapRef.current;
    if (!el || !box) return;

    // Measure sticky column/header sizes from DOM
    const stickyCol    = box.querySelector('thead th:first-child');
    const stickyHeader = box.querySelector('thead');
    const stickyW = stickyCol  ? stickyCol.offsetWidth  : 64;
    const stickyH = stickyHeader ? stickyHeader.offsetHeight : 56;

    const cellLeft   = el.offsetLeft;
    const cellRight  = el.offsetLeft + el.offsetWidth;
    const cellTop    = el.offsetTop;
    const cellBottom = el.offsetTop  + el.offsetHeight;

    const visLeft   = box.scrollLeft + stickyW;
    const visRight  = box.scrollLeft + box.clientWidth;
    const visTop    = box.scrollTop  + stickyH;
    const visBottom = box.scrollTop  + box.clientHeight;

    if (cellLeft < visLeft) {
      box.scrollLeft = cellLeft - stickyW;
    } else if (cellRight > visRight) {
      box.scrollLeft = cellRight - box.clientWidth;
    }

    if (cellTop < visTop) {
      box.scrollTop = cellTop - stickyH;
    } else if (cellBottom > visBottom) {
      box.scrollTop = cellBottom - box.clientHeight;
    }
  }, [selCell]);

  // Document mouseup — end drag selection
  useEffect(() => {
    const onUp = () => { isDragging.current = false; };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  // Document keydown (capture) — handle Ctrl+C/V even when focus is on a child element
  useEffect(() => {
    function onDocKey(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(document.activeElement) && document.activeElement !== wrapRef.current) return;
      if (editCellRef.current) return;
      if (e.ctrlKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) { e.preventDefault(); handleCopyRef.current?.(); }
      else if (e.ctrlKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) { e.preventDefault(); handlePasteRef.current?.(); }
    }
    document.addEventListener('keydown', onDocKey, true);
    return () => document.removeEventListener('keydown', onDocKey, true);
  }, []);

  function refKey(si, pi) { return `${si}:${pi}`; }

  function clamp(si, pi) {
    return {
      si: Math.max(0, Math.min(si, slots.length - 1)),
      pi: Math.max(0, Math.min(pi, params.length - 1)),
    };
  }

  function getRange() {
    const a = selAnchor ?? selCell;
    return {
      r1: Math.min(a.si, selCell.si), c1: Math.min(a.pi, selCell.pi),
      r2: Math.max(a.si, selCell.si), c2: Math.max(a.pi, selCell.pi),
    };
  }

  function inRange(si, pi) {
    const { r1, c1, r2, c2 } = getRange();
    return si >= r1 && si <= r2 && pi >= c1 && pi <= c2;
  }

  function navigate(si, pi, extend = false) {
    const pos = clamp(si, pi);
    if (extend) { if (!selAnchor) setSelAnchor(selCell); }
    else setSelAnchor(null);
    setSelCell(pos);
    setEditCell(null);
  }

  function startEdit(si, pi, initChar = null) {
    const pos = clamp(si, pi);
    const p = params[pos.pi];
    if (p?.readonly || p?.formula) return; // formula/readonly cells are not editable
    const cpid = p.configparam_id;
    const slot = slots[pos.si];
    const hadDirty = dirty[cpid]?.[slot] !== undefined;
    preEditValueRef.current = { cpid, slot, hadDirty, value: hadDirty ? dirty[cpid][slot] : undefined };
    setSelCell(pos);
    setSelAnchor(null);
    if (initChar !== null) {
      onCellChange(topic.topic, cpid, slot, initChar);
      skipNextChangeRef.current = true; // prevent duplicate keypress on newly-focused input
    }
    setEditCell(pos);
    setCopiedRange(null); // clear copy highlight when entering edit
  }

  function stopEdit(advanceRow = false) {
    const cur = editCell;
    preEditValueRef.current = null;
    setEditCell(null);
    if (cur && advanceRow) setSelCell(clamp(cur.si + 1, cur.pi));
    wrapRef.current?.focus();
  }

  function cancelEdit() {
    const pre = preEditValueRef.current;
    preEditValueRef.current = null;
    if (pre) {
      // Restore: if cell had no dirty before editing, clear dirty (undefined = delete); otherwise restore previous dirty
      onCellChange(topic.topic, pre.cpid, pre.slot, pre.hadDirty ? pre.value : undefined);
    }
    setEditCell(null);
    wrapRef.current?.focus();
  }

  function getVal(configparam_id, slot) {
    const d = dirty[configparam_id]?.[slot];
    if (d !== undefined) return d;
    return history[configparam_id]?.[slot] ?? '';
  }

  function getDisplayVal(p, slot) {
    if (p.formula) return computeFormula(p.formula, slot, allHistory || history, slots, slots.indexOf(slot));
    return getVal(p.configparam_id, slot);
  }

  function handleCopy() {
    const { r1, c1, r2, c2 } = getRange();
    const rows = [];
    for (let si = r1; si <= r2; si++) {
      const row = [];
      for (let pi = c1; pi <= c2; pi++) row.push(getVal(params[pi].configparam_id, slots[si]));
      rows.push(row);
    }
    setClipboard({ rows, h: rows.length, w: rows[0]?.length ?? 0 });
    setCopiedRange({ r1, c1, r2, c2 });
    // Also write tab-separated text to OS clipboard
    navigator.clipboard?.writeText(rows.map(r => r.join('\t')).join('\n')).catch(() => {});
  }
  handleCopyRef.current = handleCopy;

  function handlePaste() {
    if (!clipboard || clipboard.h === 0 || clipboard.w === 0) return;
    const { r1, c1, r2, c2 } = getRange();
    const srcH = clipboard.h, srcW = clipboard.w;
    const destH = Math.max(r2 - r1 + 1, srcH);
    const destW = Math.max(c2 - c1 + 1, srcW);
    for (let dr = 0; dr < destH; dr++) {
      for (let dc = 0; dc < destW; dc++) {
        const si = r1 + dr, pi = c1 + dc;
        if (si >= slots.length || pi >= params.length) continue;
        const p = params[pi];
        if (p?.readonly || p?.formula) continue;
        const v = clipboard.rows[dr % srcH][dc % srcW];
        // For TEXT cells, only paste if the value is a valid option for the target cell
        const targetOpts = getCellOptions(p);
        if (targetOpts && v !== '' && !targetOpts.includes(v)) continue;
        onCellChange(topic.topic, p.configparam_id, slots[si], v);
      }
    }
    setCopiedRange(null);
  }
  handlePasteRef.current = handlePaste;

  function handleWrapKeyDown(e) {
    if (editCell) return;
    const { si, pi } = selCell;

    if (e.ctrlKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) { e.preventDefault(); handleCopy(); return; }
    if (e.ctrlKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) { e.preventDefault(); handlePaste(); return; }

    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); navigate(si - 1, pi, e.shiftKey); break;
      case 'ArrowDown':  e.preventDefault(); navigate(si + 1, pi, e.shiftKey); break;
      case 'ArrowLeft':  e.preventDefault(); navigate(si, pi - 1, e.shiftKey); break;
      case 'ArrowRight': e.preventDefault(); navigate(si, pi + 1, e.shiftKey); break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) pi > 0 ? navigate(si, pi - 1) : navigate(si - 1, params.length - 1);
        else            pi < params.length - 1 ? navigate(si, pi + 1) : navigate(si + 1, 0);
        break;
      case 'Enter': case 'F2': e.preventDefault(); startEdit(si, pi); break;
      case 'Escape': setSelAnchor(null); setCopiedRange(null); break;
      case 'Delete': case 'Backspace': {
        e.preventDefault();
        const { r1, c1, r2, c2 } = getRange();
        for (let r = r1; r <= r2; r++)
          for (let c = c1; c <= c2; c++) {
            const p = params[c];
            if (!p?.readonly && !p?.formula)
              onCellChange(topic.topic, p.configparam_id, slots[r], '');
          }
        break;
      }
      default:
        if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
          const p = params[pi];
          if (!p?.readonly && !p?.formula) {
            if (getCellType(p) !== 'text') {
              const t = (p.type || '').trim();
              const isInt = t === 'INT';
              const filtered = e.key.replace(isInt ? /[^0-9\-]/g : /[^0-9.\-]/g, '');
              startEdit(si, pi, filtered || null); // invalid key → null = enter edit at end
            } else startEdit(si, pi);
          }
        }
    }
  }

  // Format a stored value for display based on column type
  function formatDisplayVal(val, type) {
    if (val === '' || val == null) return val;
    const t = (type || '').trim();
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    function addCommas(str) {
      const [int, dec] = str.split('.');
      return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec !== undefined ? '.' + dec : '');
    }
    if (t === 'INT') return addCommas(String(Math.round(num)));
    const m = t.match(/^FLOAT\((\d+)\)$/);
    if (m) return addCommas(num.toFixed(parseInt(m[1], 10)));
    return addCommas(String(num));
  }

  // Format the current dirty/stored value and write it back on commit
  function formatAndCommit(p, slot) {
    const hasDirty = dirty[p.configparam_id]?.[slot] !== undefined;
    const raw = getVal(p.configparam_id, slot);
    if (raw === '' || raw == null) return;
    const t = (p.type || '').trim();
    const isNumeric = t === 'INT' || t.startsWith('FLOAT(');
    if (isNumeric) {
      const num = parseFloat(raw);
      if (isNaN(num)) {
        // Invalid numeric input (e.g. "-" or ".") — clear the cell
        onCellChange(topic.topic, p.configparam_id, slot, '');
        return;
      }
      // User-typed dirty value: don't reformat (keeps "1" as "1", not "1.00")
      if (hasDirty) return;
      // History value: only update if numerically different (avoids spurious dirty: "4.5" vs "4.50" = same number)
      const formatted = formatDisplayVal(raw, p.type);
      if (parseFloat(String(formatted)) !== num) {
        onCellChange(topic.topic, p.configparam_id, slot, formatted);
      }
      return;
    }
    const formatted = formatDisplayVal(raw, p.type);
    if (formatted !== String(raw)) {
      onCellChange(topic.topic, p.configparam_id, slot, formatted);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header bar — compact, shows clipboard info */}
      <div className={`flex items-center justify-between px-3 py-1 shrink-0 ${colors.header}`}>
        <span className="text-xs font-bold opacity-80">{topic.topic}</span>
        <span className="text-xs opacity-50">{params.length} ค่า · {slots.length} รอบ
          {clipboard && <span className="ml-2">📋 {clipboard.h}×{clipboard.w}</span>}
        </span>
      </div>

      {/* Scrollable table */}
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={handleWrapKeyDown}
        className="flex-1 overflow-auto bg-earth-DEFAULT focus:outline-none"
      >
        <table className="text-xs border-collapse w-max">
          <thead className="sticky top-0 z-10">
            {/* Date / topic row */}
            <tr>
              <th className="border border-earth-border bg-[#1a3a5c] text-white font-bold px-2 py-1 text-center whitespace-nowrap sticky left-0 z-20 text-xs">
                Time (Hour)
              </th>
              <th colSpan={params.length} className="border border-earth-border bg-[#1a3a5c] text-white font-bold px-3 py-1 text-left text-xs">
                {topic.topic}
              </th>
            </tr>
            {/* Column header row */}
            <tr>
              <th className="border border-earth-border bg-[#1a3a5c] text-white font-bold px-2 py-1 text-center whitespace-nowrap sticky left-0 z-20 text-[11px]">
                เวลา
              </th>
              {params.map(p => (
                <th key={p.configparam_id} className={[
                  'border border-earth-border whitespace-nowrap text-center leading-snug px-2 py-1',
                  p.formula ? 'bg-[#b3d1f0]' : p.readonly ? 'bg-[#d0d8e4]' : 'bg-[#bdd7ee]',
                  'text-earth-ink',
                ].join(' ')}>
                  <div className="font-bold text-[11px]">{p.equipment_name}</div>
                  <div className="font-normal text-earth-ink2 text-[10px]">{p.param_name}{p.formula ? ' ƒ' : p.readonly ? ' ●' : ''}</div>
                  {p.unit && <div className="text-earth-ink3 text-[10px]">({p.unit})</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, si) => (
              <tr key={slot} className="bg-earth-DEFAULT">
                <td className="px-2 py-0 border border-earth-border font-bold text-white whitespace-nowrap sticky left-0 bg-[#1a3a5c] text-xs text-center w-16">
                  {slot}
                </td>
                {params.map((p, pi) => {
                  const isFormula  = !!p.formula;
                  const formulaVal = isFormula ? getDisplayVal(p, slot) : null;
                  const isFormulaSlot = isFormula && formulaVal !== null;
                  const isReadonly = !!(p.readonly || isFormulaSlot);
                  const val        = isFormulaSlot
                    ? formulaVal
                    : getVal(p.configparam_id, slot);
                  const isDirty = !isReadonly && dirty[p.configparam_id]?.[slot] !== undefined && dirty[p.configparam_id]?.[slot] !== '';
                  const opts    = isReadonly ? null : getCellOptions(p);
                  const isSel   = selCell.si === si && selCell.pi === pi;
                  const isEdit  = !isReadonly && editCell?.si === si && editCell?.pi === pi;
                  const isRng   = inRange(si, pi);

                  // Marching ants edges
                  const cr = copiedRange;
                  const marchTop   = cr && si === cr.r1 && pi >= cr.c1 && pi <= cr.c2;
                  const marchBot   = cr && si === cr.r2 && pi >= cr.c1 && pi <= cr.c2;
                  const marchLeft  = cr && pi === cr.c1 && si >= cr.r1 && si <= cr.r2;
                  const marchRight = cr && pi === cr.c2 && si >= cr.r1 && si <= cr.r2;

                  return (
                    <td
                      key={p.configparam_id}
                      ref={el => { cellRefs.current[`${si}:${pi}`] = el; }}
                      className={[
                        'border border-earth-border relative p-0 h-7',
                        isEdit && opts ? 'overflow-visible z-50' : 'overflow-hidden',
                        isFormulaSlot  ? 'bg-[#ddeeff]' : '',
                        isReadonly && !isFormulaSlot ? 'bg-earth-DEFAULT' : '',
                        isRng && !isSel && !isReadonly ? 'bg-blue-50' : '',
                        isDirty && !isEdit ? 'bg-amber-50' : '',
                        markMap.get(`${p.configparam_id}:${slot}`) === 'red'    ? 'bg-red-100'    : '',
                        markMap.get(`${p.configparam_id}:${slot}`) === 'orange' ? 'bg-orange-100' : '',
                      ].join(' ')}
                      onMouseDown={e => {
                        if (e.button !== 0) return;
                        // No e.preventDefault() — cell divs already have CSS select-none,
                        // so text-selection is blocked. Without preventDefault, Chrome
                        // honours a synchronous .focus() call on the wrapper div.
                        isDragging.current = true;
                        setSelAnchor({ si, pi });
                        setSelCell({ si, pi });
                        setEditCell(null);
                        setCopiedRange(null);
                        wrapRef.current?.focus();
                      }}
                      onMouseEnter={() => {
                        if (isDragging.current) setSelCell({ si, pi });
                      }}
                      onDoubleClick={() => startEdit(si, pi)}
                    >
                      {/* Selection ring */}
                      {isSel && !isEdit && (
                        <div className="absolute inset-0 ring-2 ring-blue-500 ring-inset pointer-events-none z-10" />
                      )}

                      {/* Marching ants borders */}
                      {(marchTop || marchBot || marchLeft || marchRight) && (
                        <div className="absolute inset-0 pointer-events-none z-20">
                          {marchTop   && <div className="op-march-t" />}
                          {marchBot   && <div className="op-march-b" />}
                          {marchLeft  && <div className="op-march-l" />}
                          {marchRight && <div className="op-march-r" />}
                        </div>
                      )}

                      {isEdit ? (
                        <div className="absolute inset-0 flex items-center z-30">
                          {opts ? (
                            // Listbox (size > 1) — always visible, no need to "open" programmatically
                            <select
                              ref={el => { inputRefs.current[refKey(si, pi)] = el; }}
                              autoFocus
                              size={opts.length + 1}
                              value={val}
                              onChange={e => { onCellChange(topic.topic, p.configparam_id, slot, e.target.value); stopEdit(true); }}
                              onMouseDown={e => e.stopPropagation()}
                              onKeyDown={e => {
                                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                else if (e.key === 'Enter') { e.preventDefault(); stopEdit(true); }
                                else if (e.key === 'Tab') { e.preventDefault(); stopEdit(); pi < params.length - 1 ? navigate(si, pi + 1) : navigate(si + 1, 0); }
                              }}
                              onBlur={() => stopEdit()}
                              className="absolute top-0 left-0 text-xs focus:outline-none bg-earth-DEFAULT border border-blue-500 shadow-lg cursor-pointer"
                              style={{ minWidth: '90px', zIndex: 200 }}
                            >
                              <option value="">—</option>
                              {opts.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              ref={el => { inputRefs.current[refKey(si, pi)] = el; }}
                              autoFocus
                              type="text"
                              inputMode="decimal"
                              value={val}
                              onChange={e => {
                                if (skipNextChangeRef.current) { skipNextChangeRef.current = false; return; }
                                const raw = e.target.value;
                                const t = (p.type || '').trim();
                                const isInt = t === 'INT';
                                // Allow: digits, minus at start, decimal point (FLOAT only)
                                const filtered = raw
                                  .replace(isInt ? /[^0-9\-]/g : /[^0-9.\-]/g, '')  // strip invalid chars
                                  .replace(/(?<=.)-/g, '')                            // minus only at start
                                  .replace(/(\..*)\./g, '$1');                        // only one decimal point
                                onCellChange(topic.topic, p.configparam_id, slot, filtered);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                else if (e.key === 'Enter') { e.preventDefault(); formatAndCommit(p, slot); stopEdit(true); }
                                else if (e.key === 'Tab') { e.preventDefault(); formatAndCommit(p, slot); stopEdit(); pi < params.length - 1 ? navigate(si, pi + 1) : navigate(si + 1, 0); }
                                else if (e.key === 'ArrowUp') { e.preventDefault(); formatAndCommit(p, slot); stopEdit(); navigate(si - 1, pi); }
                                else if (e.key === 'ArrowDown') { e.preventDefault(); formatAndCommit(p, slot); stopEdit(); navigate(si + 1, pi); }
                              }}
                              onBlur={() => { formatAndCommit(p, slot); stopEdit(); }}
                              placeholder="—"
                              className="w-full h-full text-xs text-center focus:outline-none bg-transparent px-1"
                            />
                          )}
                        </div>
                      ) : (
                        <div className={[
                          'w-full h-full flex items-center text-xs select-none',
                          isFormulaSlot ? 'text-blue-800 font-medium' : '',
                          isDirty ? 'font-semibold text-amber-800' : (isFormulaSlot ? '' : 'text-earth-ink'),
                          val === '' ? 'text-earth-ink3' : '',
                        ].join(' ')}>
                          <span className="flex-1 text-center">{val !== '' && val != null ? formatDisplayVal(val, p.type) : '—'}</span>
                          {opts && (
                            <span
                              className="shrink-0 pr-0.5 text-[9px] text-earth-ink3 cursor-pointer hover:text-earth-ink2 leading-none"
                              onMouseDown={e => { e.stopPropagation(); startEdit(si, pi); }}
                            >🔻</span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Submission panel (separate module from recording table) ──────────────────

function SubmissionPanel({ stationDef, dirtyValues, submitStatus, onSubmitTopic, canRecord }) {
  const topics = stationDef?.topics ?? [];

  // Collect only topics that have at least one dirty non-empty cell
  const pendingTopics = topics.filter(t => {
    const d = dirtyValues[t.topic] || {};
    return Object.values(d).some(sm => sm && Object.values(sm).some(v => v !== ''));
  });

  if (pendingTopics.length === 0) return null;

  return (
    <div className="shrink-0 bg-earth-card border-t border-earth-border shadow-inner px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="text-xs font-semibold text-earth-ink2 uppercase tracking-wide">รอส่งข้อมูล</span>
      {pendingTopics.map(t => {
        const st = submitStatus[t.topic];
        const tc = TOPIC_COLORS[t.topic] ?? DEFAULT_TOPIC_COLOR;
        const cellCount = Object.values(dirtyValues[t.topic] || {})
          .reduce((acc, sm) => acc + Object.values(sm).filter(v => v !== '').length, 0);
        return (
          <button
            key={t.topic}
            onClick={() => onSubmitTopic(t.topic)}
            disabled={!canRecord || st === 'sending'}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
              st === 'success' ? 'bg-green-50 text-green-700 border-green-300' :
              st === 'error'   ? 'bg-red-50 text-red-700 border-red-300' :
              st === 'sending' ? 'bg-earth-DEFAULT text-earth-ink3 border-earth-border cursor-wait' :
              tc.tag + ' border-transparent hover:shadow-sm',
            ].join(' ')}
          >
            {st === 'sending' ? (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            ) : st === 'success' ? '✓' : st === 'error' ? '✕' : null}
            {t.topic}
            {st !== 'success' && <span className="opacity-60">({cellCount})</span>}
          </button>
        );
      })}
      <span className="text-xs text-earth-ink3 ml-1">คลิก topic เพื่อส่งข้อมูล</span>
    </div>
  );
}

// ── Water Sankey Chart (d3-sankey based) ─────────────────────────────────────

const SANKEY_NODE_COLORS = {
  'Raw Water':     '#3b82f6',
  'TPS Water':     '#8b5cf6',
  'DPS Water':     '#06b6d4',
  'DPS Line A':    '#0891b2',
  'DPS Line B':    '#0e7490',
  'Prod Use':      '#f59e0b',
  'Sludge Drain':  '#78716c',
  'Service Water': '#10b981',
  'Loss':          '#ef4444',
};

// Custom fixed-position Sankey — no d3-sankey auto layout needed
function WaterSankeyChart({ rw, tps, dpsA, dpsB, sludge, serviceWater, washWater = 0, loss: lossProp = null }) {
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 600, h: 300 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setDims({ w: Math.max(e.contentRect.width, 300), h: Math.max(e.contentRect.height, 200) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { w, h } = dims;

  const layout = useMemo(() => {
    const dpsTotal = (dpsA ?? 0) + (dpsB ?? 0);
    // If raw water is missing, fall back to pumped total so Sankey still renders
    const effectiveRw = (rw && rw > 0) ? rw : ((tps ?? 0) + dpsTotal) || 0;
    if (effectiveRw <= 0) return null;
    const slg      = sludge      ?? 0;
    const svc      = serviceWater ?? 0;
    const wash     = washWater    ?? 0;
    const loss     = lossProp != null ? Math.max(0, lossProp) : Math.max(0, effectiveRw - (tps ?? 0) - dpsTotal - slg - svc - wash);

    // Layout margins
    const ML = 72, MR = 100, MT = 8, MB = 52;
    const cw = w - ML - MR;
    const ch = h - MT - MB;

    // Scale: effectiveRw fills 80% of chart height
    const totalBar = ch * 0.80;
    const px = v => (v / effectiveRw) * totalBar;
    const BW = 18; // bar rect width

    // RW bar (left, vertically centered)
    const rwH  = px(effectiveRw);
    const rwX  = ML;
    const rwY0 = MT + (ch - rwH) / 2;

    // Allocate exits from right edge of RW: right-links first, then down-links
    const rightSeq = [
      { id: 'tps', val: tps ?? 0 },
      { id: 'dps', val: dpsTotal },
    ].filter(l => l.val > 0);

    // Bottom nodes: fixed x positions as fractions of chart width
    const downSeq = [
      { id: 'loss', val: loss, label: 'Loss',          xFrac: 0.10, color: '#ef4444' },
      { id: 'wash', val: wash, label: 'Wash Water',    xFrac: 0.40, color: '#f97316' },
      { id: 'svc',  val: svc,  label: 'Service Water', xFrac: 0.70, color: '#10b981' },
      { id: 'slg',  val: slg,  label: 'Sludge Drain',  xFrac: 1.00, color: '#78716c' },
    ].filter(l => l.val > 0);

    // Build exit map (y slices inside RW bar)
    let cur = rwY0;
    const exits = {};
    for (const l of [...rightSeq, ...downSeq]) {
      const lh = px(l.val);
      exits[l.id] = { y0: cur, y1: cur + lh };
      cur += lh;
    }

    // TPS node: top-right
    const tpsH  = px(tps ?? 0);
    const tpsX  = ML + cw * 0.90;
    const tpsY0 = MT + ch * 0.02;

    // DPS intermediate node (shows "DPS Water" label, splits into A/B)
    const dpsH    = px(dpsTotal);
    const dpsX    = ML + cw * 0.55;
    const dpsExit = exits['dps'];
    const dpsY0   = dpsExit
      ? (dpsExit.y0 + dpsExit.y1) / 2 - dpsH / 2
      : MT + ch * 0.30;

    // DPS Line A and B (right side, below TPS — never overlap TPS)
    const dpsAH  = px(dpsA ?? 0);
    const dpsBH  = px(dpsB ?? 0);
    const dpsRX  = ML + cw * 0.90;
    const dpsAY0 = tpsY0 + tpsH + 10;   // always starts after TPS bar ends
    const dpsBY0 = dpsAY0 + dpsAH + 6;

    // Bottom nodes
    const botY0 = MT + ch + 8;
    const botBarH = BW; // horizontal bar height
    const botNodes = downSeq.map(l => ({
      ...l,
      cx: ML + cw * l.xFrac,
      y0: botY0,
      bw: Math.max(px(l.val), 4),       // bar width (proportional to flow)
    }));

    return {
      rw, tps: tps ?? 0, dpsTotal, dpsAVal: dpsA ?? 0, dpsBVal: dpsB ?? 0, slg, svc, wash, loss,
      rwX, rwY0, rwH,
      tpsX, tpsY0, tpsH,
      dpsX, dpsY0, dpsH,
      dpsRX, dpsAY0, dpsAH, dpsBY0, dpsBH,
      exits, botNodes,
      BW, botBarH, ML, MR, MT, MB, cw, ch, px,
    };
  }, [w, h, rw, tps, dpsA, dpsB, sludge, serviceWater, washWater, lossProp]);

  function fmtV(v) {
    if (!v && v !== 0) return '—';
    return Math.round(Number(v)).toLocaleString('en-US');
  }
  function pct(v) {
    return rw > 0 ? ` (${((v / rw) * 100).toFixed(1)}%)` : '';
  }

  // Horizontal bezier band: right edge of A → left edge of B
  function hBand(x1, ya1, yb1, x2, ya2, yb2) {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${ya1} C ${mx} ${ya1}, ${mx} ${ya2}, ${x2} ${ya2} L ${x2} ${yb2} C ${mx} ${yb2}, ${mx} ${yb1}, ${x1} ${yb1} Z`;
  }

  // Rainbow arc band: exits RW going RIGHT (CP1 at destination x, same y as source),
  // curves gracefully DOWN to arrive at bottom bar — wider arcs for farther destinations.
  function dBand(sx, sy0, sy1, cx, ty, bw) {
    // Outer edge (top of band): horizontal exit → vertical arrival
    // CP1 = (cx, sy0)          → forces horizontal tangent at source (goes right first)
    // CP2 = (cx-bw/2, midOuter) → same x as endpoint → vertical approach from above
    const midOuter = sy0 + (ty - sy0) * 0.45;
    const midInner = sy1 + (ty - sy1) * 0.45;
    return [
      `M ${sx} ${sy0}`,
      `C ${cx} ${sy0}, ${cx - bw / 2} ${midOuter}, ${cx - bw / 2} ${ty}`,
      `L ${cx + bw / 2} ${ty}`,
      `C ${cx + bw / 2} ${midInner}, ${cx} ${sy1}, ${sx} ${sy1}`,
      'Z',
    ].join(' ');
  }

  if (!layout) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center text-earth-ink3 text-sm">
        ไม่มีข้อมูล
      </div>
    );
  }

  const l   = layout;
  const rwR = l.rwX + l.BW; // right edge of RW bar

  const FF = "'Segoe UI',sans-serif";

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>

        {/* ── BANDS ── */}

        {/* RW → TPS */}
        {l.tpsH > 1 && l.exits.tps && (
          <path d={hBand(rwR, l.exits.tps.y0, l.exits.tps.y1, l.tpsX - l.BW, l.tpsY0, l.tpsY0 + l.tpsH)}
            fill="#8b5cf6" fillOpacity={0.30} />
        )}

        {/* RW → DPS intermediate */}
        {l.dpsH > 1 && l.exits.dps && (
          <path d={hBand(rwR, l.exits.dps.y0, l.exits.dps.y1, l.dpsX, l.dpsY0, l.dpsY0 + l.dpsH)}
            fill="#06b6d4" fillOpacity={0.30} />
        )}

        {/* DPS → Line A */}
        {l.dpsAH > 1 && (
          <path d={hBand(l.dpsX + l.BW, l.dpsY0, l.dpsY0 + l.dpsAH, l.dpsRX - l.BW, l.dpsAY0, l.dpsAY0 + l.dpsAH)}
            fill="#0891b2" fillOpacity={0.30} />
        )}

        {/* DPS → Line B */}
        {l.dpsBH > 1 && (
          <path d={hBand(l.dpsX + l.BW, l.dpsY0 + l.dpsAH, l.dpsY0 + l.dpsH, l.dpsRX - l.BW, l.dpsBY0, l.dpsBY0 + l.dpsBH)}
            fill="#0e7490" fillOpacity={0.30} />
        )}

        {/* RW → bottom nodes (diagonal) */}
        {l.botNodes.map(bn => {
          const ex = l.exits[bn.id];
          if (!ex) return null;
          return (
            <path key={bn.id}
              d={dBand(rwR, ex.y0, ex.y1, bn.cx, bn.y0, bn.bw)}
              fill={bn.color} fillOpacity={0.28}
            />
          );
        })}

        {/* ── NODE BARS ── */}

        {/* Raw Water (vertical bar, left) */}
        <rect x={l.rwX} y={l.rwY0} width={l.BW} height={l.rwH} fill="#3b82f6" rx={3} />
        <text x={l.rwX - 6} y={l.rwY0 + l.rwH / 2 - 7} textAnchor="end" fontSize={13} fontWeight="700" fill="#1e293b" fontFamily={FF}>Raw Water</text>
        <text x={l.rwX - 6} y={l.rwY0 + l.rwH / 2 + 9} textAnchor="end" fontSize={11.5} fill="#64748b" fontFamily={FF}>{fmtV(l.rw)} m³</text>

        {/* TPS Water */}
        {l.tpsH > 1 && <>
          <rect x={l.tpsX - l.BW} y={l.tpsY0} width={l.BW} height={l.tpsH} fill="#8b5cf6" rx={3} />
          <text x={l.tpsX + 5} y={l.tpsY0 + l.tpsH / 2 - 7} textAnchor="start" fontSize={13} fontWeight="700" fill="#1e293b" fontFamily={FF}>TPS Water</text>
          <text x={l.tpsX + 5} y={l.tpsY0 + l.tpsH / 2 + 9} textAnchor="start" fontSize={11.5} fill="#64748b" fontFamily={FF}>{fmtV(l.tps)} m³{pct(l.tps)}</text>
        </>}

        {/* DPS intermediate (no label — just the routing bar) */}
        {l.dpsH > 1 && (
          <rect x={l.dpsX} y={l.dpsY0} width={l.BW} height={l.dpsH} fill="#06b6d4" rx={3} />
        )}

        {/* DPS Line A */}
        {l.dpsAH > 1 && <>
          <rect x={l.dpsRX - l.BW} y={l.dpsAY0} width={l.BW} height={l.dpsAH} fill="#0891b2" rx={3} />
          <text x={l.dpsRX + 5} y={l.dpsAY0 + l.dpsAH / 2 - 7} textAnchor="start" fontSize={13} fontWeight="700" fill="#1e293b" fontFamily={FF}>DPS Line A</text>
          <text x={l.dpsRX + 5} y={l.dpsAY0 + l.dpsAH / 2 + 9} textAnchor="start" fontSize={11.5} fill="#64748b" fontFamily={FF}>{fmtV(l.dpsAVal)} m³{pct(l.dpsAVal)}</text>
        </>}

        {/* DPS Line B */}
        {l.dpsBH > 1 && <>
          <rect x={l.dpsRX - l.BW} y={l.dpsBY0} width={l.BW} height={l.dpsBH} fill="#0e7490" rx={3} />
          <text x={l.dpsRX + 5} y={l.dpsBY0 + l.dpsBH / 2 - 7} textAnchor="start" fontSize={13} fontWeight="700" fill="#1e293b" fontFamily={FF}>DPS Line B</text>
          <text x={l.dpsRX + 5} y={l.dpsBY0 + l.dpsBH / 2 + 9} textAnchor="start" fontSize={11.5} fill="#64748b" fontFamily={FF}>{fmtV(l.dpsBVal)} m³{pct(l.dpsBVal)}</text>
        </>}

        {/* Bottom nodes (horizontal bars) */}
        {l.botNodes.map(bn => {
          const lx = bn.id === 'slg' ? bn.cx + bn.bw / 2 + 3 : bn.cx;
          const anchor = bn.id === 'slg' ? 'start' : 'middle';
          return (
            <g key={bn.id}>
              <rect x={bn.cx - bn.bw / 2} y={bn.y0} width={bn.bw} height={l.botBarH} fill={bn.color} rx={3} />
              <text x={lx} y={bn.y0 + l.botBarH + 15} textAnchor={anchor} fontSize={12} fontWeight="700" fill="#1e293b" fontFamily={FF}>{bn.label}</text>
              <text x={lx} y={bn.y0 + l.botBarH + 29} textAnchor={anchor} fontSize={11} fill="#64748b" fontFamily={FF}>{fmtV(bn.val)} m³{pct(bn.val)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Daily Report Tab ─────────────────────────────────────────────────────────

const DAILY_INNER_TABS = [
  { id: 'DR1',  label: 'SUMMARY' },
  { id: 'DR2',  label: 'RWS#1'   },
  { id: 'DR3',  label: 'RWS#2'   },
  { id: 'DR4',  label: 'CHEM#1'  },
  { id: 'DR5',  label: 'CHEM#2'  },
  { id: 'DR6',  label: 'TPS'     },
  { id: 'DR7',  label: 'DPS'     },
  { id: 'DR9',  label: 'FWS'     },
  { id: 'DR10', label: 'CWS'     },
  { id: 'DR8',  label: 'LAB'     },
];

// ── Daily Report constants ───────────────────────────────────────────────────

const DR_KPI = [
  { key: 'water',  label: 'WATER PRODUCED', value: '1,377,100', unit: 'ลบ.ม./วัน', color: '#16a34a' },
  { key: 'loss',   label: '% LOSS WATER',   value: '4.51',      unit: '%',           color: '#dc2626' },
  { key: 'cost',   label: 'TOTAL COST',     value: '1,113,777', unit: 'Baht',        color: '#9333ea' },
  { key: 'energy', label: 'ENERGY',         value: '189.79',    unit: 'MWh',         color: '#d97706' },
];

const SANKEY_DATA_UNUSED = {
  nodes: [],
  links: [
  ],
};

const DR_RIGHT_SUMMARY = [
  {
    title: 'สถานีสูบน้ำดิบ 1 และ 2',
    rows: [
      { label: 'เฟส 1', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 2', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 3', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 4', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณน้ำดิบรวม', value: null, unit: 'ลบ.ม./วัน', bold: true },
    ],
  },
  {
    title: 'ระดับน้ำ',
    rows: [
      { label: 'ระดับน้ำ CWT 24:00', value: null, unit: 'ม.' },
      { label: 'ระดับน้ำ CWT ต่ำสุด', value: null, unit: 'ม.' },
      { label: 'ระดับน้ำ CWT สูงสุด', value: null, unit: 'ม.' },
      { label: 'ระดับน้ำ RW ต่ำสุด',  value: null, unit: 'ม.' },
      { label: 'ระดับน้ำ RW สูงสุด',  value: null, unit: 'ม.' },
    ],
  },
  {
    title: 'สถานีสูบส่งและสูบจ่าย',
    rows: [
      { label: 'ปริมาณน้ำสูบจ่าย Line A', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณน้ำสูบจ่าย Line B', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณสูบส่ง',             value: null, unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณน้ำสูบส่ง+สูบจ่ายรวม', value: null, unit: 'ลบ.ม./วัน', bold: true },
    ],
  },
  {
    title: 'แรงดัน',
    rows: [
      { label: 'แรงดันสถานีสูบจ่ายต่ำสุด', value: null, unit: 'ม.' },
      { label: 'แรงดันสถานีสูบจ่ายสูงสุด', value: null, unit: 'ม.' },
      { label: 'แรงดันสถานีสูบส่งต่ำสุด',  value: null, unit: 'ม.' },
      { label: 'แรงดันสถานีสูบส่งสูงสุด',  value: null, unit: 'ม.' },
    ],
  },
  {
    title: 'ปริมาณน้ำระบายตะกอน',
    rows: [
      { label: 'เฟส 1', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 2', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 3', value: null, unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 4', value: null, unit: 'ลบ.ม./วัน' },
    ],
  },
  {
    title: 'การใช้ไฟฟ้า',
    rows: [
      { label: 'SS1A - DPS',  value: null, unit: 'MWh' },
      { label: 'SS1B - TPS',  value: null, unit: 'MWh' },
      { label: 'SS3A - WS1',  value: null, unit: 'MWh' },
      { label: 'SS3B - WS2',  value: null, unit: 'MWh' },
      { label: 'SS2A - RW1',  value: null, unit: 'MWh' },
      { label: 'SS2B - RW2',  value: null, unit: 'MWh' },
      { label: 'SS3 - Bldg.', value: null, unit: 'MWh' },
    ],
  },
];

// ── Shared DailyTableCardUI ──────────────────────────────────────────────────

function DailyTableCardUI({ title, rows, compact = false, grow = false, na = false }) {
  // na: report is loaded — a null value means it could not be computed (N/A, red)
  const anyNA = na && rows.some(r => r.value == null);
  // grow mode: cells use px padding only; vertical space distributed by h-full on tr
  const cell = grow
    ? 'px-2 py-0'
    : compact ? 'px-1.5 py-px' : 'px-2 py-0.5';
  const sz = compact ? 'text-sm' : 'text-base';
  const titlePad = compact ? 'px-2 py-0.5' : 'px-2 py-1';
  return (
    <div className={`rounded border overflow-hidden ${anyNA ? 'border-red-400 bg-red-50' : 'border-earth-border bg-earth-DEFAULT'} ${sz} ${grow ? 'flex flex-col flex-1 min-h-0' : ''}`}>
      <div className={`${titlePad} bg-gray-700 text-white font-bold tracking-wide shrink-0`}>{title}</div>
      <table className={`w-full ${grow ? 'h-full' : ''}`}>
        <tbody className={grow ? 'h-full' : ''}>
          {rows.map((r, i) => {
            const base = i % 2 === 0 ? 'bg-earth-DEFAULT' : 'bg-earth-card';
            const isNA = na && r.value == null;
            const hi   = isNA ? 'bg-red-50' : r.highlight ? 'bg-orange-100' : r.highlightRed ? 'bg-red-100' : base;
            return (
              <tr key={i} className={`${hi} ${grow ? 'h-px' : ''}`}>
                <td className={`${cell} border-b border-earth-border align-middle w-full ${isNA ? 'text-red-500' : 'text-earth-ink2'}`}>{r.label}</td>
                <td className={`${cell} text-right font-mono font-semibold border-b border-earth-border align-middle whitespace-nowrap ${r.bold ? 'font-extrabold' : ''}`}>
                  {r.value != null ? r.value : isNA ? <NA /> : <span className="text-earth-ink3">—</span>}
                </td>
                <td className={`${cell} text-right text-earth-ink3 border-b border-earth-border whitespace-nowrap align-middle pl-1`}>{r.unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── QueryModal ───────────────────────────────────────────────────────────────
function QueryModal({ selectedDate, stationRows, querying, onAllQuery, onReQuery, onClose }) {
  const STATION_LIST = ['RWS1','RWS2','CHEM1','CHEM2','FWS1','FWS2','TPS','DPS','CWS1','CWS2'];
  return (
    <div
      style={{ position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:9999 }}
      className="flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget && !querying) onClose(); }}
    >
      <div style={{ backgroundColor:'#fff' }} className="rounded-xl shadow-2xl w-96 flex flex-col overflow-hidden border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 bg-gray-50">
          <span className="text-sm font-bold text-gray-800">ดึงข้อมูล AquaDAT</span>
          <span className="text-xs text-gray-500 ml-1">{selectedDate}</span>
          <button
            onClick={onAllQuery}
            disabled={querying}
            className="ml-auto px-3 py-1 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-bold rounded transition-colors"
          >{querying ? '⏳ กำลังดึง...' : '▶ All Query'}</button>
        </div>
        <div className="flex flex-col divide-y divide-gray-100">
          {STATION_LIST.map(sid => {
            const row = stationRows[sid] || { status: 'pending', count: 0 };
            const icon = row.status === 'loading' ? '⏳'
                       : row.status === 'done'    ? '✅'
                       : row.status === 'error'   ? '❌'
                       : '○';
            return (
              <div key={sid} style={{ backgroundColor:'#fff' }} className="flex items-center gap-2 px-4 py-2">
                <span className="text-base w-5 text-center leading-none shrink-0">{icon}</span>
                <span className="font-mono text-xs font-semibold text-gray-700 w-16 shrink-0">{sid}</span>
                <div className="flex-1" />
                <button
                  onClick={() => onReQuery(sid)}
                  disabled={querying}
                  className="text-xs px-2 py-0.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-40 rounded text-gray-600 transition-colors"
                >re-query</button>
              </div>
            );
          })}
        </div>
        <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            disabled={querying}
            className="text-xs px-3 py-1.5 bg-white hover:bg-gray-100 disabled:opacity-40 rounded text-gray-700 font-medium border border-gray-300"
          >ปิด</button>
        </div>
      </div>
    </div>
  );
}

// ── DailyReportTab ───────────────────────────────────────────────────────────

const DR_RIGHT_SUB_TABS = ['SUMMARY', 'CHEMICAL', 'FILTRATION', 'RECYCLE WATER'];
const DEFAULT_RECYCLE = [0, 1, 2, 3].map(() => ({ on: true, pct: 100 }));

const DR_CHEM_REMAINING_ROWS = [
  { label: 'PA1', value: null, unit: 'm³' },
  { label: 'PA2', value: null, unit: 'm³' },
  { label: 'AL1', value: null, unit: 'TON' },
  { label: 'AL2', value: null, unit: 'TON' },
  { label: 'CL1', value: null, unit: 'drum' },
  { label: 'CL2', value: null, unit: 'drum' },
];

const DR_COST_ROWS = [
  { label: 'CHEMICAL COST',      value: '0.2637', unit: 'Baht/m³' },
  { label: 'ENERGY COST',        value: '0.5389', unit: 'Baht/m³' },
  { label: 'SLUDGE DISPOSAL COST', value: '0.0062', unit: 'Baht/m³' },
  { label: 'RAW WATER COST',     value: '0.0000', unit: 'Baht/m³' },
  { label: 'TOTAL COST',         value: '0.8088', unit: 'Baht/m³', bold: true },
];

const DR_WASH_PHASES = [
  { label: 'Phase 1 WASH Water', vol: '1,228 m³', frt: '46' },
  { label: 'Phase 2 WASH Water', vol: '1,687 m³', frt: '47' },
  { label: 'Phase 3 WASH Water', vol: '8,510 m³', frt: '53' },
  { label: 'Phase 4 WASH Water', vol: '8,304 m³', frt: '28' },
];

function fmt(v, dec = 0) {
  if (v === null || v === undefined) return null;
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Shown when a value could not be computed because its data is missing
function NA() {
  return <span className="text-red-600 font-bold">N/A</span>;
}

// a + b only when both are known (null → N/A)
function addStrict(a, b) {
  return a == null || b == null ? null : a + b;
}

// ── Filtration Backwash Constants ─────────────────────────────────────────────

// Backwash constants + parser live in server/shared (also used by the server auto-run)
export { FWS_BW_PHASES, parseBWPhase };

// ── Settings Modal ────────────────────────────────────────────────────────────
function ReportSettingsModal({ onClose, onSaved }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const savedJson = useRef(null); // last saved settings, to detect changes

  useEffect(() => {
    get('/api/scenarios/report-settings')
      .then(c => { savedJson.current = JSON.stringify(c); setCfg(c); })
      .catch(() => setMsg('โหลดการตั้งค่าไม่สำเร็จ'));
  }, []);

  function setField(section, key, val) {
    setCfg(prev => {
      if (!prev) return prev;
      const num = val === '' ? '' : Number(val);
      if (section) return { ...prev, [section]: { ...prev[section], [key]: num } };
      return { ...prev, [key]: num };
    });
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await patch('/api/scenarios/report-settings', cfg);
      const changed = JSON.stringify(cfg) !== savedJson.current;
      savedJson.current = JSON.stringify(cfg);
      if (changed && onSaved) {
        setMsg({ ok: true, text: 'บันทึกสำเร็จ — กำลังรีเฟรชรายงาน…' });
        const r = await onSaved();
        setMsg(r?.ok === false
          ? { ok: false, text: 'บันทึกสำเร็จ แต่' + r.text }
          : { ok: true, text: 'บันทึกสำเร็จ — รีเฟรชรายงานแล้ว' });
      } else {
        setMsg({ ok: true, text: changed ? 'บันทึกสำเร็จ' : 'บันทึกสำเร็จ (ไม่มีค่าเปลี่ยน)' });
      }
    } catch (e) {
      setMsg({ ok: false, text: 'บันทึกไม่สำเร็จ: ' + e.message });
    } finally { setSaving(false); }
  }

  const NI = ({ section, field, label, unit }) => {
    const cfgVal = cfg ? (section ? cfg[section]?.[field] ?? '' : cfg[field] ?? '') : '';
    const [local, setLocal] = useState(String(cfgVal));
    useEffect(() => { setLocal(String(cfgVal)); }, [cfgVal]);
    return (
      <div className="flex items-center gap-2">
        <label className="w-44 text-sm text-earth-ink2 shrink-0">{label}</label>
        <input
          type="text"
          inputMode="decimal"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={() => setField(section, field, local)}
          className="w-32 border border-earth-border rounded px-2 py-1 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {unit && <span className="text-sm text-earth-ink3 whitespace-nowrap">{unit}</span>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-earth rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 bg-gray-800 text-white flex items-center justify-between shrink-0">
          <span className="font-bold text-base">⚙ ตั้งค่ารายงานประจำวัน</span>
          <button onClick={onClose} className="text-earth-ink3 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!cfg && !msg && <div className="text-earth-ink3 text-sm text-center py-8">กำลังโหลด…</div>}

          {cfg && (
            <>
              {/* ต้นทุนสารเคมี */}
              <section>
                <div className="text-xs font-bold text-earth-ink2 uppercase tracking-widest mb-2 border-b border-earth-border pb-1">ต้นทุนสารเคมี</div>
                <div className="space-y-2">
                  <NI section="chem_cost" field="alum_ton"     label="ราคา ALUM"     unit="บาท/ตัน" />
                  <NI section="chem_cost" field="pacl_ton"     label="ราคา PACl"     unit="บาท/ตัน" />
                  <NI section="chem_cost" field="chlorine_ton" label="ราคา Chlorine" unit="บาท/ตัน" />
                  <NI section="chem_cost" field="sludge_day"   label="ค่ากำจัดตะกอน" unit="บาท/วัน" />
                </div>
              </section>

              {/* ต้นทุนพลังงาน */}
              <section>
                <div className="text-xs font-bold text-earth-ink2 uppercase tracking-widest mb-2 border-b border-earth-border pb-1">ต้นทุนพลังงาน</div>
                <div className="space-y-2">
                  <NI section="energy_cost" field="peak_price"    label="ราคา Peak"      unit="บาท/kWh" />
                  <NI section="energy_cost" field="offpeak_price" label="ราคา Off-Peak"  unit="บาท/kWh" />
                  <NI section="energy_cost" field="ft_price"      label="ค่า Ft"         unit="บาท/kWh" />
                  <NI section="energy_cost" field="max_energy"    label="ค่า Demand on peak"  unit="บาท/kW" />
                  <NI section="energy_cost" field="demand_kw"     label="Demand on peak (บิล)" unit="kW/เดือน" />
                  <NI section="energy_cost" field="service_charge" label="ค่าบริการ"         unit="บาท/เดือน" />
                  <p className="text-xs text-earth-ink3">TOU 4.2.2 — On-Peak เฉพาะ จ.–ศ. (13/24 ของวัน), ส.–อา. เป็น Off-Peak ทั้งวัน · ค่า Demand และค่าบริการหารเฉลี่ยตามจำนวนวันในเดือน</p>
                </div>
              </section>

              {/* ค่าคงที่ระบบ */}
              <section>
                <div className="text-xs font-bold text-earth-ink2 uppercase tracking-widest mb-2 border-b border-earth-border pb-1">ค่าคงที่ระบบ</div>
                <div className="space-y-2">
                  <NI section={null} field="rw_cost"     label="ต้นทุนน้ำดิบ"          unit="บาท/ลบ.ม." />
                  <NI section={null} field="cwt_area_m2" label="พื้นที่หน้าตัด CWT"   unit="ตร.ม." />
                  <p className="text-xs text-earth-ink3 ml-46">ใช้แปลง Δระดับ (ม.) → Δปริมาตร (ลบ.ม.) เพื่อคำนวณ Water Loss</p>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-earth-card border-t border-earth-border flex items-center justify-between shrink-0">
          <div className={`text-sm ${msg?.ok === false ? 'text-red-600' : 'text-green-600'}`}>
            {typeof msg === 'string' ? msg : msg?.text}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-earth-ink2 border border-earth-border rounded hover:bg-earth-card">ยกเลิก</button>
            <button
              onClick={handleSave}
              disabled={saving || !cfg}
              className="px-4 py-1.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded"
            >{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SAVE DB confirm: pick ผลัด + ผู้จัดทำ and ผลัด + ผู้ทบทวน (CAR whitelist group 2, by shift) ──
// Each person has their own ผลัด, so someone covering for another shift can still be picked.
function SaveConfirmModal({ selectedDate, saving, onConfirm, onClose }) {
  const [shift, setShift]           = useState(null);
  const [preparer, setPreparer]     = useState('');
  const [revShift, setRevShift]     = useState(null);
  const [reviewer, setReviewer]     = useState('');
  const { data: people = [], isLoading, error } = useQuery({
    queryKey: ['daily-report-preparers'],
    queryFn: () => get('/api/daily-report/preparers'),
  });
  const shifts   = [1, 2, 3, 4];

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const notToday = !isToday(selectedDate);
  const canSave = shift != null && preparer && revShift != null && reviewer && !saving;
  const sel ='w-full border border-earth-border rounded px-2 py-1.5 text-sm bg-earth-DEFAULT text-earth-ink focus:outline-none focus:ring-2 focus:ring-purple-300';

  // [ผลัด][ชื่อ] on one line
  const personRow = (label, sh, setSh, name, setName) => {
    const list = people.filter(p => p.shift === sh);
    return (
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <label className="block">
          <span className="text-xs font-semibold text-earth-ink2">ผลัด</span>
          <select className={sel} value={sh ?? ''} disabled={saving}
                  onChange={e => { setSh(e.target.value ? Number(e.target.value) : null); setName(''); }}>
            <option value="">— ผลัด —</option>
            {shifts.map(s => (
              <option key={s} value={s}>ผลัด {s} ({people.filter(p => p.shift === s).length})</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-earth-ink2">{label}</span>
          <select className={sel} value={name} disabled={saving || sh == null}
                  onChange={e => setName(e.target.value)}>
            <option value="">{sh == null ? '— เลือกผลัดก่อน —' : `— เลือก${label} —`}</option>
            {list.map(p => (
              <option key={p.name} value={p.name}>{p.name}{p.position_label ? ` · ${p.position_label}` : ''}</option>
            ))}
          </select>
        </label>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-earth rounded-xl shadow-2xl w-[460px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-earth-border bg-purple-50">
          <h3 className="font-bold text-purple-900">ยืนยันการบันทึก Daily Report</h3>
          <p className="text-xs text-purple-700 mt-0.5">วันที่ {fmtThaiDate(selectedDate)}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {notToday && (
            <div className="flex gap-2 items-start rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <span className="text-amber-600 text-base leading-5">⚠</span>
              <div className="text-xs text-amber-900 leading-5">
                <p className="font-bold">ไม่ใช่วันปัจจุบัน</p>
                <p>จะบันทึกลงวันที่ <strong>{fmtThaiDate(selectedDate)}</strong> (วันนี้ {todayThai()})</p>
              </div>
            </div>
          )}
          {personRow('ผู้จัดทำ', shift, setShift, preparer, setPreparer)}
          {personRow('ผู้ทบทวน', revShift, setRevShift, reviewer, setReviewer)}
          {isLoading && <p className="text-xs text-earth-ink3">กำลังโหลดรายชื่อ...</p>}
          {error && <p className="text-xs text-red-600">โหลดรายชื่อไม่สำเร็จ: {error.message}{/404/.test(error.message) ? ' — LabVenture server ยังเป็นเวอร์ชันเก่า ต้อง restart' : ''}</p>}
          {!isLoading && !error && [shift, revShift].filter((s, i, a) => s != null && a.indexOf(s) === i && people.every(p => p.shift !== s)).map(s => (
            <p key={s} className="text-xs text-amber-700">ไม่มีรายชื่อผลัด {s} ใน Whitelist CAR กลุ่ม 2 — เพิ่มได้ที่หน้า Config › Whitelist</p>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-earth-border flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
                  className="px-3 py-1.5 text-sm text-earth-ink2 border border-earth-border rounded hover:bg-earth-card disabled:opacity-50">ยกเลิก</button>
          <button onClick={() => onConfirm(shift, preparer, reviewer, revShift)} disabled={!canSave}
                  className="px-4 py-1.5 text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded">
            {saving ? 'กำลังบันทึก…' : notToday ? `ยืนยันบันทึกวันที่ ${fmtThaiDate(selectedDate)}` : 'ยืนยันบันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PRINT EXCEL: pick the day (calendar) → รายงานการผลิตน้ำประจำวัน ─────────────
// Opens on the page's date; only days with a SAVE DB can be printed.
const PX_WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const PX_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const pxPad = n => String(n).padStart(2, '0');

function PrintExcelModal({ selectedDate, onClose }) {
  const [value, setValue] = useState(selectedDate);
  const [ym, setYm] = useState(selectedDate.slice(0, 7));
  const [y, m] = ym.split('-').map(Number);
  const nDays = new Date(y, m, 0).getDate();
  const first = `${ym}-01`, last = `${ym}-${pxPad(nDays)}`;

  const { data, isFetching, isError } = useQuery({
    queryKey: ['daily-report-saved-dates', first, last],
    queryFn: () => get(`/api/daily-report/saved-dates?from=${first}&to=${last}`),
  });
  const saved = Object.fromEntries((data ?? []).map(r => [r.date, r]));

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const move = k => { const d = new Date(y, m - 1 + k, 1); setYm(`${d.getFullYear()}-${pxPad(d.getMonth() + 1)}`); };
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // จันทร์ = คอลัมน์แรก
  const cells = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => `${ym}-${pxPad(i + 1)}`)];

  const inMonth = value.slice(0, 7) === ym;
  const info = saved[value];
  const canPrint = !!info;

  function confirm() {
    window.location.href = `${BASE}/api/daily-report/export-mh.xlsx?date=${value}`;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-earth rounded-xl shadow-2xl w-[400px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-earth-border bg-teal-50">
          <h3 className="font-bold text-teal-900">พิมพ์รายงานการผลิตน้ำประจำวัน (Excel)</h3>
          <p className="text-xs text-teal-700 mt-0.5">เลือกวันที่ที่ SAVE DB แล้ว</p>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => move(-1)} className="px-2 py-0.5 rounded border border-earth-border text-earth-ink2 hover:bg-earth-card" aria-label="เดือนก่อน">‹</button>
            <span className="font-semibold text-earth-ink text-sm">📅 {PX_MONTHS[m - 1]} {y + 543}</span>
            <button onClick={() => move(1)} className="px-2 py-0.5 rounded border border-earth-border text-earth-ink2 hover:bg-earth-card" aria-label="เดือนถัดไป">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {PX_WEEKDAYS.map(w => <div key={w} className="text-earth-ink3 font-semibold py-0.5">{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={'e' + i} />;
              const ok = !!saved[d], sel = d === value;
              return (
                <button key={d} onClick={() => setValue(d)} data-date={d}
                  title={ok ? `SAVE DB แล้ว · ผู้จัดทำ ${saved[d].prepared_by ?? '—'}` : 'ยังไม่ได้ SAVE DB'}
                  className={`py-1.5 rounded-md border ${sel
                    ? (ok ? 'bg-teal-700 border-teal-700 text-white font-bold' : 'bg-earth-ink3 border-earth-ink3 text-white font-bold')
                    : ok ? 'bg-teal-100 border-teal-300 text-teal-800 font-semibold hover:bg-teal-200'
                    : 'border-transparent text-earth-ink3 opacity-60 hover:bg-earth-card'} ${d === selectedDate && !sel ? 'ring-1 ring-earth-ink' : ''}`}>
                  {+d.slice(8)}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-earth-ink3">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-teal-100 border border-teal-300" />SAVE DB แล้ว</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded ring-1 ring-earth-ink" />วันที่ของหน้า</span>
            <span className="ml-auto">
              {isError ? <span className="text-red-600">โหลดไม่สำเร็จ (restart server?)</span>
                : isFetching && !data ? 'กำลังโหลด...' : `${data?.length ?? 0} วันในเดือนนี้`}
            </span>
          </div>
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${canPrint ? 'border-teal-300 bg-teal-50 text-teal-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            <p className="font-bold">วันที่ {fmtThaiDate(value)}</p>
            {canPrint ? (
              <p>{info.shift === 0 ? 'สร้างโดยระบบ (AUTO β)' : `ผลัด ${info.shift}`} · ผู้จัดทำ {info.prepared_by ?? '—'} · ผู้ทบทวน {info.reviewed_by ?? '—'}</p>
            ) : (
              <p>{isFetching && inMonth && !data ? 'กำลังตรวจ...' : 'ยังไม่ได้ SAVE DB วันนี้ — กด SAVE DB ก่อนพิมพ์'}</p>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-earth-border flex justify-end gap-2">
          <button onClick={onClose}
                  className="px-3 py-1.5 text-sm text-earth-ink2 border border-earth-border rounded hover:bg-earth-card">ยกเลิก</button>
          <button onClick={confirm} disabled={!canPrint}
                  className="px-4 py-1.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed rounded">
            ยืนยันดาวน์โหลด Excel
          </button>
        </div>
      </div>
    </div>
  );
}

function DailyReportTab({ selectedDate, stage }) {
  const navigate = useNavigate();
  const [rightSubTab, setRightSubTab] = useState('SUMMARY');
  const [reportData, setReportData]   = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fwsBW, setFwsBW]             = useState(null);
  const [recycleSettings, setRecycleSettings] = useState(DEFAULT_RECYCLE);
  const [showMissing, setShowMissing] = useState(false);

  // RECYCLE WATER settings: use what was saved with SAVE DB for this day, else the default
  useEffect(() => {
    let cancelled = false;
    setRecycleSettings(DEFAULT_RECYCLE);
    get(`/api/daily-report/saved?date=${selectedDate}`)
      .then(r => {
        const cfg = r?.recycle;
        if (!cancelled && Array.isArray(cfg) && cfg.length === 4) setRecycleSettings(cfg);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Restore cached query results from sessionStorage when date changes (or on mount).
  // If no sessionStorage cache, auto-load SQLite-only snapshot from /quick.
  useEffect(() => {
    let cancelled = false;
    // Always restore fwsBW from cache regardless of report cache state
    try {
      const cachedBW = sessionStorage.getItem(`dr_fwsbw_${selectedDate}`);
      setFwsBW(cachedBW ? JSON.parse(cachedBW) : null);
    } catch { setFwsBW(null); }
    try {
      const cached = sessionStorage.getItem(`dr_report_${selectedDate}`);
      if (cached) { setReportData(JSON.parse(cached)); return () => { cancelled = true; }; }
    } catch { /* ignore */ }
    setReportData(null);
    get(`/api/daily-report/quick?date=${selectedDate}`)
      .then(d => { if (!cancelled) setReportData(d.report); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedDate]); // eslint-disable-line
  const [showQueryModal, setShowQueryModal] = useState(false);
  // stationRows: { [sid]: { status: 'pending'|'loading'|'done'|'error', count: number } }
  const [stationRows, setStationRows]  = useState({});
  const [querying, setQuerying]        = useState(false); // true while any stream running

  // ESC to close query modal (disabled while querying is in progress)
  useEffect(() => {
    if (!showQueryModal) return;
    function onKey(e) {
      if (e.key === 'Escape' && !querying) setShowQueryModal(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showQueryModal, querying]);

  const STATION_LIST = ['RWS1','RWS2','CHEM1','CHEM2','FWS1','FWS2','TPS','DPS','CWS1','CWS2'];

  // Hidden "load from DB" button — toggled with Ctrl+Shift+F10 (off-site use)
  const [showDbBtn, setShowDbBtn] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'F10') {
        e.preventDefault();
        setShowDbBtn(v => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleDbQuery() {
    setDbLoading(true);
    setSaveMsg(null);
    try {
      const d = await get(`/api/daily-report/fetch-db?date=${selectedDate}`);
      setReportData(d.report);
      try { sessionStorage.setItem(`dr_report_${selectedDate}`, JSON.stringify(d.report)); } catch {}
      const bw = d.fwsMap ? { p12: d.fwsMap.FWS1, p3: d.fwsMap.FWS2, p4: d.fwsMap.FWS2 } : null;
      setFwsBW(bw);
      try { sessionStorage.setItem(`dr_fwsbw_${selectedDate}`, JSON.stringify(bw)); } catch {}
      const c = d.coverage || {};
      if (!c.rows) {
        setSaveMsg({ ok: false, text: `DB ไม่มีข้อมูลวันที่ ${selectedDate} (ใน data.db มี: ${(c.datesInDb || []).join(', ') || '—'})` });
      } else {
        setSaveMsg({ ok: true, text: `โหลดจาก DB แล้ว ${c.rows} ค่า · ล่าสุด ${c.lastTs}` });
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: 'DB QUERY ล้มเหลว: ' + e.message });
    } finally {
      setDbLoading(false);
    }
  }

  function updateRow(sid, patch) {
    setStationRows(prev => {
      const cur = prev[sid] || {};
      const delta = typeof patch === 'function' ? patch(cur) : patch;
      return { ...prev, [sid]: { ...cur, ...delta } };
    });
  }

  async function runStream(url, onDone) {
    setQuerying(true);
    try {
      const resp = await fetch(url, { credentials: 'include', headers: { Accept: 'text/event-stream' } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          let data; try { data = JSON.parse(part.slice(6)); } catch { continue; }
          if (data.type === 'pattern') {
            updateRow(data.station, prev => ({
              patterns: { ...(prev?.patterns || {}), [data.pattern_id]: { status: data.status, count: data.count ?? 0 } }
            }));
          } else if (data.type === 'step' && data.station !== 'compute') {
            updateRow(data.station, { status: data.status, count: data.count ?? 0 });
          } else if (data.type === 'done') {
            setReportData(data.report);
            try { sessionStorage.setItem(`dr_report_${selectedDate}`, JSON.stringify(data.report)); } catch {}
            if (onDone) onDone();
          } else if (data.type === 'error') {
            setSaveMsg({ ok: false, text: 'QUERY ล้มเหลว: ' + data.msg });
          }
        }
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: 'QUERY ล้มเหลว: ' + e.message });
    } finally {
      setQuerying(false);
    }
  }

  function handleQuery() {
    setSaveMsg(null);
    setStationRows(Object.fromEntries(STATION_LIST.map(s => [s, { status: 'pending', count: 0, patterns: {} }])));
    setShowQueryModal(true);
  }

  async function handleAllQuery() {
    setStationRows(Object.fromEntries(STATION_LIST.map(s => [s, { status: 'loading', count: 0 }])));
    setQuerying(true);
    try {
      // Single request — server batches all configIDs into one Uroboros call
      const d = await get(`/api/daily-report/fetch-all?date=${selectedDate}`);
      setReportData(d.report);
      try { sessionStorage.setItem(`dr_report_${selectedDate}`, JSON.stringify(d.report)); } catch {}
      setStationRows(Object.fromEntries(STATION_LIST.map(s => [s, { status: 'done', count: 0 }])));
      if (d.fwsMap) {
        const bw = { p12: d.fwsMap.FWS1, p3: d.fwsMap.FWS2, p4: d.fwsMap.FWS2 };
        setFwsBW(bw);
        try { sessionStorage.setItem(`dr_fwsbw_${selectedDate}`, JSON.stringify(bw)); } catch {}
      }
    } catch (e) {
      setStationRows(Object.fromEntries(STATION_LIST.map(s => [s, { status: 'error', count: 0 }])));
      setSaveMsg({ ok: false, text: 'QUERY ล้มเหลว: ' + e.message });
    } finally {
      setQuerying(false);
    }
  }

  async function handleReQuery(sid) {
    updateRow(sid, { status: 'loading' });
    setQuerying(true);
    try {
      const d = await get(`/api/daily-report/fetch-station?date=${selectedDate}&station=${sid}`);
      setReportData(d.report);
      try { sessionStorage.setItem(`dr_report_${selectedDate}`, JSON.stringify(d.report)); } catch {}
      updateRow(sid, { status: 'done' });
    } catch (e) {
      console.warn('[handleReQuery]', sid, e.message);
      updateRow(sid, { status: 'error' });
      setSaveMsg({ ok: false, text: `QUERY ${sid} ล้มเหลว: ${e.message}` });
    } finally {
      setQuerying(false);
    }
  }

  // Report settings changed → recompute with new prices from the data already
  // queried on the server (no AquaDAT re-fetch).
  async function handleSettingsSaved() {
    try {
      const d = await get(`/api/daily-report/recompute?date=${selectedDate}`);
      if (!d.cached) return { ok: false, text: 'ยังไม่มีข้อมูลที่ query ไว้ — กด QUERY DATA เพื่อคำนวณด้วยค่าใหม่' };
      setReportData(d.report);
      try { sessionStorage.setItem(`dr_report_${selectedDate}`, JSON.stringify(d.report)); } catch {}
      return { ok: true };
    } catch (e) {
      return { ok: false, text: 'รีเฟรชรายงานไม่สำเร็จ: ' + e.message };
    }
  }

  // The not-today warning is shown inside SaveConfirmModal (no separate browser confirm)
  function handleSaveClick() {
    if (incomplete) { setShowMissing(true); return; }
    setShowSaveModal(true);
  }

  // Called from SaveConfirmModal with the shift, preparer and reviewer chosen there
  async function handleSave(shift, preparedBy, reviewedBy, reviewedShift) {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await post('/api/daily-report/save', {
        date: selectedDate, shift, prepared_by: preparedBy, reviewed_by: reviewedBy, reviewed_shift: reviewedShift,
        recycle: recycleSettings,   // RECYCLE WATER tab: % of backwash water returned to the plant, per phase
      });
      setSaveMsg({ ok: true, text: `บันทึกแล้ว (${r.savedAt}) · ผลัด ${shift} · ผู้จัดทำ ${preparedBy} · ผู้ทบทวน ${reviewedBy}` });
      setShowSaveModal(false);
    } catch (e) {
      setSaveMsg({ ok: false, text: 'SAVE ล้มเหลว: ' + e.message });
      setShowSaveModal(false);
    } finally { setSaving(false); }
  }

  // PRINT EXCEL → calendar popup (defaults to the page's date)
  const [showPrintModal, setShowPrintModal] = useState(false);

  // ── Derive display values from reportData ──────────────────────────────
  const d = reportData;

  // Per-phase wash water summary derived from fwsBW (available even on SUMMARY tab)
  const washSummary = FWS_BW_PHASES.map(ph => {
    if (!fwsBW) return null;
    const histKey = ph.id === 'P3' ? 'p3' : ph.id === 'P4' ? 'p4' : 'p12';
    const events = parseBWPhase(fwsBW[histKey], ph.base, ph.totalBeds, ph.startNo, ph.levelIds ?? null);
    if (!events) return null;
    const totalVol  = events.reduce((s, e) => s + (e.washQty ?? 0), 0);
    const frtValues = events.map(e => e.filterRun).filter(v => v != null);
    const avgFRT    = frtValues.length > 0 ? frtValues.reduce((s, v) => s + v, 0) / frtValues.length : null;
    const hasRed    = events.some(e => !e.complete);
    return { totalVol, avgFRT, hasRed };
  });

  const recycleVols = recycleSettings.map((s, i) => {
    const vol = washSummary[i]?.totalVol ?? 0;
    return s.on ? vol * s.pct / 100 : 0;
  });
  const totalRecycled = recycleVols.reduce((s, v) => s + v, 0);
  const adjWaterLoss = (() => {
    if (!d || d.summary.water_loss_pct == null) return null;
    const rwTotal = d.card1_raw_water.total;
    if (!rwTotal) return d.summary.water_loss_pct;
    return d.summary.water_loss_pct - (totalRecycled / rwTotal * 100);
  })();

  const kpi = [
    { key: 'water',  label: 'WATER PRODUCED', value: d ? fmt(d.card3_pumped.total) : '—',           unit: 'ลบ.ม./วัน', color: '#16a34a' },
    { key: 'loss',   label: '% LOSS WATER',   value: adjWaterLoss != null ? fmt(adjWaterLoss, 2) : (d ? fmt(d.summary.water_loss_pct, 2) : '—'), unit: '%', color: '#dc2626' },
    { key: 'energy', label: 'ENERGY',         value: d ? fmt(d.card12_energy.total, 2) : '—',        unit: 'MWh',         color: '#d97706' },
  ];

  // TOTAL COST breakdown (บาท/ลบ.ม. of water produced)
  const kpiCostRows = [
    { key: 'chem',   label: 'ต้นทุนสารเคมี',      value: d ? fmt(d.summary.chem_cost_per_m3, 4)   : '—' },
    { key: 'energy', label: 'ต้นทุนพลังงานไฟฟ้า',  value: d ? fmt(d.summary.energy_per_m3, 4)      : '—' },
    { key: 'sludge', label: 'ต้นทุนกำจัดตะกอน',    value: d ? fmt(d.summary.sludge_cost_per_m3, 4) : '—' },
    { key: 'total',  label: 'ต้นทุนรวม',           note: '*ไม่รวมค่าน้ำดิบ', value: d ? fmt(d.summary.op_cost_per_m3, 4) : '—', total: true },
  ];

  const summaryCards = d ? [
    {
      title: 'สถานีสูบน้ำดิบ 1 และ 2',
      rows: [
        { label: 'เฟส 1', value: fmt(d.card1_raw_water.phase1), unit: 'ลบ.ม./วัน' },
        { label: 'เฟส 2', value: fmt(d.card1_raw_water.phase2), unit: 'ลบ.ม./วัน' },
        { label: 'เฟส 3', value: fmt(d.card1_raw_water.phase3), unit: 'ลบ.ม./วัน' },
        { label: 'เฟส 4', value: fmt(d.card1_raw_water.phase4), unit: 'ลบ.ม./วัน' },
        { label: 'ปริมาณน้ำดิบรวม', value: fmt(d.card1_raw_water.total), unit: 'ลบ.ม./วัน', bold: true },
      ],
    },
    {
      title: 'ระดับน้ำ',
      rows: [
        { label: 'ระดับน้ำ CWT 24:00', value: fmt(d.card2_water_level.cwt_at24, 2), unit: 'ม.' },
        { label: 'ระดับน้ำ CWT ต่ำสุด', value: fmt(d.card2_water_level.cwt_min, 2), unit: 'ม.' },
        { label: 'ระดับน้ำ CWT สูงสุด', value: fmt(d.card2_water_level.cwt_max, 2), unit: 'ม.' },
        { label: 'ระดับน้ำ RW ต่ำสุด',  value: fmt(d.card2_water_level.rw_min, 2),  unit: 'ม.' },
        { label: 'ระดับน้ำ RW สูงสุด',  value: fmt(d.card2_water_level.rw_max, 2),  unit: 'ม.' },
      ],
    },
    {
      title: 'สถานีสูบส่งและสูบจ่าย',
      rows: [
        { label: 'ปริมาณน้ำสูบจ่าย Line A',     value: fmt(d.card3_pumped.dps_lineA), unit: 'ลบ.ม./วัน' },
        { label: 'ปริมาณน้ำสูบจ่าย Line B',     value: fmt(d.card3_pumped.dps_lineB), unit: 'ลบ.ม./วัน' },
        { label: 'ปริมาณสูบส่ง',                value: fmt(d.card3_pumped.tps),       unit: 'ลบ.ม./วัน' },
        { label: 'ปริมาณน้ำสูบส่ง+สูบจ่ายรวม', value: fmt(d.card3_pumped.total),     unit: 'ลบ.ม./วัน', bold: true },
      ],
    },
    {
      title: 'แรงดัน',
      rows: [
        { label: 'แรงดันสถานีสูบจ่ายต่ำสุด', value: fmt(d.card4_pressure.dps_min, 2), unit: 'ม.' },
        { label: 'แรงดันสถานีสูบจ่ายสูงสุด', value: fmt(d.card4_pressure.dps_max, 2), unit: 'ม.' },
        { label: 'แรงดันสถานีสูบส่งต่ำสุด',  value: fmt(d.card4_pressure.tps_min, 2), unit: 'ม.' },
        { label: 'แรงดันสถานีสูบส่งสูงสุด',  value: fmt(d.card4_pressure.tps_max, 2), unit: 'ม.' },
      ],
    },
    {
      title: 'ปริมาณน้ำระบายตะกอน',
      rows: [
        { label: 'เฟส 1', value: fmt(d.card11_sludge.phase1), unit: 'ลบ.ม./วัน' },
        { label: 'เฟส 2', value: fmt(d.card11_sludge.phase2), unit: 'ลบ.ม./วัน' },
        { label: 'เฟส 3', value: fmt(d.card11_sludge.phase3), unit: 'ลบ.ม./วัน' },
        { label: 'เฟส 4', value: fmt(d.card11_sludge.phase4), unit: 'ลบ.ม./วัน' },
      ],
    },
    {
      title: 'การใช้ไฟฟ้า',
      rows: [
        { label: 'SS1A - DPS',  value: fmt(d.card12_energy.dps,  2), unit: 'MWh' },
        { label: 'SS1B - TPS',  value: fmt(d.card12_energy.tps,  2), unit: 'MWh' },
        { label: 'SS3A - WS1',  value: fmt(d.card12_energy.fws1, 2), unit: 'MWh' },
        { label: 'SS3B - WS2',  value: fmt(d.card12_energy.fws2, 2), unit: 'MWh' },
        { label: 'SS2A - RW1',  value: fmt(d.card12_energy.rws1, 2), unit: 'MWh' },
        { label: 'SS2B - RW2',  value: fmt(d.card12_energy.rws2, 2), unit: 'MWh' },
        { label: 'SS3 - Bldg.', value: fmt(d.card12_energy.bldg, 2), unit: 'MWh' },
      ],
    },
  ] : DR_RIGHT_SUMMARY;

  const chemRemaining = d ? [
    { label: 'PA1', value: fmt(d.card13_chem_remaining.pacl.chem1_m3, 1) },
    { label: 'PA2', value: fmt(d.card13_chem_remaining.pacl.chem2_m3, 1) },
    { label: 'AL1', value: fmt(d.card13_chem_remaining.alum.chem1_m3 != null ? d.card13_chem_remaining.alum.chem1_m3 * 1.33 : null, 1) },
    { label: 'AL2', value: fmt(d.card13_chem_remaining.alum.chem2_m3 != null ? d.card13_chem_remaining.alum.chem2_m3 * 1.33 : null, 1) },
    { label: 'CL1', value: fmt(d.card13_chem_remaining.chlorine.chem1_ton, 1) },
    { label: 'CL2', value: fmt(d.card13_chem_remaining.chlorine.chem2_ton, 1) },
  ] : DR_CHEM_REMAINING_ROWS;

  const chemDays = d ? [
    fmt(d.card13_chem_remaining.pacl.days_ph12, 1),
    fmt(d.card13_chem_remaining.pacl.days_ph34, 1),
    fmt(d.card13_chem_remaining.alum.days_ph12, 1),
    fmt(d.card13_chem_remaining.alum.days_ph34, 1),
    fmt(d.card13_chem_remaining.chlorine.days_chem1, 1),
    fmt(d.card13_chem_remaining.chlorine.days_chem2, 1),
  ] : ['—','—','—','—','—','—'];

  const costRows = d ? [
    { label: 'CHEMICAL COST',        value: fmt(d.summary.chem_cost_per_m3,  4), unit: 'Baht/m³' },
    { label: 'ENERGY COST',          value: fmt(d.summary.energy_per_m3,     4), unit: 'Baht/m³' },
    { label: 'SLUDGE DISPOSAL COST', value: fmt(d.summary.total_cost_per_m3 != null && d.summary.chem_cost_per_m3 != null && d.summary.energy_per_m3 != null ? null : null, 4), unit: 'Baht/m³' },
    { label: 'RAW WATER COST',       value: '—',                                  unit: 'Baht/m³' },
    { label: 'TOTAL COST',           value: fmt(d.summary.total_cost_per_m3, 4), unit: 'Baht/m³', bold: true },
  ] : DR_COST_ROWS;

  const paclUse  = d ? addStrict(d.card5_chem1_pacl.out, d.card6_chem2_pacl.out) : null;
  const paclInc  = d ? addStrict(d.card5_chem1_pacl.in,  d.card6_chem2_pacl.in)  : null;
  const alumUse  = d ? addStrict(d.card9_chem1_alum.out, d.card10_chem2_alum.out) : null;
  const alumInc  = d ? addStrict(d.card9_chem1_alum.in,  d.card10_chem2_alum.in)  : null;
  const clUseKg  = d ? addStrict(d.card7_chem1_cl.use_kg, d.card8_chem2_cl.use_kg) : null;
  // One cell of the chemical usage table: N/A (red) when the report is loaded but the value is missing
  const usageCell = (v, dec, suffix = '') => {
    const isNA = d && v == null;
    return (
      <td className={`px-1 py-0.5 text-center font-mono border border-earth-border ${isNA ? 'bg-red-50' : 'text-earth-ink'}`}>
        {!d ? '—' : isNA ? <NA /> : `${fmt(v, dec)}${suffix}`}
      </td>
    );
  };

  const totalWashWater = washSummary.reduce((s, ph) => s + (ph?.totalVol ?? 0), 0);
  const sankeyProps = d ? {
    rw:           d.card1_raw_water.total ?? 0,
    tps:          d.card3_pumped.tps ?? 0,
    dpsA:         d.card3_pumped.dps_lineA ?? 0,
    dpsB:         d.card3_pumped.dps_lineB ?? 0,
    sludge:       d.card11_sludge.total ?? 0,
    serviceWater: d.summary.service_water_m3 ?? 0,
    washWater:    totalRecycled,
    loss:         adjWaterLoss != null
                    ? Math.max(0, (adjWaterLoss / 100) * (d.card1_raw_water.total ?? 0))
                    : null,
  } : { rw: 0, tps: 0, dpsA: 0, dpsB: 0, sludge: 0, serviceWater: 0, washWater: 0, loss: null };

  const dayOpen = !!d && d.day_complete === false;
  const chemDonutRows = buildChemDonutRows(d);

  // CHEMICAL sub-tab cards (also checked by SAVE DB)
  const chemCards = [
    { title: 'CHEM1 PACl',     rows: [{ label: 'Δ Tank A', value: d ? fmt(d.card5_chem1_pacl.tankA_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank B', value: d ? fmt(d.card5_chem1_pacl.tankB_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card5_chem1_pacl.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card5_chem1_pacl.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card5_chem1_pacl.out, 2) : null, unit: 'TON', bold: true }] },
    { title: 'CHEM2 PACl',     rows: [{ label: 'Δ Tank C', value: d ? fmt(d.card6_chem2_pacl.tankC_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank D', value: d ? fmt(d.card6_chem2_pacl.tankD_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card6_chem2_pacl.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card6_chem2_pacl.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card6_chem2_pacl.out, 2) : null, unit: 'TON', bold: true }] },
    { title: 'CHEM1 ALUM',     rows: [{ label: 'Δ Tank A', value: d ? fmt(d.card9_chem1_alum.tankA_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank B', value: d ? fmt(d.card9_chem1_alum.tankB_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card9_chem1_alum.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card9_chem1_alum.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card9_chem1_alum.out, 2) : null, unit: 'TON', bold: true }] },
    { title: 'CHEM2 ALUM',     rows: [{ label: 'Δ Tank C', value: d ? fmt(d.card10_chem2_alum.tankC_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank D', value: d ? fmt(d.card10_chem2_alum.tankD_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card10_chem2_alum.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card10_chem2_alum.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card10_chem2_alum.out, 2) : null, unit: 'TON', bold: true }] },
    { title: 'CHEM1 Chlorine', rows: [{ label: 'Δ Line A', value: d ? fmt(d.card7_chem1_cl.lineA_delta, 1) : null, unit: 'kg' }, { label: 'Δ Line B', value: d ? fmt(d.card7_chem1_cl.lineB_delta, 1) : null, unit: 'kg' }, { label: 'IN', value: d ? fmt(d.card7_chem1_cl.in_kg, 1) : null, unit: 'kg' }, { label: 'USE', value: d ? fmt(d.card7_chem1_cl.use_kg, 1) : null, unit: 'kg', bold: true }] },
    { title: 'CHEM2 Chlorine', rows: [{ label: 'Δ Line C', value: d ? fmt(d.card8_chem2_cl.lineC_delta, 1) : null, unit: 'kg' }, { label: 'Δ Line D', value: d ? fmt(d.card8_chem2_cl.lineD_delta, 1) : null, unit: 'kg' }, { label: 'IN', value: d ? fmt(d.card8_chem2_cl.in_kg, 1) : null, unit: 'kg' }, { label: 'USE', value: d ? fmt(d.card8_chem2_cl.use_kg, 1) : null, unit: 'kg', bold: true }] },
  ];

  // Everything the page shows as N/A or a red box. SAVE DB is blocked while this is not empty.
  const missing = [];
  if (d) {
    const need = (v, label) => { if (v == null) missing.push(label); };
    kpi.forEach(k => need(k.value, k.label));
    kpiCostRows.forEach(c => need(c.value, `TOTAL COST · ${c.label}`));
    summaryCards.forEach(card => card.rows.forEach(r => need(r.value, `${card.title} · ${r.label}`)));
    need(d.summary.service_water_m3, 'SERVICE WATER');
    chemRemaining.forEach(r => need(r.value, `CHEMICAL REMAINING · ${r.label}`));
    chemDays.forEach((v, i) => need(v, `CHEMICAL REMAINING (Day) · ${chemRemaining[i]?.label}`));
    [['Alum USE', alumUse], ['Alum INCOME', alumInc], ['PACl USE', paclUse], ['PACl INCOME', paclInc],
     ['CHLORINE USE', clUseKg], ['CHLORINE INCOME', d.cl_income], ['CHLORINE RETURN', d.cl_return]]
      .forEach(([label, v]) => need(v, `การใช้สารเคมี · ${label}`));
    chemDonutRows.forEach(r => {
      if (!r.noData && (r.useNA || r.actualNA || r.targetNA))
        missing.push(`CHEMICAL ACCURACY · ${r.phase}${dayOpen ? ' (ยังไม่ครบ 24:00)' : ''}`);
    });
    chemCards.forEach(card => card.rows.forEach(r => need(r.value, `${card.title} · ${r.label}`)));
    washSummary.forEach((ws, i) => { if (ws?.hasRed) missing.push(`Phase ${i + 1} WASH Water (ข้อมูลล้างบ่อกรองไม่ครบ)`); });
  }
  const incomplete = missing.length > 0;

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-earth-DEFAULT">
      {showSettings && <ReportSettingsModal onClose={() => setShowSettings(false)} onSaved={handleSettingsSaved} />}
      {showPrintModal && (
        <PrintExcelModal selectedDate={selectedDate} onClose={() => setShowPrintModal(false)} />
      )}
      {showSaveModal && (
        <SaveConfirmModal
          selectedDate={selectedDate}
          saving={saving}
          onConfirm={handleSave}
          onClose={() => !saving && setShowSaveModal(false)}
        />
      )}

      {/* ── Query Modal ── */}
      {showQueryModal && (
        <QueryModal
          selectedDate={selectedDate}
          stationRows={stationRows}
          querying={querying}
          onAllQuery={handleAllQuery}
          onReQuery={handleReQuery}
          onClose={() => setShowQueryModal(false)}
        />
      )}

      {/* ── COL 1 (3): ACTION BOX + KPI + Sankey + tables ── */}
      <div className="flex-[3] min-w-0 border-r border-earth-border flex flex-col overflow-hidden bg-earth-DEFAULT">

        {/* Row 1: buttons */}
        <div className="shrink-0 bg-earth-card border-b border-earth-border px-2 py-1.5 flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleQuery}
            className="px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded transition-colors"
          >QUERY DATA</button>

          {showDbBtn && (
            <button
              onClick={handleDbQuery}
              disabled={dbLoading}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded transition-colors"
              title="ดึงข้อมูลจาก Uroboros data.db (ไม่ผ่าน AquaDAT) — ซ่อน/แสดงด้วย Ctrl+Shift+F10"
            >{dbLoading ? '⏳...' : 'FROM DB'}</button>
          )}

          <button
            onClick={handleSaveClick}
            disabled={saving || !reportData || incomplete}
            title={incomplete ? `ข้อมูลไม่ครบ ${missing.length} รายการ — SAVE DB ไม่ได้:\n• ${missing.slice(0, 25).join('\n• ')}${missing.length > 25 ? `\n… และอีก ${missing.length - 25} รายการ` : ''}` : undefined}
            className="px-2.5 py-1 bg-purple-500 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded transition-colors"
          >{saving ? '⏳...' : 'SAVE DB'}</button>
          {incomplete && (
            <button
              onClick={() => setShowMissing(v => !v)}
              className="px-1.5 py-0.5 text-xs font-bold rounded border border-red-400 bg-red-50 text-red-700 hover:bg-red-100"
              title="ดูรายการข้อมูลที่ไม่ครบ"
            >⚠ ไม่ครบ {missing.length}</button>
          )}

          <button
            onClick={() => setShowPrintModal(true)}
            disabled={saving}
            className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded transition-colors"
            title="ดาวน์โหลดรายงานการผลิตน้ำประจำวัน (Excel) จากข้อมูลที่ SAVE DB ไว้"
          >PRINT EXCEL</button>

          <button
            onClick={() => setShowSettings(true)}
            className="ml-auto px-2.5 py-1 bg-earth-DEFAULT hover:bg-earth-card text-earth-ink2 text-sm font-medium rounded border border-earth-border transition-colors"
            title="ตั้งค่าราคาและค่าคงที่"
          >⚙ ตั้งค่า</button>
        </div>

        {/* Missing data list (blocks SAVE DB) */}
        {incomplete && showMissing && (
          <div className="shrink-0 px-2 py-1 text-xs border-b bg-red-50 text-red-700 border-red-200 max-h-32 overflow-y-auto">
            <div className="font-bold mb-0.5">SAVE DB ไม่ได้ — ข้อมูลไม่ครบ {missing.length} รายการ (กล่องสีแดง / N/A)</div>
            <ul className="list-disc pl-4">{missing.map(m => <li key={m}>{m}</li>)}</ul>
          </div>
        )}

        {/* Status bar */}
        {saveMsg && (
          <div className={`shrink-0 px-2 py-1 text-xs font-medium border-b ${saveMsg.ok === false ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
            <span>{saveMsg.text}</span>
          </div>
        )}

        {/* Row 2: A. SUMMARY KPI */}
        <div className="shrink-0 border-b border-earth-border px-2 py-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-bold text-earth-ink2 uppercase tracking-wider">A. SUMMARY KPI</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {kpi.map(k => (
              <div key={k.key} className={`rounded border px-2 py-1 min-w-0 ${d && k.value == null ? 'border-red-400 bg-red-50' : 'border-earth-border'}`}>
                <div className="flex items-center justify-between gap-1 leading-tight">
                  <span className="text-xs text-earth-ink3 uppercase tracking-wide truncate">{k.label}</span>
                  {k.key === 'energy' && (
                    <span className="text-[10px] font-bold px-1 rounded shrink-0"
                          style={{ background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>
                      ไม่คิด SS3
                    </span>
                  )}
                </div>
                <div className="text-xl font-black font-mono leading-tight truncate" style={{ color: k.color }}>
                  {k.value ?? (d ? <NA /> : <span className="text-earth-ink3 text-lg">—</span>)}
                </div>
                <div className="text-xs text-earth-ink3">{k.unit}</div>
              </div>
            ))}
          </div>

          {/* TOTAL COST — 4 sub-boxes */}
          <div className="mt-1.5 rounded border border-earth-border px-2 py-1">
            <div className="flex items-center justify-between leading-tight mb-1">
              <span className="text-xs text-earth-ink3 uppercase tracking-wide">TOTAL COST</span>
              <span className="text-xs text-earth-ink3">บาท/ลบ.ม.</span>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-1">
              {kpiCostRows.map(c => (
                <div key={c.key}
                     className={`rounded px-1.5 py-1 min-w-0 flex flex-col ${d && c.value == null ? `${c.total ? 'border-2' : 'border'} border-red-400 bg-red-50` : c.total ? 'border-2' : 'border border-earth-border bg-earth-card'}`}
                     style={c.total && !(d && c.value == null) ? { borderColor: '#9333ea', background: '#faf5ff' } : undefined}>
                  <div className="text-[11px] leading-tight text-earth-ink2 font-semibold break-words" style={{ minHeight: '2.2em' }}>
                    {c.label}
                    {c.note && <span className="block text-[10px] text-earth-ink3 italic font-normal">{c.note}</span>}
                  </div>
                  <div className={`mt-auto font-black font-mono leading-tight ${c.total ? 'text-lg' : 'text-base'}`}
                       style={{ color: '#9333ea' }}>
                    {c.value ?? (d ? <NA /> : '—')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: B. Sankey */}
        <div className="flex-1 px-2 pt-1.5 pb-1 flex flex-col" style={{ minHeight: '260px' }}>
          <div className="text-sm font-bold text-earth-ink2 uppercase tracking-wider mb-1 border-b border-earth-border pb-0.5">B. OPERATION ACCURACY WALL</div>
          <div className="flex-1" style={{ minHeight: '220px' }}>
            <WaterSankeyChart {...sankeyProps} />
          </div>
        </div>

        {/* CHEMICAL REMAINING — 2 tables */}
        <div className="shrink-0 px-2 pt-1 pb-1.5 border-t border-earth-border space-y-1">
          {/* Table 1 — Remaining stock */}
          <div className="text-xs font-bold text-earth-ink2 uppercase tracking-wider">CHEMICAL REMAINING</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-earth-card">
                {['PA1','PA2','AL1','AL2','CL1','CL2','UNIT'].map(h => (
                  <th key={h} className="px-1 py-0.5 text-earth-ink2 font-bold text-center border border-earth-border">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {chemRemaining.map(r => (
                  <td key={r.label} className={`px-1 py-0.5 text-center font-mono text-earth-ink border border-earth-border ${d && r.value == null ? 'bg-red-50' : ''}`}>
                    {r.value ?? (d ? <NA /> : <span className="text-earth-ink3">—</span>)}
                  </td>
                ))}
                <td className="px-1 py-0.5 text-center text-earth-ink3 border border-earth-border whitespace-nowrap">m³/TON</td>
              </tr>
              <tr>
                {chemDays.map((v, i) => (
                  <td key={i} className={`px-1 py-0.5 text-center font-mono text-earth-ink border border-earth-border ${d && v == null ? 'bg-red-50' : ''}`}>
                    {v ?? (d ? <NA /> : <span className="text-earth-ink3">—</span>)}
                  </td>
                ))}
                <td className="px-1 py-0.5 text-center text-earth-ink3 border border-earth-border">Day</td>
              </tr>
            </tbody>
          </table>

          {/* Table 2 — Daily usage grouped by chemical */}
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-earth-card">
                <th colSpan={2} className="px-1 py-0.5 text-center border border-earth-border text-earth-ink2 font-bold">Alum (Ton)</th>
                <th colSpan={2} className="px-1 py-0.5 text-center border border-earth-border text-earth-ink2 font-bold">PACl (Ton)</th>
                <th colSpan={3} className="px-1 py-0.5 text-center border border-earth-border text-earth-ink2 font-bold">CHLORINE (Ton)</th>
              </tr>
              <tr className="bg-earth-DEFAULT">
                {['USE','INCOME','USE','INCOME','USE','INCOME','RETURN'].map((h, i) => (
                  <th key={i} className="px-1 py-0.5 text-center border border-earth-border text-amber-700 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {usageCell(alumUse, 2)}
                {usageCell(alumInc, 2)}
                {usageCell(paclUse, 2)}
                {usageCell(paclInc, 2)}
                {usageCell(clUseKg != null ? clUseKg / 1000 : null, 3)}
                {usageCell(d?.cl_income, 0, ' ท่อ')}
                {usageCell(d?.cl_return, 0, ' ท่อ')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── COL 2 (3.6): C. Chemical Accuracy Wall (components/ChemAccuracyWall.jsx — ใช้ร่วมกับ popup ใน /record) ── */}
      <ChemAccuracyWall rows={chemDonutRows} className="min-w-0 border-r border-earth-border" style={{ flex: '4.04 1 0%' }} />

      {/* ── COL 3 (4.4): Data tables ── */}
      <div className="min-w-0 flex flex-col overflow-hidden bg-earth-DEFAULT" style={{ flex: '3.96 1 0%' }}>
        <div className="shrink-0 flex border-b border-earth-border bg-earth-DEFAULT">
          {DR_RIGHT_SUB_TABS.map(s => (
            <button
              key={s}
              onClick={() => setRightSubTab(s)}
              className={[
                'px-4 py-1.5 text-base font-semibold border-r border-earth-border transition-colors',
                rightSubTab === s
                  ? 'bg-earth-DEFAULT text-earth-ink border-b-2 border-b-blue-500'
                  : 'bg-earth-card text-earth-ink2 hover:bg-earth-DEFAULT',
              ].join(' ')}
            >{s}</button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-1.5 gap-1">
          {rightSubTab === 'SUMMARY' && (
            <>
              <div className="flex-[4] min-h-0 gap-1" style={{ display: 'grid', gridTemplateColumns: '2.7fr 2.3fr' }}>
                <DailyTableCardUI title={summaryCards[0].title} rows={summaryCards[0].rows} compact grow na={!!d} />
                <DailyTableCardUI title={summaryCards[1].title} rows={summaryCards[1].rows} compact grow na={!!d} />
              </div>
              <div className="min-h-0 gap-1" style={{ flex: '3.4 1 0%', display: 'grid', gridTemplateColumns: '2.7fr 2.3fr' }}>
                <DailyTableCardUI title={summaryCards[2].title} rows={summaryCards[2].rows} compact grow na={!!d} />
                <DailyTableCardUI title={summaryCards[3].title} rows={summaryCards[3].rows} compact grow na={!!d} />
              </div>
              <div className="min-h-0 gap-1" style={{ flex: '5.6 1 0%', display: 'grid', gridTemplateColumns: '2.7fr 2.3fr' }}>
                <div className="flex flex-col gap-1 min-h-0 overflow-hidden">
                  <DailyTableCardUI title={summaryCards[4].title} rows={summaryCards[4].rows} compact grow na={!!d} />
                  <div className="shrink-0 grid grid-cols-2 gap-1">
                    <div className="border border-earth-border rounded bg-earth-DEFAULT px-1.5 py-1.5">
                      <div className="text-xs text-earth-ink2 font-semibold leading-tight">Filter Availability</div>
                      <div className="text-sm font-black font-mono">
                        {d?.filter_availability
                          ? d.filter_availability.map(({ phase, cap, available }, i) => (
                              <span key={phase} style={{ color: available === cap ? '#16a34a' : '#f97316' }}>
                                {i > 0 && <span className="text-earth-ink3"> | </span>}{available}
                              </span>
                            ))
                          : <span className="text-earth-ink3">—</span>}
                      </div>
                    </div>
                    <div className={`border rounded px-1.5 py-1.5 ${d && d.summary.service_water_m3 == null ? 'border-red-400 bg-red-50' : 'border-earth-border bg-earth-DEFAULT'}`}>
                      <div className={`text-xs font-semibold leading-tight ${d && d.summary.service_water_m3 == null ? 'text-red-500' : 'text-earth-ink2'}`}>SERVICE WATER</div>
                      <div className="text-sm font-black text-earth-ink font-mono">
                        {!d ? '—' : d.summary.service_water_m3 == null ? <NA /> : `${fmt(d.summary.service_water_m3)} m³`}
                      </div>
                    </div>
                  </div>
                </div>
                <DailyTableCardUI title={summaryCards[5].title} rows={summaryCards[5].rows} compact grow na={!!d} />
              </div>
              <div className="flex-[2] min-h-0 grid grid-cols-4 gap-1">
                {[0,1,2,3].map(i => {
                  const ws = washSummary[i];
                  const red = ws?.hasRed;
                  return (
                    <div key={i} className={`border rounded p-1.5 text-center flex flex-col justify-center ${red ? 'border-red-400 bg-red-50' : 'border-earth-border bg-earth-DEFAULT'}`}>
                      <div className={`text-xs font-semibold leading-tight ${red ? 'text-red-500' : 'text-earth-ink3'}`}>Phase {i + 1} WASH Water</div>
                      <div className={`text-base font-black ${red ? 'text-red-700' : 'text-earth-ink'}`}>
                        {ws
                          ? (ws.totalVol > 0 ? `${ws.totalVol.toLocaleString('en-US', { maximumFractionDigits: 0 })} m³` : '0 m³')
                          : (querying ? '…' : '0 m³')}
                      </div>
                      <div className={`text-sm ${red ? 'text-red-500' : 'text-earth-ink2'}`}>
                        FRT: <span className="font-bold">{ws?.avgFRT != null ? ws.avgFRT.toFixed(1) : '0'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {rightSubTab === 'CHEMICAL' && (
            <div className="grid grid-cols-2 gap-2">
              {chemCards.map(c => <DailyTableCardUI key={c.title} {...c} na={!!d} />)}
            </div>
          )}
          {rightSubTab === 'RECYCLE WATER' && (
            <div className="flex flex-col gap-2.5 p-3 overflow-y-auto">
              {[0, 1, 2, 3].map(i => {
                const s = recycleSettings[i];
                const totalVol = washSummary[i]?.totalVol ?? 0;
                const recycled = s.on ? Math.round(totalVol * s.pct / 100) : 0;
                const PINS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
                return (
                  <div key={i}
                    className="rounded-xl border p-3 transition-all duration-300"
                    style={{
                      borderColor: s.on ? '#38bdf8' : '#e2e8f0',
                      background: s.on ? 'linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%)' : '#f8fafc',
                    }}>
                    {/* Header row */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-sm font-black tracking-wider" style={{ color: s.on ? '#0369a1' : '#94a3b8' }}>
                        RW#{i + 1}
                      </span>
                      {/* Toggle */}
                      <button
                        onClick={() => setRecycleSettings(prev => prev.map((x, j) => j === i ? { ...x, on: !x.on } : x))}
                        className="relative flex-shrink-0 transition-colors duration-300 focus:outline-none"
                        style={{
                          width: 44, height: 24, borderRadius: 12,
                          background: s.on ? '#0ea5e9' : '#cbd5e1',
                        }}>
                        <span
                          className="absolute top-0.5 bg-white rounded-full shadow transition-transform duration-300"
                          style={{ width: 20, height: 20, left: 2, transform: s.on ? 'translateX(20px)' : 'translateX(0)' }}
                        />
                      </button>
                      <span className="text-xs font-bold w-7" style={{ color: s.on ? '#0ea5e9' : '#94a3b8' }}>
                        {s.on ? 'ON' : 'OFF'}
                      </span>
                      <div className="flex-1" />
                      <div className="text-right">
                        <div className="text-base font-black tabular-nums" style={{ color: s.on ? '#0c4a6e' : '#94a3b8' }}>
                          {s.on && totalVol > 0 ? recycled.toLocaleString('en-US') : '—'}
                          <span className="text-xs font-normal ml-1" style={{ color: '#94a3b8' }}>m³</span>
                        </div>
                        <div className="text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>
                          BW: {totalVol > 0 ? totalVol.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'} m³
                        </div>
                      </div>
                    </div>
                    {/* Pin bar */}
                    <div className="flex items-center gap-0.5">
                      {PINS.map(pct => {
                        const filled = s.on && pct <= s.pct;
                        const isSelected = s.on && pct === s.pct;
                        return (
                          <button
                            key={pct}
                            onClick={() => setRecycleSettings(prev => prev.map((x, j) => j === i ? { ...x, pct } : x))}
                            disabled={!s.on}
                            title={`${pct}%`}
                            style={{
                              flex: 1, height: 20, borderRadius: 3,
                              background: filled ? '#0ea5e9' : s.on ? '#bae6fd' : '#e2e8f0',
                              border: isSelected ? '2px solid #0284c7' : '2px solid transparent',
                              cursor: s.on ? 'pointer' : 'not-allowed',
                              transition: 'background 0.15s',
                            }}
                          />
                        );
                      })}
                      <span className="ml-1.5 text-xs font-bold tabular-nums w-9 text-right"
                            style={{ color: s.on ? '#0369a1' : '#94a3b8' }}>
                        {s.pct}%
                      </span>
                    </div>
                  </div>
                );
              })}
              {/* Footer summary */}
              <div className="mt-1 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Total Recycled</span>
                  <span className="text-sm font-black tabular-nums text-sky-800">
                    {totalRecycled > 0 ? Math.round(totalRecycled).toLocaleString('en-US') : '—'} m³
                  </span>
                </div>
                {adjWaterLoss != null && (
                  <div className="flex justify-between items-center border-t border-sky-200 pt-1.5">
                    <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">% Loss (adj.)</span>
                    <span className="text-sm font-black tabular-nums text-red-600">{fmt(adjWaterLoss, 2)} %</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {rightSubTab === 'FILTRATION' && (
            <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-scroll pr-1">
              {querying && (
                <div className="text-xs text-earth-ink3 text-center py-3">กำลังโหลดข้อมูลบ่อกรอง...</div>
              )}
              {FWS_BW_PHASES.map(ph => {
                const histKey = ph.id === 'P3' ? 'p3' : ph.id === 'P4' ? 'p4' : 'p12';
                const events    = fwsBW ? parseBWPhase(fwsBW[histKey], ph.base, ph.totalBeds, ph.startNo, ph.levelIds ?? null) : null;
                const totalBWVol = events ? events.reduce((s, e) => s + (e.washQty ?? 0), 0) : 0;
                return (
                  <div key={ph.id} className="shrink-0 border border-earth-border rounded-md overflow-hidden bg-earth-DEFAULT">
                    {/* Phase header stripe */}
                    <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: '#1a2b3c' }}>
                      <span className="font-black text-sm tracking-wide" style={{ color: '#38bdf8' }}>{ph.id}</span>
                      <span className="text-xs font-medium" style={{ color: 'rgba(148,163,184,0.7)' }}>{ph.src}</span>
                      <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }} />
                      <span className="text-xs" style={{ color: 'rgba(148,163,184,0.6)' }}>{ph.totalBeds} beds</span>
                      {events && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: 'rgba(14,165,233,0.18)', color: '#38bdf8' }}>
                          ↻ {events.length} BW
                        </span>
                      )}
                      {events && totalBWVol > 0 && (
                        <span className="ml-auto text-xs tabular-nums" style={{ color: 'rgba(148,163,184,0.6)' }}>
                          Total BW{' '}
                          <span className="font-bold" style={{ color: '#38bdf8' }}>
                            {totalBWVol.toLocaleString('en-US', { maximumFractionDigits: 0 })} m³
                          </span>
                        </span>
                      )}
                      {events && events.length === 0 && (
                        <span className="ml-auto text-xs italic" style={{ color: 'rgba(148,163,184,0.5)' }}>ไม่มีการล้างบ่อกรอง</span>
                      )}
                    </div>
                    {/* One card per wash event */}
                    <div className={events && events.length > 6
                      ? 'grid grid-cols-6 gap-1.5 px-2.5 py-2 overflow-y-auto'
                      : 'flex gap-1.5 px-2.5 py-2 overflow-x-auto'}
                         style={events && events.length > 6 ? { maxHeight: '260px' } : { minHeight: '72px' }}>
                      {!events && !querying && (
                        <span className="text-xs text-slate-400 italic self-center">กด QUERY เพื่อโหลดข้อมูล</span>
                      )}
                      {events && events.length === 0 && (
                        <span className="text-xs text-slate-400 italic self-center">ไม่มีการล้างบ่อกรองในวันนี้</span>
                      )}
                      {events && events.map((ev, idx) => {
                        const cardBg     = ev.complete ? '#d1fae5' : '#fee2e2';
                        const cardBorder = ev.complete ? '#6ee7b7' : '#fca5a5';
                        const accentBar  = ev.complete ? '#10b981' : '#ef4444';
                        const badgeBg    = ev.complete ? 'rgba(16,185,129,0.15)'  : 'rgba(239,68,68,0.15)';
                        const badgeColor = ev.complete ? '#065f46' : '#991b1b';
                        return (
                          <div key={`${ev.no}-${ev.slot}-${idx}`}
                               className="flex-shrink-0 rounded overflow-hidden cursor-pointer hover:brightness-95 transition-[filter]"
                               style={{ minWidth: '96px', maxWidth: '96px', background: cardBg, border: `1px solid ${cardBorder}` }}
                               onClick={() => navigate(`/op-record?station=${ph.station}&date=${selectedDate}&topic=${encodeURIComponent(ph.topic)}&focus=${ev.byShiftId}`)}>
                            <div style={{ height: '3px', background: accentBar }} />
                            <div className="flex items-center justify-between px-1.5 py-1"
                                 style={{ borderBottom: `1px solid ${cardBorder}` }}>
                              <span className="text-xs font-bold text-slate-800">No.{ev.no}</span>
                              <span className="text-[10px] font-semibold rounded px-1 py-0.5"
                                    style={{ background: badgeBg, color: badgeColor }}>
                                {ev.shift != null ? `Shift ${ev.shift}` : ev.slot}
                              </span>
                            </div>
                            <div className="px-1.5 py-1.5 flex flex-col gap-1">
                              <div className="flex justify-between items-baseline">
                                <span className="text-[10px] uppercase tracking-wide text-slate-500">Runtime</span>
                                <span className="text-sm font-bold tabular-nums text-slate-800">
                                  {ev.filterRun != null ? ev.filterRun.toFixed(1) : '—'}
                                  <span className="text-[10px] font-normal text-slate-400 ml-0.5">h</span>
                                </span>
                              </div>
                              <div className="flex justify-between items-baseline">
                                <span className="text-[10px] uppercase tracking-wide text-slate-500">BW Vol</span>
                                <span className="text-sm font-bold tabular-nums text-slate-800">
                                  {ev.washQty != null ? ev.washQty.toFixed(0) : '—'}
                                  <span className="text-[10px] font-normal text-slate-400 ml-0.5">m³</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Login overlay (shown on stage 2→1 to refresh token) ─────────────────────

function LoginOverlay({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await post('/api/auth/login', { username, password });
      await onSuccess();
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-earth-DEFAULT rounded-2xl shadow-2xl w-full max-w-sm p-8 animate-fadeSlideUp">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔄</div>
          <h2 className="text-xl font-bold text-brand">ต่ออายุ Session</h2>
          <p className="text-earth-ink2 text-sm mt-1">Aquadat กลับมาแล้ว — กรุณา Login เพื่อ refresh token</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-earth-ink mb-1">AD Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-earth-border rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-ink mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-earth-border rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="••••••••"
              required
            />
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand hover:bg-sky-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function OpRecord() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const initStation = searchParams.get('station') ?? 'RWS1';
  const urlTopic    = searchParams.get('topic');
  const urlFocus    = searchParams.get('focus');
  const [activeStation, setActiveStation] = useState(
    ACTIVE_STATIONS.has(initStation) ? initStation : 'RWS1'
  );
  // Sync station from URL when navigating programmatically (e.g., card click from Daily Report)
  useEffect(() => {
    const s = searchParams.get('station');
    if (s && ACTIVE_STATIONS.has(s)) setActiveStation(s);
  }, [searchParams]); // eslint-disable-line
  const [selectedDate, setSelectedDate] = useState(() => initRefDate(searchParams.get('date')));
  const [activeTopic, setActiveTopic]     = useState(null);
  const [history, setHistory]             = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [stage, setStage]                 = useState(1);
  const [showLoginOverlay, setShowLoginOverlay] = useState(false);
  const prevStageRef = useRef(1);
  const hadNonNormalStageRef = useRef(false);
  const [dirtyValues, setDirtyValues]     = useState({});
  const [submitStatus, setSubmitStatus]   = useState({});
  const [pendingStationSwitch, setPendingStationSwitch] = useState(null);
  const [widgets, setWidgets]                   = useState([]);
  const [widgetLayout, setWidgetLayout]         = useState([]);
  const [showPicker, setShowPicker]             = useState(false);
  const [configuringWidget, setConfiguringWidget] = useState(null);
  const [canvasWidth, setCanvasWidth]           = useState(400);
  const [canvasHeight, setCanvasHeight]         = useState(400);
  const [validationResult, setValidationResult] = useState(null);
  const [validating, setValidating]             = useState(false);
  const [rightPanel, setRightPanel]             = useState('dashboard'); // 'dashboard' | 'validate'

  const canvasRef  = useRef(null);
  const layoutTimer = useRef(null);

  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  const isRetroactive = selectedDate < today;

  // Measure widget canvas size for GridLayout
  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 10) setCanvasWidth(width);
      if (height > 10) setCanvasHeight(height);
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const { data: stationNode } = useQuery({
    queryKey: ['op-node', activeStation],
    queryFn: () => get(`/api/operator/nodes?station_id=${encodeURIComponent(activeStation)}`),
    staleTime: 300000,
    enabled: !!activeStation,
  });

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });
  const canRecord = !(me?.bypass) || isSuperadmin(me);
  const loginId   = me?.username ?? me?.name ?? me?.user_id ?? 'default';

  const stationDef = stationNode?.station ?? null;

  // Reset to null on station change; stationDef effect below will set first topic once it loads
  useEffect(() => {
    setActiveTopic(null);
  }, [activeStation]); // eslint-disable-line

  // When stationDef arrives or changes reference (e.g. React Query background refetch),
  // keep the current activeTopic if it is still valid for this station — only reset if not.
  useEffect(() => {
    if (!stationDef) return;
    setActiveTopic(prev => {
      if (prev && stationDef.topics?.some(t => t.topic === prev)) return prev;
      if (urlTopic && stationDef.topics?.some(t => t.topic === urlTopic)) return urlTopic;
      return stationDef.topics?.[0]?.topic ?? null;
    });
  }, [stationDef]); // eslint-disable-line

  useEffect(() => {
    const doFetch = () => get('/api/operator/stage').then(d => {
      const s = d?.stage ?? 1;
      const prev = prevStageRef.current;

      // Side effects based on transition (must run outside setStage)
      if (s === 0 && selectedDate !== today) {
        handleDateChange(today);
      }
      if (prev !== 0 && s === 0) {
        qc.invalidateQueries({ queryKey: ['me'] });
      }
      if (s !== 1) {
        hadNonNormalStageRef.current = true;
      }
      if (s === 1 && hadNonNormalStageRef.current) {
        hadNonNormalStageRef.current = false;
        setShowLoginOverlay(true);
      }
      prevStageRef.current = s;
      setStage(s);
    }).catch(() => {});
    doFetch();
    const id = setInterval(doFetch, 30_000);
    return () => clearInterval(id);
  }, [selectedDate, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset history when station or date changes; show loading immediately so there's no blank flash
  useEffect(() => {
    setHistory({});
    setHistoryLoading(true);
  }, [activeStation, selectedDate]);

  // Always re-fetch when switching topics — data may have changed from other sources
  useEffect(() => {
    if (!activeStation || !activeTopic) return;

    const controller = new AbortController();
    setHistoryLoading(true);
    const qs = new URLSearchParams({ station_id: activeStation, date: selectedDate, topic: activeTopic });
    get(`/api/operator/history?${qs}`, { signal: controller.signal })
      .then(data => {
        if (data && typeof data === 'object') {
          setHistory(prev => ({ ...prev, ...data }));
        }
      })
      .catch(e => { if (e?.name !== 'AbortError') console.warn('[history]', activeStation, activeTopic, e.message); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [activeStation, activeTopic, selectedDate]);


  useEffect(() => {
    if (!loginId || !activeStation) return;
    get(`/api/operator/widgets?login_id=${encodeURIComponent(loginId)}&station_id=${activeStation}`)
      .then(d => {
        const ws = d?.widgets || [];
        setWidgets(ws);
        setWidgetLayout(ws.map(w => ({ i: String(w.id), x: w.x, y: w.y, w: w.w, h: w.h, minW: 1, minH: 2 })));
      })
      .catch(() => setWidgets([]));
  }, [loginId, activeStation]);

  function handleStationChange(id) {
    if (!ACTIVE_STATIONS.has(id)) return;
    if (id === activeStation) return;
    const hasPending = activeStation !== 'DAILY' && stationDef?.topics?.some(t => {
      const d = dirtyValues[t.topic] || {};
      return Object.values(d).some(sm => sm && Object.values(sm).some(v => v !== ''));
    });
    if (hasPending) { setPendingStationSwitch(id); return; }
    doStationChange(id);
  }

  function doStationChange(id) {
    setActiveStation(id);
    setDirtyValues({});
    setSubmitStatus({});
    setValidationResult(null);
    navigate(`/op-record?station=${id}`, { replace: true });
  }

  async function handleSwitchWithSubmit() {
    const targetId = pendingStationSwitch;
    setPendingStationSwitch(null);
    const pendingTopics = (stationDef?.topics ?? []).filter(t => {
      const d = dirtyValues[t.topic] || {};
      return Object.values(d).some(sm => sm && Object.values(sm).some(v => v !== ''));
    });
    for (const t of pendingTopics) {
      await handleSubmitTopic(t.topic);
    }
    doStationChange(targetId);
  }

  function handleSwitchWithDiscard() {
    const targetId = pendingStationSwitch;
    setPendingStationSwitch(null);
    doStationChange(targetId);
  }

  async function handleValidate() {
    if (!activeStation || activeStation === 'DAILY') return;
    setValidating(true);
    setRightPanel('validate');
    try {
      const result = await post('/api/operator/validate', {
        station_id: activeStation,
        date: selectedDate,
        data: liveHistory,
      });
      setValidationResult(result);
    } catch (e) {
      setValidationResult({ error: e.message });
    } finally {
      setValidating(false);
    }
  }

  function handleDateChange(newDate) {
    setSelectedDate(newDate);
    setRefDate(newDate);
    setDirtyValues({});
    setSubmitStatus({});
  }

  function handleCellChange(topicName, configparam_id, slot, value) {
    setSubmitStatus(prev => { const n = { ...prev }; delete n[topicName]; return n; });
    setDirtyValues(prev => {
      const topicDirty = { ...(prev[topicName] || {}) };
      const slotMap = { ...(topicDirty[configparam_id] || {}) };
      if (value === undefined) { delete slotMap[slot]; }
      else { slotMap[slot] = value; }
      topicDirty[configparam_id] = slotMap;
      return { ...prev, [topicName]: topicDirty };
    });
  }

  async function handleSubmitTopic(topicName) {
    if (!canRecord) return;
    if (stage === 2) {
      setSubmitStatus(prev => ({ ...prev, [topicName]: 'error' }));
      return;
    }
    const dirty = dirtyValues[topicName] || {};
    const records = [];
    for (const [cpid, slotMap] of Object.entries(dirty)) {
      for (const [slot, value] of Object.entries(slotMap)) {
        if (value !== '') records.push({
          configparam_id: parseInt(cpid),
          trans_dtm: selectedDate,
          trans_time: slot,
          trans_value: String(value),
          trans_type: stationDef?.trans_type ?? '',
          plant_id: stationDef?.plant_id ?? 1,
        });
      }
    }
    if (!records.length) return;
    if (!confirmNonToday(selectedDate)) return;
    setSubmitStatus(prev => ({ ...prev, [topicName]: 'sending' }));
    try {
      await post('/api/operator/record', { records, station_id: activeStation });
      // Merge submitted records into history (source of truth)
      setHistory(prev => {
        const next = { ...prev };
        records.forEach(r => { next[r.configparam_id] = { ...(next[r.configparam_id] || {}), [r.trans_time]: r.trans_value }; });
        return next;
      });
      // Clear dirty for this topic — table will read from history now
      setDirtyValues(prev => { const n = { ...prev }; delete n[topicName]; return n; });
      setSubmitStatus(prev => ({ ...prev, [topicName]: 'success' }));
      setTimeout(() => setSubmitStatus(prev => { const n = { ...prev }; delete n[topicName]; return n; }), 3000);
    } catch (e) {
      console.error('Submit failed', e);
      setSubmitStatus(prev => ({ ...prev, [topicName]: 'error' }));
    }
  }

  async function handleAddWidget(catalogItem) {
    try {
      const data = await post('/api/operator/widgets', {
        login_id: loginId, station_id: activeStation,
        widget_type: catalogItem.type,
        x: 0, y: 0, w: catalogItem.dW, h: catalogItem.dH, config: {},
      });
      if (data?.widget) {
        const w = data.widget;
        setWidgets(prev => [...prev, w]);
        setWidgetLayout(prev => [...prev, { i: String(w.id), x: w.x, y: w.y, w: w.w, h: w.h, minW: 1, minH: 2 }]);
      }
    } catch (e) { console.error('Add widget failed', e); }
  }

  async function handleSaveWidgetConfig(newConfig) {
    if (!configuringWidget) return;
    const id = configuringWidget.id;
    try {
      await apiPut(`/api/operator/widgets/${id}`, { config: newConfig });
      setWidgets(prev => prev.map(w => w.id === id ? { ...w, config: newConfig } : w));
    } catch (e) {
      console.error('Config save failed', e);
    } finally {
      setConfiguringWidget(null);
    }
  }

  async function handleRemoveWidget(widgetId) {
    try {
      await del(`/api/operator/widgets/${widgetId}`);
      setWidgets(prev => prev.filter(w => w.id !== widgetId));
      setWidgetLayout(prev => prev.filter(l => l.i !== String(widgetId)));
    } catch (e) { console.error('Remove widget failed', e); }
  }

  function handleWidgetLayoutChange(newLayout) {
    setWidgetLayout(newLayout);
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(() => {
      newLayout.forEach(item => {
        apiPut(`/api/operator/widgets/${item.i}`, { x: item.x, y: item.y, w: item.w, h: item.h }).catch(() => {});
      });
    }, 800);
  }

  const currentTopic = stationDef?.topics?.find(t => t.topic === activeTopic) ?? null;
  const activeTabMeta = STATION_TABS.find(t => t.id === activeStation);

  // Merge dirty values into history so widgets reflect live input immediately
  const liveHistory = useMemo(() => {
    const merged = { ...history };
    for (const topicDirty of Object.values(dirtyValues)) {
      for (const [cpid, slotMap] of Object.entries(topicDirty)) {
        merged[cpid] = { ...(merged[cpid] || {}), ...slotMap };
      }
    }
    return merged;
  }, [history, dirtyValues]);

  // Dynamic rowHeight so widgets always fill the canvas height proportionally
  const dynamicRowHeight = useMemo(() => {
    if (widgetLayout.length === 0) return 60;
    const maxRow = Math.max(...widgetLayout.map(l => l.y + l.h));
    return Math.max(40, Math.floor(canvasHeight / maxRow));
  }, [widgetLayout, canvasHeight]);

  return (
    <div className="w-full h-full flex flex-col gap-3">
      {showLoginOverlay && (
        <LoginOverlay onSuccess={async () => {
          await qc.invalidateQueries({ queryKey: ['me'] });
          setShowLoginOverlay(false);
        }} />
      )}
      {pendingStationSwitch && stationDef && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-earth-DEFAULT rounded-2xl shadow-2xl w-[440px] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-earth-border">
              <p className="font-bold text-earth-ink text-base">ต้องการส่งข้อมูลหรือไม่</p>
              <p className="text-sm text-earth-ink2 mt-0.5">
                {STATION_TABS.find(t => t.id === activeStation)?.label} มีข้อมูลที่ยังไม่ได้ส่ง
              </p>
            </div>
            <div className="px-5 py-3 space-y-2">
              {stationDef.topics
                .filter(t => {
                  const d = dirtyValues[t.topic] || {};
                  return Object.values(d).some(sm => sm && Object.values(sm).some(v => v !== ''));
                })
                .map(t => {
                  const cellCount = Object.values(dirtyValues[t.topic] || {})
                    .reduce((acc, sm) => acc + Object.values(sm).filter(v => v !== '').length, 0);
                  const tc = TOPIC_COLORS[t.topic] ?? DEFAULT_TOPIC_COLOR;
                  return (
                    <div key={t.topic} className="flex items-center justify-between px-3 py-2 rounded-lg bg-earth-DEFAULT border border-earth-border">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tc.tag}`}>{t.topic}</span>
                      <span className="text-xs text-earth-ink2">{cellCount} ช่อง</span>
                    </div>
                  );
                })
              }
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-earth-border">
              <button
                onClick={handleSwitchWithDiscard}
                className="px-4 py-2 rounded-lg text-sm text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
              >ยกเลิกและลบการเปลี่ยนแปลง</button>
              <button
                onClick={handleSwitchWithSubmit}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >ส่งข้อมูล</button>
            </div>
          </div>
        </div>
      )}
      {stage === 0 && (
        <div className="bg-red-700 text-white text-sm px-4 py-1.5 rounded-lg flex items-center gap-2 shrink-0">
          <span>⚠️</span> Offline Mode — บันทึกข้อมูลลง Uroboros (จะ sync อัตโนมัติเมื่อ Aquadat กลับมา)
        </div>
      )}
      {stage === 2 && (
        <div className="bg-amber-600 text-white text-sm px-4 py-1.5 rounded-lg flex items-center gap-2 shrink-0">
          <span>🔄</span> กำลัง sync ข้อมูลกับ Aquadat — ไม่สามารถบันทึกได้ชั่วคราว
        </div>
      )}
      {/* Top bar — title | tabs (center) | date */}
      <div className="flex items-center gap-3 shrink-0 bg-earth-DEFAULT rounded-xl shadow-sm border border-earth-border px-3 py-2">
        {/* Left: title */}
        <h1 className="text-2xl font-bold text-earth-ink whitespace-nowrap shrink-0">
          บันทึก Operator
          {isRetroactive && <span className="ml-2 text-sm font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">ย้อนหลัง</span>}
          {!canRecord && <span className="ml-2 text-sm font-normal text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Bypass Mode</span>}
        </h1>

        {/* Center: station tabs */}
        <div className="flex-1 flex items-center justify-center gap-1.5 flex-wrap">
          {STATION_TABS.map(tab => {
            const isActive = activeStation === tab.id;
            const isAvail  = ACTIVE_STATIONS.has(tab.id);
            return (
              <button
                key={tab.id}
                onClick={() => handleStationChange(tab.id)}
                disabled={!isAvail}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors
                  ${isActive ? `${tab.color} text-white border-transparent` : isAvail ? 'bg-earth-DEFAULT text-earth-ink border-earth-border hover:border-earth-border' : 'bg-earth-DEFAULT text-earth-ink3 border-earth-border cursor-not-allowed'}`}
              >
                {tab.label}
                {!isAvail && <span className="ml-1 text-xs opacity-60">เร็วๆ นี้</span>}
              </button>
            );
          })}
          {activeStation !== 'DAILY' && (
            <button
              onClick={() => setShowPicker(p => !p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors shrink-0
                ${showPicker ? `${activeTabMeta?.color ?? 'bg-gray-700'} text-white border-transparent` : 'bg-earth-DEFAULT text-earth-ink2 border-earth-border hover:border-earth-border'}`}
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
              </svg>
              Layout
            </button>
          )}
        </div>

        {/* Right: date */}
        <div className="shrink-0 flex items-center gap-2">
          {stage === 0 && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-400 rounded px-2 py-0.5">
              Offline — Today Only
            </span>
          )}
          <DateSyncBar
            date={selectedDate}
            onDateChange={stage === 0 ? undefined : handleDateChange}
            maxDate={today}
            hideSync
            disabled={stage === 0}
          />
        </div>
      </div>

      {/* Sub-group toggle row */}
      {activeStation !== 'DAILY' && stationDef?.topics?.length > 0 && (
        <div className="flex flex-wrap gap-2 shrink-0 px-1">
          {stationDef.topics.map(t => {
            const isOn = activeTopic === t.topic;
            const tc   = TOPIC_COLORS[t.topic] ?? DEFAULT_TOPIC_COLOR;
            return (
              <button
                key={t.topic}
                onMouseDown={e => e.preventDefault()}
                onClick={() => setActiveTopic(t.topic)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all
                  ${isOn ? `${tc.header} border-transparent shadow-md scale-105` : 'bg-earth-DEFAULT text-earth-ink2 border-earth-border hover:border-earth-border'}`}
              >
                <span className={`inline-flex items-center w-8 h-4.5 rounded-full relative transition-colors ${isOn ? 'bg-white/30' : 'bg-gray-200'}`}
                  style={{ width: 30, height: 17, display: 'inline-flex', alignItems: 'center' }}>
                  <span className={`absolute w-3.5 h-3.5 rounded-full shadow transition-all ${isOn ? 'bg-white translate-x-3.5' : 'bg-gray-400 translate-x-0.5'}`} style={{ width: 13, height: 13 }} />
                </span>
                {t.topic}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${isOn ? 'bg-white/20 text-white' : tc.tag}`}>{t.params.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Body — Daily Report tab gets full area */}
      {activeStation === 'DAILY' && (
        <div className="flex-1 min-h-0 rounded-xl shadow-sm border border-earth-border overflow-hidden">
          <DailyReportTab selectedDate={selectedDate} stage={stage} />
        </div>
      )}

      {/* Body 70:30 — station recording tabs */}
      {activeStation !== 'DAILY' && !stationDef ? (
        <div className="text-center py-12 text-earth-ink3">
          {!ACTIVE_STATIONS.has(activeStation) ? 'เร็วๆ นี้' : 'กำลังโหลด...'}
        </div>
      ) : activeStation !== 'DAILY' && (
        <div className="flex gap-3 flex-1 min-h-0">
          {/* 70% — recording */}
          <div className="flex-[7] min-w-0 min-h-0 flex flex-col rounded-xl shadow-sm border border-earth-border overflow-hidden relative">
            {currentTopic ? (
              <RecordingTable
                topic={currentTopic}
                history={history}
                allHistory={liveHistory}
                dirtyValues={dirtyValues}
                onCellChange={handleCellChange}
                cellMarks={validationResult?.cellMarks}
                focusId={urlFocus}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-earth-ink3">เลือก sub-group ด้านบน</div>
            )}
            {historyLoading && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 z-10">
                <svg className="w-7 h-7 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
                <span className="text-sm text-blue-600 font-medium">กำลังโหลดข้อมูลจาก Aquadat…</span>
              </div>
            )}
          </div>

          {/* 30% — widget canvas / validation panel */}
          <div className="flex-[3] min-w-0 min-h-0 flex flex-col rounded-xl shadow-sm border border-earth-border bg-earth-DEFAULT overflow-hidden relative">
            <div className="px-3 py-2 border-b border-earth-border bg-earth-card shrink-0 flex items-center justify-between gap-2">
              {/* Tab toggle */}
              <div className="flex rounded-lg overflow-hidden border border-earth-border text-xs font-semibold shrink-0">
                <button
                  onClick={() => setRightPanel('dashboard')}
                  className={`px-2.5 py-1 transition-colors ${rightPanel === 'dashboard' ? 'bg-slate-700 text-white' : 'text-earth-ink2 hover:bg-earth-DEFAULT'}`}
                >Dashboard</button>
                <button
                  onClick={() => setRightPanel('validate')}
                  className={`px-2.5 py-1 transition-colors flex items-center gap-1 ${rightPanel === 'validate' ? 'bg-slate-700 text-white' : 'text-earth-ink2 hover:bg-earth-DEFAULT'}`}
                >
                  Validate
                  {validationResult && !validationResult.error && (
                    <span className={`text-[10px] font-bold ${validationResult.summary?.errors > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {validationResult.summary?.errors > 0 ? `✗${validationResult.summary.errors}` : '✓'}
                    </span>
                  )}
                </button>
              </div>
              {rightPanel === 'dashboard' ? (
                <button onClick={() => setShowPicker(p => !p)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  + เพิ่ม Widget
                </button>
              ) : (
                <button
                  onClick={handleValidate}
                  disabled={validating}
                  className="text-xs bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold px-2.5 py-1 rounded-lg transition-colors"
                >
                  {validating ? '...' : '▶ Run'}
                </button>
              )}
            </div>

            {/* Validation panel */}
            {rightPanel === 'validate' && (
              <ValidationPanel
                result={validationResult}
                loading={validating}
                stationId={activeStation}
              />
            )}

            <div ref={canvasRef} className={`flex-1 overflow-auto ${rightPanel !== 'dashboard' ? 'hidden' : ''}`}>
              {widgets.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-earth-ink3 gap-2 p-4">
                  <svg className="w-8 h-8 opacity-30" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                    <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
                  </svg>
                  <p className="text-xs text-center">กด <strong>Layout</strong> หรือ <strong>+ เพิ่ม Widget</strong><br/>เพื่อเพิ่ม widget</p>
                </div>
              ) : (
                canvasWidth > 10 && (
                  <GridLayout
                    width={canvasWidth}
                    cols={6}
                    rowHeight={dynamicRowHeight}
                    layout={widgetLayout}
                    onLayoutChange={handleWidgetLayoutChange}
                    draggableHandle=".drag-handle"
                    draggableCancel=".no-drag"
                    margin={[6, 6]}
                    containerPadding={[6, 6]}
                    resizeHandles={['se', 'sw', 'ne', 'nw']}
                  >
                    {widgets.map(w => (
                      <div key={String(w.id)} style={{ height: '100%' }}>
                        <WidgetCard
                          widget={w}
                          history={liveHistory}
                          stationDef={stationDef}
                          onRemove={handleRemoveWidget}
                          onConfigure={setConfiguringWidget}
                        />
                      </div>
                    ))}
                  </GridLayout>
                )
              )}
            </div>

            <WidgetPicker open={showPicker} onClose={() => setShowPicker(false)} onAdd={handleAddWidget} />
          </div>
        </div>
      )}

      {/* Submission module — separate from recording table */}
      {activeStation !== 'DAILY' && stationDef && (
        <SubmissionPanel
          stationDef={stationDef}
          dirtyValues={dirtyValues}
          submitStatus={submitStatus}
          onSubmitTopic={handleSubmitTopic}
          canRecord={canRecord}
        />
      )}

      {/* Widget config modal */}
      {activeStation !== 'DAILY' && configuringWidget && stationDef && (
        <WidgetConfigModal
          widget={configuringWidget}
          stationDef={stationDef}
          onSave={handleSaveWidgetConfig}
          onClose={() => setConfiguringWidget(null)}
        />
      )}
    </div>
  );
}

// PUT helper (not in api.js)
async function apiPut(url, body) {
  const BASE = import.meta.env.PROD ? '/labventure' : '';
  const res  = await fetch(`${BASE}${url}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${url} → ${res.status}`);
  return res.json();
}
