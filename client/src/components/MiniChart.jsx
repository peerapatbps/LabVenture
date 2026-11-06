import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceArea,
} from 'recharts';

function fmtSlot(slot) {
  if (!slot || slot.includes('ก่อน')) return '';
  const h = parseInt(slot.split(':')[0], 10);
  if (isNaN(h)) return slot;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}${period}`;
}

// Check whether a value exceeds the threshold rule
export function isExceeded(value, rule) {
  if (value == null || !rule) return false;
  if (rule.type === 'max')   return value > rule.max;
  if (rule.type === 'min')   return value < rule.min;
  if (rule.type === 'range') return !(value >= rule.min && value <= rule.max);
  return false;
}

// a slot with no result is skipped (does not reset the count) — streaks count consecutive samples
const hasValue = (v) => v != null && !Number.isNaN(v);

// Build shading bands using the same streak logic as LABview.js:
//   streak=1 (first exceed) → blue
//   streak≥2 (consecutive) → red
// Returns [{ index, x1slot, x2slot, color }]
function buildBands(data, rule) {
  if (!rule || !data?.length) return [];
  const bands = [];
  let streak = 0;

  for (let i = 0; i < data.length; i++) {
    if (!hasValue(data[i]?.value)) continue;
    const exceeded = isExceeded(data[i]?.value, rule);
    if (exceeded) {
      streak += 1;
      // For all but the last point: shade forward (slot[i] → slot[i+1])
      // For the last point: shade backward (slot[i-1] → slot[i]) so it's always visible
      const isLast = i === data.length - 1;
      const x1 = isLast ? data[Math.max(i - 1, 0)].slot : data[i].slot;
      const x2 = isLast ? data[i].slot : data[i + 1].slot;
      if (x1 !== x2) {
        bands.push({
          x1,
          x2,
          color: streak === 1 ? 'rgba(59,130,246,0.22)' : 'rgba(255,59,59,0.24)',
        });
      }
    } else {
      streak = 0;
    }
  }
  return bands;
}

// Compute the streak count at the last data point (mirrors buildBands logic)
export function latestStreak(data, rule) {
  if (!rule || !data?.length) return 0;
  let streak = 0;
  for (let i = 0; i < data.length; i++) {
    if (!hasValue(data[i]?.value)) continue;
    if (isExceeded(data[i]?.value, rule)) streak += 1;
    else streak = 0;
  }
  return streak;
}

// Return { streak, startSlot, endSlot } for the current trailing exceeded run
export function latestStreakInfo(data, rule) {
  if (!rule || !data?.length) return { streak: 0, startSlot: null, endSlot: null };
  let streak = 0, startIdx = -1;
  for (let i = 0; i < data.length; i++) {
    if (!hasValue(data[i]?.value)) continue;
    if (isExceeded(data[i]?.value, rule)) {
      if (streak === 0) startIdx = i;
      streak += 1;
    } else {
      streak = 0;
      startIdx = -1;
    }
  }
  if (streak === 0) return { streak: 0, startSlot: null, endSlot: null };
  return {
    streak,
    startSlot: data[startIdx]?.slot ?? null,
    endSlot:   data[data.length - 1]?.slot ?? null,
  };
}

// Status badge: mirrors shading color — streak=0 → OK, streak=1 → WARN (blue), streak≥2 → BAD (red)
function StatusBadge({ data, rule }) {
  if (!rule) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#1A3A5C]/30 text-[#1A3A5C]">–</span>;
  const streak = latestStreak(data, rule);
  if (streak === 0) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500 text-white">OK</span>;
  if (streak === 1) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-400 text-white">WARN</span>;
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white">BAD</span>;
}

// yMin / yMax: fixed axis bounds (undefined = auto)
// rule: threshold rule { type, max } or { type, min, max } — drives shading + badge
export default function MiniChartCard({ title, data = [], unit, yMin, yMax, rule }) {
  const values = data.map(d => d.value).filter(v => v != null && !isNaN(v));
  const latest = values.at(-1);

  const domainMin = yMin !== undefined ? yMin : 'auto';
  const domainMax = yMax !== undefined ? yMax : 'auto';

  const bands = buildBands(data, rule);

  return (
    <div className="bg-brand-light border border-[#A8D0E8] rounded-xl p-3 flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-sm font-semibold text-[#1A3A5C] truncate pr-2">{title}</span>
        <StatusBadge data={data} rule={rule} />
      </div>

      {data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-[#1A3A5C]/60">ไม่มีข้อมูล</span>
        </div>
      ) : data.length === 1 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <span className="text-3xl font-bold text-[#1A3A5C] tabular-nums">
            {latest != null ? Number(latest).toFixed(2) : '—'}
          </span>
          {unit && <span className="text-xs text-[#1A3A5C]/60">{unit}</span>}
          <span className="text-xs text-[#1A3A5C]/50 mt-1">{data[0].slot}</span>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#A8D0E8" opacity={0.8} />

            {bands.map((band, bi) => (
              <ReferenceArea
                key={bi}
                x1={band.x1}
                x2={band.x2}
                fill={band.color}
                fillOpacity={1}
                strokeOpacity={0}
                isFront={false}
              />
            ))}

            <XAxis
              dataKey="slot"
              tickFormatter={fmtSlot}
              tick={{ fill: '#1A3A5C', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              padding={{ left: 0, right: 0 }}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              tick={{ fill: '#1A3A5C', fontSize: 11 }}
              tickCount={4}
              width={36}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => Number(v).toFixed(1)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1A3A5C', border: 'none', borderRadius: 6, fontSize: 13 }}
              labelStyle={{ color: '#A8D0E8' }}
              itemStyle={{ color: '#8CC0EB' }}
              formatter={v => [v != null ? `${Number(v).toFixed(2)} ${unit || ''}` : '-', '']}
              labelFormatter={v => v}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#5A9EDC"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
