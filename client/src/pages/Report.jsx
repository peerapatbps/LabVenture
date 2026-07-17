import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api.js';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceArea, ResponsiveContainer,
} from 'recharts';

const LINE_COLORS = ['#0369a1', '#16a34a', '#d97706', '#9333ea', '#e11d48'];

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

let _nextId = 1;

export default function Report() {
  const today = formatDate(new Date());
  const weekAgo = formatDate(new Date(Date.now() - 7 * 86400000));

  const [beginDt, setBeginDt] = useState(weekAgo);
  const [endDt, setEndDt] = useState(today);
  const [datasets, setDatasets] = useState([{ id: 0, paramId: null }]);
  const [showFetch, setShowFetch] = useState(false);

  const { data: config } = useQuery({ queryKey: ['params-config'], queryFn: () => get('/api/config/params') });
  const { data: scenario } = useQuery({ queryKey: ['active-scenario'], queryFn: () => get('/api/scenarios/active') });

  const params = config?.parameters || [];

  const { data: onlineRaw, isLoading: onlineLoading, isError: onlineError } = useQuery({
    queryKey: ['report-online', config?.plant_id, config?.station, beginDt, endDt, showFetch],
    queryFn: () => get(`/api/data/read?plant_id=${config.plant_id}&stationtype_code=${config.station}&begin_dt=${beginDt}&end_dt=${endDt}`),
    enabled: showFetch && !!config?.plant_id,
  });

  const activeDatasets = datasets.filter(d => d.paramId !== null);
  const canAddDataset = datasets[datasets.length - 1].paramId !== null;

  // Build merged chart data: { dt, ds_0: val, ds_1: val, ... }
  const chartData = React.useMemo(() => {
    if (!onlineRaw || activeDatasets.length === 0) return [];
    const raw = Array.isArray(onlineRaw) ? onlineRaw : [];
    const map = new Map();
    activeDatasets.forEach((ds, i) => {
      raw
        .filter(r => r.configparam_id === ds.paramId)
        .forEach(r => {
          const dt = `${r.trans_dtm} ${r.trans_time}`;
          if (!map.has(dt)) map.set(dt, { dt });
          map.get(dt)[`ds_${i}`] = parseFloat(r.trans_value);
        });
    });
    return Array.from(map.values()).sort((a, b) => a.dt.localeCompare(b.dt));
  }, [onlineRaw, activeDatasets]);

  function downloadCSV() {
    if (!chartData.length) return;
    const cols = ['datetime', ...activeDatasets.map((ds, i) => {
      const p = params.find(p => p.configparam_id === ds.paramId);
      return p ? `${p.label}(${p.unit})` : `ds_${i}`;
    })];
    const rows = chartData.map(r =>
      [r.dt, ...activeDatasets.map((_, i) => r[`ds_${i}`] ?? '')].join(',')
    );
    const csv = [cols.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `report_${beginDt}_${endDt}.csv`;
    a.click();
  }

  const firstParam = params.find(p => p.configparam_id === datasets[0].paramId);
  const threshold = scenario?.thresholds?.find(t => t.configparam_id === datasets[0].paramId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">รายงานข้อมูล</h1>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        {/* Date row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">วันเริ่มต้น</label>
            <input type="date" value={beginDt} onChange={e => setBeginDt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">วันสิ้นสุด</label>
            <input type="date" value={endDt} onChange={e => setEndDt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
        </div>

        {/* Dataset selectors */}
        <div className="space-y-2 mb-4">
          {datasets.map((ds, i) => (
            <div key={ds.id} className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: LINE_COLORS[i % LINE_COLORS.length] }}
              />
              <label className="text-xs text-gray-500 w-16 flex-shrink-0">
                {i === 0 ? 'พารามิเตอร์' : `Overlay ${i}`}
              </label>
              <select
                value={ds.paramId || ''}
                onChange={e => {
                  const v = Number(e.target.value) || null;
                  setDatasets(prev => prev.map((d, idx) => idx === i ? { ...d, paramId: v } : d));
                }}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">-- เลือกพารามิเตอร์ --</option>
                {params.map(p => (
                  <option key={p.configparam_id} value={p.configparam_id}>
                    {p.label} ({p.unit})
                  </option>
                ))}
              </select>
              {datasets.length > 1 && (
                <button
                  onClick={() => setDatasets(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-gray-400 hover:text-red-500 text-xl leading-none px-1 flex-shrink-0"
                  title="ลบ"
                >×</button>
              )}
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFetch(true)}
            disabled={!datasets[0].paramId}
            className="bg-brand hover:bg-sky-700 disabled:opacity-40 text-white font-medium px-6 py-2 rounded-lg text-sm touch-target transition-colors"
          >
            ดึงข้อมูล
          </button>
          <div className="flex-1" />
          {chartData.length > 0 && (
            <button onClick={downloadCSV} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm touch-target">
              ⬇ Export CSV
            </button>
          )}
          <button
            onClick={() => setDatasets(prev => [...prev, { id: _nextId++, paramId: null }])}
            disabled={!canAddDataset}
            className="bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 font-bold w-9 h-9 flex items-center justify-center rounded-lg text-lg touch-target"
            title="เพิ่ม overlay"
          >+</button>
        </div>
      </div>

      {/* Chart */}
      {showFetch && activeDatasets.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          {onlineLoading && <div className="text-center py-12 text-gray-400">กำลังดึงข้อมูลจาก AquaDAT...</div>}
          {onlineError && (
            <div className="text-center py-6 text-red-500 text-sm">
              ไม่สามารถดึงข้อมูลออนไลน์ได้ — กรุณาตรวจสอบการเชื่อมต่อ Intranet
            </div>
          )}
          {!onlineLoading && !onlineError && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">
                  {firstParam?.label || ''}
                  {firstParam?.unit && <span className="text-gray-400 text-sm ml-2">({firstParam.unit})</span>}
                  {activeDatasets.length > 1 && (
                    <span className="text-gray-400 text-sm ml-2">+ {activeDatasets.length - 1} overlay</span>
                  )}
                </h2>
                {scenario && (
                  <span className="text-xs text-blue-600">เกณฑ์: {scenario.name}</span>
                )}
              </div>

              {chartData.length === 0 ? (
                <div className="text-center py-12 text-gray-400">ไม่มีข้อมูลในช่วงเวลานี้</div>
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="dt"
                      tick={{ fontSize: 10 }}
                      tickFormatter={v => v?.slice(5, 16) || v}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      domain={['auto', 'auto']}
                      label={{ value: firstParam?.unit, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                    />
                    <Tooltip
                      formatter={(val, name) => {
                        const idx = parseInt(name.replace('ds_', ''));
                        const p = params.find(p => p.configparam_id === activeDatasets[idx]?.paramId);
                        return [val?.toFixed ? val.toFixed(3) : val, p ? `${p.label} (${p.unit})` : name];
                      }}
                      labelFormatter={l => l}
                    />
                    <Legend
                      formatter={name => {
                        const idx = parseInt(name.replace('ds_', ''));
                        const p = params.find(p => p.configparam_id === activeDatasets[idx]?.paramId);
                        return p ? `${p.label} (${p.unit})` : name;
                      }}
                    />

                    {/* Threshold band (based on first dataset) */}
                    {threshold?.max !== null && threshold?.max !== undefined && (
                      <ReferenceArea y1={threshold.max} y2={Infinity} fill="#fef2f2" fillOpacity={0.4} />
                    )}
                    {threshold?.min !== null && threshold?.min !== undefined && (
                      <ReferenceArea y1={-Infinity} y2={threshold.min} fill="#fef2f2" fillOpacity={0.4} />
                    )}

                    {activeDatasets.map((ds, i) => (
                      <Line
                        key={ds.id}
                        type="monotone"
                        dataKey={`ds_${i}`}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        name={`ds_${i}`}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              )}

              {threshold && (
                <div className="mt-3 text-xs text-gray-500 flex gap-4">
                  {threshold.min !== null && <span>เกณฑ์ต่ำสุด: {threshold.min} {firstParam?.unit}</span>}
                  {threshold.max !== null && <span>เกณฑ์สูงสุด: {threshold.max} {firstParam?.unit}</span>}
                  <span className="inline-block w-4 h-2 bg-red-100 border border-red-200 rounded" /> พื้นที่เกินเกณฑ์
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
