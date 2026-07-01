import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api.js';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceArea, ResponsiveContainer,
} from 'recharts';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

export default function Report() {
  const today = formatDate(new Date());
  const weekAgo = formatDate(new Date(Date.now() - 7 * 86400000));

  const [beginDt, setBeginDt] = useState(weekAgo);
  const [endDt, setEndDt] = useState(today);
  const [selectedParam, setSelectedParam] = useState(null);
  const [showFetch, setShowFetch] = useState(false);

  const { data: config } = useQuery({ queryKey: ['params-config'], queryFn: () => get('/api/config/params') });
  const { data: scenario } = useQuery({ queryKey: ['active-scenario'], queryFn: () => get('/api/scenarios/active') });

  const params = config?.parameters || [];

  // Online time-series data from AquaDAT
  const { data: onlineRaw, isLoading: onlineLoading, isError: onlineError } = useQuery({
    queryKey: ['report-online', config?.plant_id, config?.station, beginDt, endDt, showFetch],
    queryFn: () => get(`/api/data/read?plant_id=${config.plant_id}&stationtype_code=${config.station}&begin_dt=${beginDt}&end_dt=${endDt}`),
    enabled: showFetch && !!config?.plant_id,
  });

  const param = params.find(p => p.configparam_id === selectedParam);
  const threshold = scenario?.thresholds?.find(t => t.configparam_id === selectedParam);

  // Build chart data: merge online time series with manual points
  const chartData = React.useMemo(() => {
    if (!onlineRaw || !selectedParam) return [];

    const online = (Array.isArray(onlineRaw) ? onlineRaw : [])
      .filter(r => r.configparam_id === selectedParam)
      .map(r => ({
        dt: `${r.trans_dtm} ${r.trans_time}`,
        online: parseFloat(r.trans_value),
        manual: undefined,
      }));

    return online;
  }, [onlineRaw, selectedParam]);

  function downloadCSV() {
    if (!chartData.length) return;
    const cols = ['datetime', 'online', 'manual'];
    const rows = chartData.map(r => [r.dt, r.online ?? '', r.manual ?? ''].join(','));
    const csv = [cols.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `report_${selectedParam}_${beginDt}_${endDt}.csv`;
    a.click();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">รายงานข้อมูล</h1>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">พารามิเตอร์</label>
            <select
              value={selectedParam || ''}
              onChange={e => setSelectedParam(Number(e.target.value) || null)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">-- เลือกพารามิเตอร์ --</option>
              {params.map(p => (
                <option key={p.configparam_id} value={p.configparam_id}>
                  {p.label} ({p.unit})
                </option>
              ))}
            </select>
          </div>
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
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => setShowFetch(true)}
            disabled={!selectedParam}
            className="bg-brand hover:bg-sky-700 disabled:opacity-40 text-white font-medium px-6 py-2 rounded-lg text-sm touch-target transition-colors"
          >
            ดึงข้อมูล
          </button>
          {chartData.length > 0 && (
            <button onClick={downloadCSV} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm touch-target">
              ⬇ Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      {showFetch && selectedParam && (
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
                  {param?.label || selectedParam}
                  {param?.unit && <span className="text-gray-400 text-sm ml-2">({param.unit})</span>}
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
                      label={{ value: param?.unit, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                    />
                    <Tooltip
                      formatter={(val, name) => [val?.toFixed ? val.toFixed(3) : val, name === 'online' ? 'ออนไลน์' : 'Manual']}
                      labelFormatter={l => l}
                    />
                    <Legend formatter={v => v === 'online' ? 'ค่าออนไลน์ (AquaDAT)' : 'ค่า Manual (นักวิทยาศาสตร์)'} />

                    {/* Threshold band */}
                    {threshold?.max !== null && threshold?.max !== undefined && (
                      <ReferenceArea y1={threshold.max} y2={Infinity} fill="#fef2f2" fillOpacity={0.4} />
                    )}
                    {threshold?.min !== null && threshold?.min !== undefined && (
                      <ReferenceArea y1={-Infinity} y2={threshold.min} fill="#fef2f2" fillOpacity={0.4} />
                    )}

                    <Line
                      type="monotone"
                      dataKey="online"
                      stroke="#0369a1"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      name="online"
                    />
                    <Scatter dataKey="manual" fill="#f97316" name="manual" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}

              {threshold && (
                <div className="mt-3 text-xs text-gray-500 flex gap-4">
                  {threshold.min !== null && <span>เกณฑ์ต่ำสุด: {threshold.min} {param?.unit}</span>}
                  {threshold.max !== null && <span>เกณฑ์สูงสุด: {threshold.max} {param?.unit}</span>}
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
