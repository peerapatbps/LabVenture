import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../api.js';

const STATIONS_REQUIRED = ['RW', 'TW1', 'TW2'];
const STATIONS_OPTIONAL = ['CW1', 'CW2', 'CW3', 'CW4'];
const STATIONS = [...STATIONS_REQUIRED, ...STATIONS_OPTIONAL];
const STATION_LABELS = { RW: 'RW', CW1: 'CW1', CW2: 'CW2', CW3: 'CW3', CW4: 'CW4', TW1: 'TW1', TW2: 'TW2' };

export default function WeeklyProgress({ selectedDate, progressNodes }) {
  // --- Algae weekly status ---
  const { data: algaeStatus } = useQuery({
    queryKey: ['algae-week-status', selectedDate],
    queryFn: () => get(`/api/algae/week-status?date=${selectedDate}`),
    staleTime: 60000,
  });

  // --- Chemical Analysis weekly progress from nodes data ---
  const chemNode = (progressNodes || []).find(n => n.id === 'Chemical');
  const weeklyChemParams = chemNode
    ? chemNode.params.filter(p => p.frequency === 'weekly' && !p.skip_progress)
    : [];
  const chemExpected = weeklyChemParams.length;
  const chemDone = weeklyChemParams.filter(p => p.slots.some(s => s.slot === 'weekly' && s.done)).length;

  const reqDone = STATIONS_REQUIRED.filter(s => (algaeStatus?.stations?.[s] ?? 0) > 0).length;
  const reqComplete = reqDone === STATIONS_REQUIRED.length;
  const totalDone = STATIONS.filter(s => (algaeStatus?.stations?.[s] ?? 0) > 0).length;

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Algae card */}
      <div className={`bg-earth-card rounded-xl p-3 shadow-sm border ${reqComplete ? 'border-green-200' : 'border-earth-border'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">🔬</span>
            <span className="text-xs font-semibold text-earth-ink">สาหร่าย (รายสัปดาห์)</span>
            {reqComplete && <span className="text-xs text-green-600 font-semibold">✓ สมบูรณ์</span>}
          </div>
          <Link to="/record?slot=weekly" className="text-xs text-brand-dark hover:underline font-medium">บันทึก</Link>
        </div>
        {/* Required stations */}
        <div className="flex gap-1 mt-1">
          {STATIONS_REQUIRED.map(s => {
            const done = (algaeStatus?.stations?.[s] ?? 0) > 0;
            return (
              <div key={s} className={`flex-1 rounded-lg px-1 py-1 text-center text-xs font-medium border
                ${done ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-500'}`}>
                {done ? '✓' : '–'} {STATION_LABELS[s]}
              </div>
            );
          })}
        </div>
        {/* Optional stations — gray if not recorded */}
        <div className="flex gap-1 mt-1">
          {STATIONS_OPTIONAL.map(s => {
            const done = (algaeStatus?.stations?.[s] ?? 0) > 0;
            return (
              <div key={s} className={`flex-1 rounded-lg px-1 py-1 text-center text-xs font-medium border
                ${done ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                {done ? '✓' : '–'} {STATION_LABELS[s]}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">บันทึกแล้ว {totalDone}/{STATIONS.length} สถานี</p>
      </div>

      {/* Chemical Analysis card */}
      <div className="bg-earth-card rounded-xl p-3 shadow-sm border border-earth-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">🧪</span>
            <span className="text-xs font-semibold text-earth-ink">วิเคราะห์น้ำ (รายสัปดาห์)</span>
          </div>
          <Link
            to="/record?slot=weekly"
            className="text-xs text-brand-dark hover:underline font-medium"
          >
            บันทึก
          </Link>
        </div>
        {chemExpected > 0 ? (
          <>
            <div className="h-2 bg-earth-border rounded-full overflow-hidden mt-1">
              <div
                className={`h-full rounded-full transition-all ${chemDone === chemExpected ? 'bg-green-500' : 'bg-amber-400'}`}
                style={{ width: `${chemExpected ? Math.round((chemDone / chemExpected) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{chemDone}/{chemExpected} พารามิเตอร์</p>
          </>
        ) : (
          <p className="text-xs text-gray-400 mt-1">ไม่มีข้อมูล</p>
        )}
      </div>
    </div>
  );
}
