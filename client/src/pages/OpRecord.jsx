import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GridLayout } from 'react-grid-layout';
import { get, post, patch, del } from '../api.js';
import { getRefDate, setRefDate } from '../utils/refDate.js';
import DateSyncBar from '../components/DateSyncBar.jsx';
import MiniChartCard from '../components/MiniChart.jsx';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ResponsiveSankey } from '@nivo/sankey';
import { PieChart, Pie, Cell } from 'recharts';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// ── Constants ────────────────────────────────────────────────────────────────

// Reference slot arrays for heatmap display (hourly reference grid)
const SLOTS_2H = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');
const SLOTS_1H = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');

function topicSlots(topic) {
  if (Array.isArray(topic?.time_slots)) return topic.time_slots;
  const count = topic?.time_slot;
  if (count === 13) return Array.from({ length: 13 }, (_, i) => String(i * 2).padStart(2, '0') + ':00');
  if (count === 25) return Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');
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
  'Other':         { header: 'bg-gray-600 text-white',    border: 'border-gray-300',    tag: 'bg-gray-100 text-gray-700'       },
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
  'other':                   { header: 'bg-gray-600 text-white',    border: 'border-gray-300',    tag: 'bg-gray-100 text-gray-700'       },
};
const DEFAULT_TOPIC_COLOR = { header: 'bg-gray-700 text-white', border: 'border-gray-300', tag: 'bg-gray-100 text-gray-700' };

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
              <th className="px-1 pb-1 text-gray-400 font-normal text-left text-[11px]">Topic</th>
              {SLOTS_2H.map(s => <th key={s} className="px-0.5 text-gray-400 font-normal text-[10px]">{s.replace(':00','')}</th>)}
            </tr>
          </thead>
          <tbody>
            {topics.map(t => {
              const tSlots = topicSlots(t);
              return (
                <tr key={t.topic}>
                  <td className="pr-2 text-gray-600 font-medium whitespace-nowrap text-[11px]">{t.topic}</td>
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
            <div key={pump} className={`rounded-lg px-2 py-1 text-xs font-semibold border ${isOn ? 'bg-green-100 border-green-300 text-green-800' : st == null ? 'bg-gray-100 border-gray-200 text-gray-400' : 'bg-red-100 border-red-200 text-red-700'}`}>
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
        <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-gray-400">Basin Level</div>
      </div>
    );
  }

  const meta = WIDGET_CATALOG.find(c => c.type === widget_type);
  return <Empty icon={meta?.icon || '📦'}>{meta?.label} — coming soon</Empty>;
}

function Empty({ icon, children }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-1 p-4 text-center">
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
    <div className="h-full flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="drag-handle flex items-center justify-between px-2 py-1.5 bg-gray-800 text-white shrink-0 cursor-grab select-none">
        <span className="text-xs font-semibold flex items-center gap-1.5">{meta?.icon} {meta?.label}</span>
        <div className="flex items-center gap-1 no-drag">
          {configurable && (
            <button
              onClick={() => onConfigure(widget)}
              className="text-gray-400 hover:text-white text-xs px-1.5 py-0.5 rounded transition-colors"
              title="ตั้งค่า parameter"
            >⚙️</button>
          )}
          <button onClick={() => onRemove(widget.id)} className="text-gray-400 hover:text-white text-sm px-1 leading-none">✕</button>
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
        className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-xl">{meta?.icon}</span>
            <div>
              <p className="font-bold text-gray-900 text-sm">ตั้งค่า {meta?.label}</p>
              <p className="text-xs text-gray-400">เลือก topic และ parameter ที่ต้องการแสดง</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Step 1 — Topic */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">① Topic</p>
            <div className="flex flex-wrap gap-2">
              {stationDef?.topics?.map(t => {
                const tc  = TOPIC_COLORS[t.topic] ?? DEFAULT_TOPIC_COLOR;
                const on  = selTopic === t.topic;
                return (
                  <button
                    key={t.topic}
                    onClick={() => handleTopicChange(t.topic)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-all
                      ${on ? `${tc.header} border-transparent shadow-sm` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
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
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">② Parameter</p>
              <div className="border border-gray-100 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                {paramList.map((p, i) => {
                  const on = selParam === p.configparam_id;
                  return (
                    <button
                      key={p.configparam_id}
                      onClick={() => setSelParam(p.configparam_id)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors
                        ${i > 0 ? 'border-t border-gray-50' : ''}
                        ${on ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'}`}
                    >
                      <div>
                        <span className="text-sm font-semibold text-gray-800">{p.equipment_name}</span>
                        <span className="text-sm text-gray-500 ml-2">{p.param_name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.unit && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{p.unit}</span>}
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
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">③ Range (ตัวเลือก)</p>
              <div className="flex gap-3">
                <label className="flex-1">
                  <span className="text-xs text-gray-400 block mb-1">Min</span>
                  <input type="number" step="any" value={rangeMin} onChange={e => setRangeMin(e.target.value)}
                    placeholder="auto" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </label>
                <label className="flex-1">
                  <span className="text-xs text-gray-400 block mb-1">Max</span>
                  <input type="number" step="any" value={rangeMax} onChange={e => setRangeMax(e.target.value)}
                    placeholder="auto" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
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
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 mt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 border border-gray-200 hover:border-gray-400 transition-colors">
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
      <div className="w-72 bg-white border-l border-gray-200 shadow-2xl h-full overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <span className="font-bold text-gray-800">เพิ่ม Widget</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 p-3 space-y-2">
          {WIDGET_CATALOG.map(wt => (
            <button
              key={wt.type}
              onClick={() => { onAdd(wt); onClose(); }}
              className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-colors"
            >
              <span className="text-2xl shrink-0 mt-0.5">{wt.icon}</span>
              <div>
                <div className="text-sm font-semibold text-gray-800">{wt.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{wt.desc}</div>
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

// ── Recording table — Excel-like navigation + copy/paste series ───────────────

function computeFormula(formulaStr, slot, allHistory) {
  try {
    const expr = formulaStr.replace(/\{(\d+)\}/g, (_, cid) => {
      const v = allHistory[cid]?.[slot];
      return (v !== undefined && v !== '') ? parseFloat(v) : 0;
    });
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${expr})`)();
    if (!isFinite(result)) return '';
    return parseFloat(result.toFixed(4));
  } catch {
    return '';
  }
}

function RecordingTable({ topic, history, allHistory, dirtyValues, onCellChange }) {
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

  // Reset to cell (0,0) and focus table whenever the sub-tab (topic) changes
  useEffect(() => {
    setSelCell({ si: 0, pi: 0 });
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
    if (p.formula) return computeFormula(p.formula, slot, allHistory || history);
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
    if (t === 'INT') return String(Math.round(num));
    const m = t.match(/^FLOAT\((\d+)\)$/);
    if (m) return num.toFixed(parseInt(m[1], 10));
    return val;
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
        className="flex-1 overflow-auto bg-white focus:outline-none"
      >
        <table className="text-xs border-collapse w-max">
          <thead className="sticky top-0 z-10">
            {/* Date / topic row */}
            <tr>
              <th className="border border-gray-300 bg-[#1a3a5c] text-white font-bold px-2 py-1 text-center whitespace-nowrap sticky left-0 z-20 text-xs">
                Time (Hour)
              </th>
              <th colSpan={params.length} className="border border-gray-300 bg-[#1a3a5c] text-white font-bold px-3 py-1 text-left text-xs">
                {topic.topic}
              </th>
            </tr>
            {/* Column header row */}
            <tr>
              <th className="border border-gray-300 bg-[#1a3a5c] text-white font-bold px-2 py-1 text-center whitespace-nowrap sticky left-0 z-20 text-[11px]">
                เวลา
              </th>
              {params.map(p => (
                <th key={p.configparam_id} className={[
                  'border border-gray-300 whitespace-nowrap text-center leading-snug px-2 py-1',
                  p.formula ? 'bg-[#b3d1f0]' : p.readonly ? 'bg-[#d0d8e4]' : 'bg-[#bdd7ee]',
                  'text-gray-900',
                ].join(' ')}>
                  <div className="font-bold text-[11px]">{p.equipment_name}</div>
                  <div className="font-normal text-gray-600 text-[10px]">{p.param_name}{p.formula ? ' ƒ' : p.readonly ? ' ●' : ''}</div>
                  {p.unit && <div className="text-gray-400 text-[10px]">({p.unit})</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, si) => (
              <tr key={slot} className="bg-white">
                <td className="px-2 py-0 border border-gray-300 font-bold text-white whitespace-nowrap sticky left-0 bg-[#1a3a5c] text-xs text-center w-16">
                  {slot}
                </td>
                {params.map((p, pi) => {
                  const isFormula  = !!p.formula;
                  const isReadonly = !!(p.readonly || isFormula);
                  const val        = isFormula
                    ? getDisplayVal(p, slot)
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
                        'border border-gray-300 relative p-0 h-7',
                        isEdit && opts ? 'overflow-visible z-50' : 'overflow-hidden',
                        isFormula  ? 'bg-[#ddeeff]' : '',
                        isReadonly && !isFormula ? 'bg-gray-50' : '',
                        isRng && !isSel && !isReadonly ? 'bg-blue-50' : '',
                        isDirty && !isEdit ? 'bg-amber-50' : '',
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
                              className="absolute top-0 left-0 text-xs focus:outline-none bg-white border border-blue-500 shadow-lg cursor-pointer"
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
                          isFormula ? 'text-blue-800 font-medium' : '',
                          isDirty ? 'font-semibold text-amber-800' : (isFormula ? '' : 'text-gray-800'),
                          val === '' ? 'text-gray-300' : '',
                        ].join(' ')}>
                          <span className="flex-1 text-center">{val !== '' ? formatDisplayVal(val, p.type) : '—'}</span>
                          {opts && (
                            <span
                              className="shrink-0 pr-0.5 text-[9px] text-gray-400 cursor-pointer hover:text-gray-600 leading-none"
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
    <div className="shrink-0 bg-white border-t border-gray-200 shadow-inner px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">รอส่งข้อมูล</span>
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
              st === 'sending' ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-wait' :
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
      <span className="text-xs text-gray-400 ml-1">คลิก topic เพื่อส่งข้อมูล</span>
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

const SANKEY_DATA = {
  nodes: [
    { id: 'Raw Water' },
    { id: 'TPS Water' },
    { id: 'DPS Water' },
    { id: 'Production' },
    { id: 'Service Water' },
    { id: 'CWT' },
    { id: 'Loss' },
    { id: 'Filter BW' },
    { id: 'Sludge' },
  ],
  links: [
    { source: 'Raw Water',   target: 'TPS Water',     value: 1507000 },
    { source: 'TPS Water',   target: 'DPS Water',     value: 890900  },
    { source: 'TPS Water',   target: 'Filter BW',     value: 8510    },
    { source: 'TPS Water',   target: 'Sludge',        value: 2985    },
    { source: 'DPS Water',   target: 'Production',    value: 1377100 },
    { source: 'DPS Water',   target: 'Service Water', value: 6564    },
    { source: 'DPS Water',   target: 'Loss',          value: 68000   },
    { source: 'Production',  target: 'CWT',           value: 1377100 },
  ],
};

const CHEM_DONUT_ROWS = [
  { col: 'left',  phase: 'PACl PHASE#1',    useUnit: 'TON', doseUnit: 'mg/L', use: 18.03, target: 15.00, actual: 14.45, pct: 96 },
  { col: 'right', phase: 'PRE-CL PHASE#1',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0.72,  target: 1.60,  actual: 1.65,  pct: 97 },
  { col: 'left',  phase: 'PACl PHASE#2',    useUnit: 'TON', doseUnit: 'mg/L', use: 12.33, target: 17.43, actual: 17.06, pct: 98 },
  { col: 'right', phase: 'PRE-CL PHASE#2',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0.42,  target: 1.60,  actual: 1.66,  pct: 96 },
  { col: 'left',  phase: 'PACl PHASE#3',    useUnit: 'TON', doseUnit: 'mg/L', use: 4.26,  target: 13.00, actual: 10.22, pct: 79 },
  { col: 'right', phase: 'PRE-CL PHASE#3',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0.54,  target: 1.20,  actual: 1.24,  pct: 97 },
  { col: 'left',  phase: 'PACl PHASE#4',    useUnit: 'TON', doseUnit: 'mg/L', use: 14.62, target: 13.83, actual: 13.47, pct: 97 },
  { col: 'right', phase: 'PRE-CL PHASE#4',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0.48,  target: 1.20,  actual: 1.25,  pct: 95 },
  { col: 'left',  phase: 'ALUM PHASE#1',    useUnit: 'TON', doseUnit: 'mg/L', use: 0.00,  target: null,  actual: 0.00,  pct: 0  },
  { col: 'right', phase: 'POST-CL PHASE#1', useUnit: 'kg',  doseUnit: 'mg/L', use: 0.70,  target: 1.55,  actual: 1.61,  pct: 96 },
  { col: 'left',  phase: 'ALUM PHASE#2',    useUnit: 'TON', doseUnit: 'mg/L', use: 0.00,  target: null,  actual: 0.00,  pct: 0  },
  { col: 'right', phase: 'POST-CL PHASE#2', useUnit: 'kg',  doseUnit: 'mg/L', use: 0.49,  target: 1.86,  actual: 1.93,  pct: 96 },
  { col: 'left',  phase: 'ALUM PHASE#3',    useUnit: 'TON', doseUnit: 'mg/L', use: 10.91, target: 22.00, actual: 18.75, pct: 85 },
  { col: 'right', phase: 'POST-CL PHASE#3', useUnit: 'kg',  doseUnit: 'mg/L', use: 0.54,  target: 1.20,  actual: 1.24,  pct: 97 },
  { col: 'left',  phase: 'ALUM PHASE#4',    useUnit: 'TON', doseUnit: 'mg/L', use: 0.00,  target: null,  actual: 0.00,  pct: 0  },
  { col: 'right', phase: 'POST-CL PHASE#4', useUnit: 'kg',  doseUnit: 'mg/L', use: 0.64,  target: 1.60,  actual: 1.67,  pct: 95 },
];

const DR_RIGHT_SUMMARY = [
  {
    title: 'สถานีสูบน้ำดิบ 1 และ 2',
    rows: [
      { label: 'เฟส 1', value: '437,000', unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 2', value: '253,000', unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 3', value: '437,000', unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 4', value: '380,000', unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณน้ำดิบรวม', value: '1,507,000', unit: 'ลบ.ม./วัน', bold: true },
    ],
  },
  {
    title: 'ระดับน้ำ',
    rows: [
      { label: 'ระดับน้ำ CWT 24:00', value: '2.50', unit: 'ม.' },
      { label: 'ระดับน้ำ CWT ต่ำสุด', value: '2.00', unit: 'ม.' },
      { label: 'ระดับน้ำ CWT สูงสุด', value: '3.91', unit: 'ม.' },
      { label: 'ระดับน้ำ RW ต่ำสุด',  value: '0.86', unit: 'ม.' },
      { label: 'ระดับน้ำ RW สูงสุด',  value: '0.91', unit: 'ม.' },
    ],
  },
  {
    title: 'สถานีสูบส่งและสูบจ่าย',
    rows: [
      { label: 'ปริมาณน้ำสูบจ่าย Line A', value: '314,600',   unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณน้ำสูบจ่าย Line B', value: '171,600',   unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณสูบส่ง',             value: '890,900',   unit: 'ลบ.ม./วัน' },
      { label: 'ปริมาณน้ำสูบส่ง+สูบจ่ายรวม', value: '1,377,100', unit: 'ลบ.ม./วัน', bold: true },
    ],
  },
  {
    title: 'แรงดัน',
    rows: [
      { label: 'แรงดันสถานีสูบจ่ายต่ำสุด', value: '8.20',  unit: 'ม.' },
      { label: 'แรงดันสถานีสูบจ่ายสูงสุด', value: '33.00', unit: 'ม.' },
      { label: 'แรงดันสถานีสูบส่งต่ำสุด',  value: '9.80',  unit: 'ม.' },
      { label: 'แรงดันสถานีสูบส่งสูงสุด',  value: '18.20', unit: 'ม.' },
    ],
  },
  {
    title: 'ปริมาณน้ำระบายตะกอน',
    rows: [
      { label: 'เฟส 1', value: '2,985', unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 2', value: '1,928', unit: 'ลบ.ม./วัน', highlight: true },
      { label: 'เฟส 3', value: '373',   unit: 'ลบ.ม./วัน' },
      { label: 'เฟส 4', value: '595',   unit: 'ลบ.ม./วัน' },
    ],
  },
  {
    title: 'การใช้ไฟฟ้า',
    rows: [
      { label: 'SS1A - DPS',  value: '45.28', unit: 'MWh' },
      { label: 'SS1B - TPS',  value: '60.12', unit: 'MWh', highlight: true },
      { label: 'SS3A - WS1',  value: '2.01',  unit: 'MWh' },
      { label: 'SS3B - WS2',  value: '2.03',  unit: 'MWh' },
      { label: 'SS2A - RW1',  value: '44.56', unit: 'MWh' },
      { label: 'SS2B - RW2',  value: '33.07', unit: 'MWh', highlightRed: true },
      { label: 'SS3 - Bldg.', value: '2.72',  unit: 'MWh' },
    ],
  },
];

// ── Shared DailyTableCardUI ──────────────────────────────────────────────────

function DailyTableCardUI({ title, rows, compact = false, grow = false }) {
  // grow mode: cells use px padding only; vertical space distributed by h-full on tr
  const cell = grow
    ? 'px-2 py-0'
    : compact ? 'px-1.5 py-px' : 'px-2 py-0.5';
  const sz = compact ? 'text-sm' : 'text-base';
  const titlePad = compact ? 'px-2 py-0.5' : 'px-2 py-1';
  return (
    <div className={`rounded border border-gray-200 bg-white overflow-hidden ${sz} ${grow ? 'flex flex-col flex-1 min-h-0' : ''}`}>
      <div className={`${titlePad} bg-gray-700 text-white font-bold tracking-wide shrink-0`}>{title}</div>
      <table className={`w-full ${grow ? 'h-full' : ''}`}>
        <tbody className={grow ? 'h-full' : ''}>
          {rows.map((r, i) => {
            const base = i % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            const hi   = r.highlight ? 'bg-orange-100' : r.highlightRed ? 'bg-red-100' : base;
            return (
              <tr key={i} className={`${hi} ${grow ? 'h-px' : ''}`}>
                <td className={`${cell} text-gray-600 border-b border-gray-100 align-middle w-full`}>{r.label}</td>
                <td className={`${cell} text-right font-mono font-semibold border-b border-gray-100 align-middle whitespace-nowrap ${r.bold ? 'font-extrabold' : ''}`}>
                  {r.value != null ? r.value : <span className="text-gray-300">—</span>}
                </td>
                <td className={`${cell} text-right text-gray-400 border-b border-gray-100 whitespace-nowrap align-middle pl-1`}>{r.unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Donut card (Section C) ───────────────────────────────────────────────────

function ChemDonutCard({ phase, useUnit, doseUnit, use, target, actual, pct }) {
  const color = pct >= 90 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626';
  const data  = [{ value: pct }, { value: 100 - pct }];
  return (
    <div className="border border-gray-200 rounded bg-white p-1.5 flex gap-2 items-center">
      <div className="relative shrink-0" style={{ width: 60, height: 60 }}>
        <PieChart width={60} height={60}>
          <Pie data={data} cx={25} cy={25} innerRadius={17} outerRadius={27} startAngle={90} endAngle={-270} dataKey="value" stroke="none">
            <Cell fill={color} />
            <Cell fill="#e5e7eb" />
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-black leading-none" style={{ color, fontSize: 12 }}>{pct}%</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-gray-700 leading-tight mb-1" style={{ fontSize: 14 }}>{phase}</div>
        <div className="grid grid-cols-3 gap-x-1 text-gray-500" style={{ fontSize: 14 }}>
          <span>USE</span><span>TARGET</span><span>ACTUAL</span>
          <span className="font-mono text-gray-800">{use}<span className="text-gray-400 font-sans font-normal ml-0.5" style={{ fontSize: 11 }}>{useUnit}</span></span>
          <span className="font-mono text-gray-800">{target ?? '—'}<span className="text-gray-400 font-sans font-normal ml-0.5" style={{ fontSize: 11 }}>{doseUnit}</span></span>
          <span className="font-mono text-gray-800">{actual}<span className="text-gray-400 font-sans font-normal ml-0.5" style={{ fontSize: 11 }}>{doseUnit}</span></span>
        </div>
      </div>
    </div>
  );
}

// ── DailyReportTab ───────────────────────────────────────────────────────────

const DR_RIGHT_SUB_TABS = ['SUMMARY', 'CHEMICAL', 'FILTRATION'];

const DR_CHEM_REMAINING_ROWS = [
  { label: 'PA1', value: '947',  unit: 'm³' },
  { label: 'PA2', value: '154',  unit: 'm³' },
  { label: 'AL1', value: '33.9', unit: 'TON' },
  { label: 'AL2', value: '24.1', unit: 'TON' },
  { label: 'CL1', value: '34.8', unit: 'drum' },
  { label: 'CL2', value: '39.7', unit: 'drum' },
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

// ── Settings Modal ────────────────────────────────────────────────────────────
function ReportSettingsModal({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    get('/api/scenarios/report-settings').then(setCfg).catch(() => setMsg('โหลดการตั้งค่าไม่สำเร็จ'));
  }, []);

  function setField(section, key, val) {
    setCfg(prev => {
      if (!prev) return prev;
      if (section) return { ...prev, [section]: { ...prev[section], [key]: val === '' ? '' : Number(val) } };
      return { ...prev, [key]: val === '' ? '' : Number(val) };
    });
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await patch('/api/scenarios/report-settings', cfg);
      setMsg({ ok: true, text: 'บันทึกสำเร็จ' });
    } catch (e) {
      setMsg({ ok: false, text: 'บันทึกไม่สำเร็จ: ' + e.message });
    } finally { setSaving(false); }
  }

  const NI = ({ section, field, label, unit }) => (
    <div className="flex items-center gap-2">
      <label className="w-44 text-sm text-gray-600 shrink-0">{label}</label>
      <input
        type="number"
        step="any"
        value={cfg ? (section ? cfg[section]?.[field] ?? '' : cfg[field] ?? '') : ''}
        onChange={e => setField(section, field, e.target.value)}
        className="w-32 border border-gray-300 rounded px-2 py-1 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      {unit && <span className="text-sm text-gray-400 whitespace-nowrap">{unit}</span>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 bg-gray-800 text-white flex items-center justify-between shrink-0">
          <span className="font-bold text-base">⚙ ตั้งค่ารายงานประจำวัน</span>
          <button onClick={onClose} className="text-gray-300 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!cfg && !msg && <div className="text-gray-400 text-sm text-center py-8">กำลังโหลด…</div>}

          {cfg && (
            <>
              {/* ต้นทุนสารเคมี */}
              <section>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">ต้นทุนสารเคมี</div>
                <div className="space-y-2">
                  <NI section="chem_cost" field="alum_ton"     label="ราคา ALUM"     unit="บาท/ตัน" />
                  <NI section="chem_cost" field="pacl_ton"     label="ราคา PACl"     unit="บาท/ตัน" />
                  <NI section="chem_cost" field="chlorine_ton" label="ราคา Chlorine" unit="บาท/ตัน" />
                  <NI section="chem_cost" field="sludge_day"   label="ค่ากำจัดตะกอน" unit="บาท/วัน" />
                </div>
              </section>

              {/* ต้นทุนพลังงาน */}
              <section>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">ต้นทุนพลังงาน</div>
                <div className="space-y-2">
                  <NI section="energy_cost" field="peak_price"    label="ราคา Peak"      unit="บาท/kWh" />
                  <NI section="energy_cost" field="offpeak_price" label="ราคา Off-Peak"  unit="บาท/kWh" />
                  <NI section="energy_cost" field="ft_price"      label="ค่า Ft"         unit="บาท/kWh" />
                  <NI section="energy_cost" field="max_energy"    label="Demand Charge"  unit="บาท/เดือน" />
                </div>
              </section>

              {/* ค่าคงที่ระบบ */}
              <section>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">ค่าคงที่ระบบ</div>
                <div className="space-y-2">
                  <NI section={null} field="rw_cost"     label="ต้นทุนน้ำดิบ"          unit="บาท/ลบ.ม." />
                  <NI section={null} field="cwt_area_m2" label="พื้นที่หน้าตัด CWT"   unit="ตร.ม." />
                  <p className="text-xs text-gray-400 ml-46">ใช้แปลง Δระดับ (ม.) → Δปริมาตร (ลบ.ม.) เพื่อคำนวณ Water Loss</p>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
          <div className={`text-sm ${msg?.ok === false ? 'text-red-600' : 'text-green-600'}`}>
            {typeof msg === 'string' ? msg : msg?.text}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100">ยกเลิก</button>
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

function DailyReportTab({ selectedDate }) {
  const [rightSubTab, setRightSubTab] = useState('SUMMARY');
  const [shift, setShift]             = useState(1);
  const [reportData, setReportData]   = useState(null);
  const [validation, setValidation]   = useState(null);
  const [querying, setQuerying]       = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState(null); // { ok, text }
  const [showSettings, setShowSettings] = useState(false);

  async function handleQuery() {
    setQuerying(true);
    setValidation(null);
    setSaveMsg(null);
    try {
      const r = await get(`/api/daily-report?date=${selectedDate}`);
      setReportData(r);
    } catch (e) {
      setSaveMsg({ ok: false, text: 'QUERY ล้มเหลว: ' + e.message });
    } finally { setQuerying(false); }
  }

  async function handleValidate() {
    setSaveMsg(null);
    try {
      const r = await post('/api/daily-report/validate', { date: selectedDate });
      setValidation(r);
    } catch (e) {
      setSaveMsg({ ok: false, text: 'VALIDATE ล้มเหลว: ' + e.message });
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await post('/api/daily-report/save', { date: selectedDate, shift });
      setSaveMsg({ ok: true, text: `บันทึกแล้ว (${r.savedAt})` });
    } catch (e) {
      setSaveMsg({ ok: false, text: 'SAVE ล้มเหลว: ' + e.message });
    } finally { setSaving(false); }
  }

  // ── Derive display values from reportData ──────────────────────────────
  const d = reportData;

  const kpi = [
    { key: 'water',  label: 'WATER PRODUCED', value: d ? fmt(d.card3_pumped.total) : '—',           unit: 'ลบ.ม./วัน', color: '#16a34a' },
    { key: 'loss',   label: '% LOSS WATER',   value: d ? fmt(d.summary.water_loss_pct, 2) : '—',    unit: '%',           color: '#dc2626' },
    { key: 'cost',   label: 'TOTAL COST',     value: d ? fmt(d.summary.total_cost_baht) : '—',       unit: 'Baht',        color: '#9333ea' },
    { key: 'energy', label: 'ENERGY',         value: d ? fmt(d.card12_energy.total, 2) : '—',        unit: 'MWh',         color: '#d97706' },
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
    '—', '—',
  ] : ['41','6','1.0','1.0','13.4','18.5'];

  const costRows = d ? [
    { label: 'CHEMICAL COST',        value: fmt(d.summary.chem_cost_per_m3,  4), unit: 'Baht/m³' },
    { label: 'ENERGY COST',          value: fmt(d.summary.energy_per_m3,     4), unit: 'Baht/m³' },
    { label: 'SLUDGE DISPOSAL COST', value: fmt(d.summary.total_cost_per_m3 != null && d.summary.chem_cost_per_m3 != null && d.summary.energy_per_m3 != null ? null : null, 4), unit: 'Baht/m³' },
    { label: 'RAW WATER COST',       value: '—',                                  unit: 'Baht/m³' },
    { label: 'TOTAL COST',           value: fmt(d.summary.total_cost_per_m3, 4), unit: 'Baht/m³', bold: true },
  ] : DR_COST_ROWS;

  const paclUse  = d ? ((d.card5_chem1_pacl.out ?? 0) + (d.card6_chem2_pacl.out ?? 0)) : null;
  const paclInc  = d ? ((d.card5_chem1_pacl.in  ?? 0) + (d.card6_chem2_pacl.in  ?? 0)) : null;
  const alumUse  = d ? ((d.card9_chem1_alum.out  ?? 0) + (d.card10_chem2_alum.out ?? 0)) : null;
  const alumInc  = d ? ((d.card9_chem1_alum.in   ?? 0) + (d.card10_chem2_alum.in  ?? 0)) : null;
  const clUseKg  = d ? ((d.card7_chem1_cl.use_kg ?? 0) + (d.card8_chem2_cl.use_kg ?? 0)) : null;

  const sankeyData = d && d.card1_raw_water.total && d.card3_pumped.total ? {
    nodes: [
      { id: 'Raw Water' }, { id: 'TPS Water' }, { id: 'DPS Water' },
      { id: 'Production' }, { id: 'Service Water' }, { id: 'CWT' },
      { id: 'Loss' }, { id: 'Sludge' },
    ],
    links: [
      { source: 'Raw Water',  target: 'TPS Water',     value: Math.round(d.card1_raw_water.total) },
      { source: 'TPS Water',  target: 'DPS Water',     value: Math.round(d.card3_pumped.tps ?? d.card3_pumped.total) },
      { source: 'TPS Water',  target: 'Sludge',        value: Math.max(1, Math.round(d.card11_sludge.total ?? 1)) },
      { source: 'DPS Water',  target: 'Production',    value: Math.round(d.card3_pumped.total) },
      { source: 'DPS Water',  target: 'Service Water', value: Math.max(1, Math.round(d.summary.service_water_m3 ?? 1)) },
      { source: 'DPS Water',  target: 'Loss',          value: Math.max(1, Math.round(d.summary.water_loss_pct != null ? d.card3_pumped.total * d.summary.water_loss_pct / 100 : 1)) },
      { source: 'Production', target: 'CWT',           value: Math.round(d.card3_pumped.total) },
    ].filter(l => l.value > 0),
  } : SANKEY_DATA;

  const leftDonuts  = CHEM_DONUT_ROWS.filter(r => r.col === 'left');
  const rightDonuts = CHEM_DONUT_ROWS.filter(r => r.col === 'right');

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-white">
      {showSettings && <ReportSettingsModal onClose={() => setShowSettings(false)} />}

      {/* ── COL 1 (3): ACTION BOX + KPI + Sankey + tables ── */}
      <div className="flex-[3] min-w-0 border-r border-gray-200 flex flex-col overflow-hidden bg-white">

        {/* Row 1: buttons */}
        <div className="shrink-0 bg-gray-50 border-b border-gray-200 px-2 py-1.5 flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleQuery}
            disabled={querying}
            className="px-2.5 py-1 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-bold rounded transition-colors"
          >{querying ? '⏳...' : 'QUERY DATA'}</button>

          <button
            onClick={handleValidate}
            disabled={!reportData}
            className="px-2.5 py-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded transition-colors"
          >VALIDATE</button>

          <button
            onClick={handleSave}
            disabled={saving || !reportData}
            className="px-2.5 py-1 bg-purple-500 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded transition-colors"
          >{saving ? '⏳...' : 'SAVE DB'}</button>

          <div className="flex items-center gap-1 text-sm text-gray-500 ml-auto">
            Shift:
            <select
              value={shift}
              onChange={e => setShift(Number(e.target.value))}
              className="border border-gray-300 rounded px-1 py-0.5 text-sm bg-white ml-0.5"
            >
              <option value={1}>1</option><option value={2}>2</option>
              <option value={3}>3</option><option value={4}>4</option>
            </select>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded border border-gray-300 transition-colors"
            title="ตั้งค่าราคาและค่าคงที่"
          >⚙ ตั้งค่า</button>
        </div>

        {/* Status bar */}
        {(saveMsg || validation) && (
          <div className={`shrink-0 px-2 py-1 text-xs font-medium border-b ${saveMsg?.ok === false ? 'bg-red-50 text-red-700 border-red-200' : saveMsg?.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
            {saveMsg && <span>{saveMsg.text}</span>}
            {validation && !saveMsg && (
              <span>
                VALIDATE: ERROR {validation.errorCount} · WARNING {validation.warningCount}
                {validation.errorCount > 0 && ` — ${validation.errors.slice(0, 3).join(', ')}${validation.errors.length > 3 ? '...' : ''}`}
              </span>
            )}
          </div>
        )}

        {/* Row 2: A. SUMMARY KPI */}
        <div className="shrink-0 border-b border-gray-200 px-2 py-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">A. SUMMARY KPI</span>
            {validation && (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 bg-red-100 border border-red-300 rounded px-1.5 py-0.5">
                  <span className="text-sm font-bold text-red-600">ERROR</span>
                  <span className="text-base font-black text-red-700">{validation.errorCount}</span>
                </div>
                <div className="flex items-center gap-1 bg-yellow-100 border border-yellow-300 rounded px-1.5 py-0.5">
                  <span className="text-sm font-bold text-yellow-700">WARNING</span>
                  <span className="text-base font-black text-yellow-800">{validation.warningCount}</span>
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {kpi.map(k => (
              <div key={k.key} className="rounded border border-gray-200 px-2 py-1">
                <div className="text-sm text-gray-400 uppercase tracking-wide leading-tight">{k.label}</div>
                <div className="text-2xl font-black font-mono leading-tight" style={{ color: k.color }}>
                  {k.value ?? <span className="text-gray-300 text-lg">—</span>}
                </div>
                <div className="text-sm text-gray-400">{k.unit}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 3: B. Sankey */}
        <div className="flex-1 min-h-0 px-2 pt-1.5 pb-1 flex flex-col overflow-hidden">
          <div className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1 border-b border-gray-200 pb-0.5">B. OPERATION ACCURACY WALL</div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ResponsiveSankey
              data={sankeyData}
              margin={{ top: 8, right: 80, bottom: 8, left: 80 }}
              align="justify"
              colors={{ scheme: 'category10' }}
              nodeOpacity={1}
              nodeThickness={14}
              nodeInnerPadding={3}
              nodeSpacing={14}
              nodeBorderWidth={0}
              linkOpacity={0.4}
              enableLinkGradient
              labelPosition="outside"
              labelOrientation="horizontal"
              labelPadding={6}
              labelTextColor={{ from: 'color', modifiers: [['darker', 1]] }}
              theme={{ fontSize: 12 }}
            />
          </div>
        </div>

        {/* CHEMICAL REMAINING */}
        <div className="shrink-0 px-2 py-1 border-t border-gray-100">
          <div className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">CHEMICAL REMAINING</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                {['PA1','PA2','AL1','AL2','CL1','CL2','UNIT'].map(h => (
                  <th key={h} className="px-1 py-0.5 text-gray-600 font-bold text-center border border-gray-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {chemRemaining.map(r => (
                  <td key={r.label} className="px-1 py-0.5 text-center font-mono text-gray-800 border border-gray-200">
                    {r.value ?? <span className="text-gray-300">—</span>}
                  </td>
                ))}
                <td className="px-1 py-0.5 text-center text-gray-400 border border-gray-200">m³/TON</td>
              </tr>
              <tr>
                {chemDays.map((v, i) => (
                  <td key={i} className="px-1 py-0.5 text-center font-mono text-gray-800 border border-gray-200">
                    {v ?? <span className="text-gray-300">—</span>}
                  </td>
                ))}
                <td className="px-1 py-0.5 text-center text-gray-400 border border-gray-200">Day</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Chemical use + costs */}
        <div className="shrink-0 px-2 py-1 border-t border-gray-100 flex gap-2">
          <div className="flex-1 text-sm text-gray-700 space-y-0.5">
            <div>PACL USE: <b>{d ? fmt(paclUse, 2) : '49.24'}</b> TON / INC: {d ? fmt(paclInc, 2) : '42.22'} TON</div>
            <div>ALUM USE: <b>{d ? fmt(alumUse, 2) : '10.91'}</b> TON / INC: {d ? fmt(alumInc, 2) : '0.00'} TON</div>
            <div>CHLORINE USE: <b>{d ? fmt(clUseKg ? clUseKg / 1000 : null, 3) : '4.53'}</b> TON</div>
          </div>
          <div className="flex-1">
            <table className="w-full text-sm">
              <tbody>
                {costRows.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="text-gray-600 leading-snug">{r.label}</td>
                    <td className="text-right font-mono font-semibold text-gray-800 px-1">
                      {r.value ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="text-gray-400 whitespace-nowrap">{r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── COL 2 (3.6): C. Chemical Accuracy Wall ── */}
      <div className="min-w-0 border-r border-gray-200 flex flex-col overflow-hidden bg-gray-50" style={{ flex: '4.04 1 0%' }}>
        <div className="shrink-0 px-3 py-1 bg-gray-100 border-b border-gray-200">
          <span className="text-base font-bold text-gray-600 uppercase tracking-wider">C. CHEMICAL ACCURACY WALL</span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-0.5 p-1">
          {leftDonuts.map((ld, i) => (
            <div key={ld.phase} className="flex-1 min-h-0 grid grid-cols-2 gap-1">
              <ChemDonutCard {...ld} />
              <ChemDonutCard {...rightDonuts[i]} />
            </div>
          ))}
        </div>
      </div>

      {/* ── COL 3 (4.4): Data tables ── */}
      <div className="min-w-0 flex flex-col overflow-hidden bg-white" style={{ flex: '3.96 1 0%' }}>
        <div className="shrink-0 flex border-b border-gray-300 bg-gray-50">
          {DR_RIGHT_SUB_TABS.map(s => (
            <button
              key={s}
              onClick={() => setRightSubTab(s)}
              className={[
                'px-4 py-1.5 text-base font-semibold border-r border-gray-200 transition-colors',
                rightSubTab === s
                  ? 'bg-white text-gray-900 border-b-2 border-b-blue-500'
                  : 'bg-gray-50 text-gray-500 hover:bg-white',
              ].join(' ')}
            >{s}</button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-1.5 gap-1">
          {rightSubTab === 'SUMMARY' && (
            <>
              <div className="flex-[4] min-h-0 gap-1" style={{ display: 'grid', gridTemplateColumns: '2.7fr 2.3fr' }}>
                <DailyTableCardUI title={summaryCards[0].title} rows={summaryCards[0].rows} compact grow />
                <DailyTableCardUI title={summaryCards[1].title} rows={summaryCards[1].rows} compact grow />
              </div>
              <div className="min-h-0 gap-1" style={{ flex: '3.4 1 0%', display: 'grid', gridTemplateColumns: '2.7fr 2.3fr' }}>
                <DailyTableCardUI title={summaryCards[2].title} rows={summaryCards[2].rows} compact grow />
                <DailyTableCardUI title={summaryCards[3].title} rows={summaryCards[3].rows} compact grow />
              </div>
              <div className="min-h-0 gap-1" style={{ flex: '5.6 1 0%', display: 'grid', gridTemplateColumns: '2.7fr 2.3fr' }}>
                <div className="flex flex-col gap-1 min-h-0 overflow-hidden">
                  <DailyTableCardUI title={summaryCards[4].title} rows={summaryCards[4].rows} compact grow />
                  <div className="shrink-0 grid grid-cols-2 gap-1">
                    <div className="border border-gray-200 rounded bg-white px-1.5 py-1.5">
                      <div className="text-xs text-gray-500 font-semibold leading-tight">Filter Availability</div>
                      <div className="text-sm font-black text-gray-800 font-mono">—</div>
                    </div>
                    <div className="border border-gray-200 rounded bg-white px-1.5 py-1.5">
                      <div className="text-xs text-gray-500 font-semibold leading-tight">SERVICE WATER</div>
                      <div className="text-sm font-black text-gray-800 font-mono">
                        {d ? `${fmt(d.summary.service_water_m3)} m³` : '— m³'}
                      </div>
                    </div>
                  </div>
                </div>
                <DailyTableCardUI title={summaryCards[5].title} rows={summaryCards[5].rows} compact grow />
              </div>
              <div className="flex-[2] min-h-0 grid grid-cols-4 gap-1">
                {[1,2,3,4].map(p => (
                  <div key={p} className="border border-gray-200 rounded bg-white p-1.5 text-center flex flex-col justify-center">
                    <div className="text-xs text-gray-400 font-semibold leading-tight">Phase {p} WASH Water</div>
                    <div className="text-base font-black text-gray-800">—</div>
                    <div className="text-sm text-gray-500">FRT: <span className="font-bold text-gray-700">—</span></div>
                  </div>
                ))}
              </div>
            </>
          )}
          {rightSubTab === 'CHEMICAL' && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { title: 'CHEM1 PACl',     rows: [{ label: 'Δ Tank A', value: d ? fmt(d.card5_chem1_pacl.tankA_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank B', value: d ? fmt(d.card5_chem1_pacl.tankB_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card5_chem1_pacl.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card5_chem1_pacl.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card5_chem1_pacl.out, 2) : null, unit: 'TON', bold: true }] },
                { title: 'CHEM2 PACl',     rows: [{ label: 'Δ Tank C', value: d ? fmt(d.card6_chem2_pacl.tankC_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank D', value: d ? fmt(d.card6_chem2_pacl.tankD_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card6_chem2_pacl.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card6_chem2_pacl.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card6_chem2_pacl.out, 2) : null, unit: 'TON', bold: true }] },
                { title: 'CHEM1 ALUM',     rows: [{ label: 'Δ Tank A', value: d ? fmt(d.card9_chem1_alum.tankA_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank B', value: d ? fmt(d.card9_chem1_alum.tankB_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card9_chem1_alum.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card9_chem1_alum.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card9_chem1_alum.out, 2) : null, unit: 'TON', bold: true }] },
                { title: 'CHEM2 ALUM',     rows: [{ label: 'Δ Tank C', value: d ? fmt(d.card10_chem2_alum.tankC_delta, 2) : null, unit: 'm³' }, { label: 'Δ Tank D', value: d ? fmt(d.card10_chem2_alum.tankD_delta, 2) : null, unit: 'm³' }, { label: 'Net', value: d ? fmt(d.card10_chem2_alum.net, 2) : null, unit: 'TON' }, { label: 'IN', value: d ? fmt(d.card10_chem2_alum.in, 2) : null, unit: 'TON' }, { label: 'OUT (USE)', value: d ? fmt(d.card10_chem2_alum.out, 2) : null, unit: 'TON', bold: true }] },
                { title: 'CHEM1 Chlorine', rows: [{ label: 'Δ Line A', value: d ? fmt(d.card7_chem1_cl.lineA_delta, 1) : null, unit: 'kg' }, { label: 'Δ Line B', value: d ? fmt(d.card7_chem1_cl.lineB_delta, 1) : null, unit: 'kg' }, { label: 'IN', value: d ? fmt(d.card7_chem1_cl.in_kg, 1) : null, unit: 'kg' }, { label: 'USE', value: d ? fmt(d.card7_chem1_cl.use_kg, 1) : null, unit: 'kg', bold: true }] },
                { title: 'CHEM2 Chlorine', rows: [{ label: 'Δ Line C', value: d ? fmt(d.card8_chem2_cl.lineC_delta, 1) : null, unit: 'kg' }, { label: 'Δ Line D', value: d ? fmt(d.card8_chem2_cl.lineD_delta, 1) : null, unit: 'kg' }, { label: 'IN', value: d ? fmt(d.card8_chem2_cl.in_kg, 1) : null, unit: 'kg' }, { label: 'USE', value: d ? fmt(d.card8_chem2_cl.use_kg, 1) : null, unit: 'kg', bold: true }] },
              ].map(c => <DailyTableCardUI key={c.title} {...c} />)}
            </div>
          )}
          {rightSubTab === 'FILTRATION' && (
            <div className="grid grid-cols-2 gap-2">
              {[1,2,3,4].map(n => (
                <DailyTableCardUI key={n} title={`Filter Phase #${n}`} rows={[
                  { label: 'Run Time',     value: null, unit: 'h'  },
                  { label: 'Backwash Vol', value: null, unit: 'm³' },
                  { label: 'Head Loss',    value: null, unit: 'm'  },
                ]} />
              ))}
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 animate-fadeSlideUp">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔄</div>
          <h2 className="text-xl font-bold text-brand">ต่ออายุ Session</h2>
          <p className="text-gray-500 text-sm mt-1">Aquadat กลับมาแล้ว — กรุณา Login เพื่อ refresh token</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AD Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand"
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
  const [activeStation, setActiveStation] = useState(
    ACTIVE_STATIONS.has(initStation) ? initStation : 'RWS1'
  );
  const [selectedDate, setSelectedDate] = useState(() => {
    const urlDate = searchParams.get('date');
    if (urlDate) { setRefDate(urlDate); return urlDate; }
    return getRefDate();
  });
  const [activeTopic, setActiveTopic]     = useState(null);
  const [history, setHistory]             = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [stage, setStage]                 = useState(1);
  const [showLoginOverlay, setShowLoginOverlay] = useState(false);
  const prevStageRef = useRef(1);
  const hadNonNormalStageRef = useRef(false);
  const [dirtyValues, setDirtyValues]     = useState({});
  const [submitStatus, setSubmitStatus]   = useState({});
  const [widgets, setWidgets]                   = useState([]);
  const [widgetLayout, setWidgetLayout]         = useState([]);
  const [showPicker, setShowPicker]             = useState(false);
  const [configuringWidget, setConfiguringWidget] = useState(null);
  const [canvasWidth, setCanvasWidth]           = useState(400);
  const [canvasHeight, setCanvasHeight]         = useState(400);

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

  const { data: opNodes } = useQuery({
    queryKey: ['op-nodes'],
    queryFn: () => get('/api/operator/nodes'),
    staleTime: 300000,
  });

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });
  const canRecord = !(me?.bypass);
  const loginId   = me?.username ?? me?.name ?? me?.user_id ?? 'default';

  const stationDef = opNodes?.stations?.find(s => s.id === activeStation) ?? null;

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

  // Reset history when station or date changes
  useEffect(() => {
    setHistory({});
  }, [activeStation, selectedDate]);

  // Fetch all history for station — server decides Aquadat vs Uroboros based on its own stage
  // Fetch per station+date (not per topic) so topic switching is instant from cache
  useEffect(() => {
    if (!activeStation) return;
    setHistoryLoading(true);
    const qs = new URLSearchParams({ station_id: activeStation, date: selectedDate });
    get(`/api/operator/history?${qs}`)
      .then(data => {
        if (data && typeof data === 'object') setHistory(data);
      })
      .catch(e => console.warn('[history]', activeStation, e.message))
      .finally(() => setHistoryLoading(false));
  }, [activeStation, selectedDate]);


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
    setActiveStation(id);
    setDirtyValues({});
    setSubmitStatus({});
    navigate(`/op-record?station=${id}`, { replace: true });
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
      <div className="flex items-center gap-3 shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2">
        {/* Left: title */}
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap shrink-0">
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
                  ${isActive ? `${tab.color} text-white border-transparent` : isAvail ? 'bg-white text-gray-700 border-gray-200 hover:border-gray-400' : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'}`}
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
                ${showPicker ? `${activeTabMeta?.color ?? 'bg-gray-700'} text-white border-transparent` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
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
                  ${isOn ? `${tc.header} border-transparent shadow-md scale-105` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
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
        <div className="flex-1 min-h-0 rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <DailyReportTab selectedDate={selectedDate} />
        </div>
      )}

      {/* Body 70:30 — station recording tabs */}
      {activeStation !== 'DAILY' && !stationDef ? (
        <div className="text-center py-12 text-gray-400">
          {!ACTIVE_STATIONS.has(activeStation) ? 'เร็วๆ นี้' : 'กำลังโหลด...'}
        </div>
      ) : activeStation !== 'DAILY' && (
        <div className="flex gap-3 flex-1 min-h-0">
          {/* 70% — recording */}
          <div className="flex-[7] min-w-0 min-h-0 flex flex-col rounded-xl shadow-sm border border-gray-100 overflow-hidden relative">
            {currentTopic ? (
              <RecordingTable
                topic={currentTopic}
                history={history}
                allHistory={liveHistory}
                dirtyValues={dirtyValues}
                onCellChange={handleCellChange}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400">เลือก sub-group ด้านบน</div>
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

          {/* 30% — widget canvas */}
          <div className="flex-[3] min-w-0 min-h-0 flex flex-col rounded-xl shadow-sm border border-gray-100 bg-gray-50 overflow-hidden relative">
            <div className="px-3 py-2 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-500">Dashboard</span>
              <button onClick={() => setShowPicker(p => !p)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                + เพิ่ม Widget
              </button>
            </div>

            <div ref={canvasRef} className="flex-1 overflow-auto">
              {widgets.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 p-4">
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
