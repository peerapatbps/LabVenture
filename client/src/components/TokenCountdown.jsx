import React, { useState, useEffect } from 'react';

export default function TokenCountdown({ exp }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    function update() {
      setRemaining(Math.max(0, exp - Math.floor(Date.now() / 1000)));
    }
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, [exp]);

  const total = 86400;
  const pct = Math.round((remaining / total) * 100);
  const hours = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);

  const barColor =
    pct > 25 ? 'bg-green-400' :
    pct > 10 ? 'bg-yellow-400' : 'bg-red-400';

  const label =
    remaining === 0 ? 'หมดอายุ' :
    hours > 0 ? `${hours}ชม. ${mins}น.` : `${mins} น.`;

  return (
    <div className="flex flex-col items-center gap-0.5" title={`Token หมดอายุใน ${label}`}>
      <div className="w-20 h-2 bg-white/20 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-white/90">{label}</span>
    </div>
  );
}
