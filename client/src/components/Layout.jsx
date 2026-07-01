import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get, post } from '../api.js';
import TokenCountdown from './TokenCountdown.jsx';

const NAV = [
  { to: '/dashboard',   label: 'ภาพรวม',    icon: '📊' },
  { to: '/record',      label: 'บันทึก',    icon: '✏️' },
  { to: '/chem-intake', label: 'รับสารเคมี', icon: '🧪' },
  { to: '/car',         label: 'CAR Log',   icon: '🔴' },
  { to: '/report',      label: 'รายงาน',    icon: '📈' },
  { to: '/config',      label: 'Config',    icon: '⚙️' },
];

const SCENARIO_COLORS = {
  'ปกติ':       'bg-teal-500',
  'น้ำขุ่น':    'bg-amber-400',
  'สาหร่ายสูง': 'bg-red-400',
};

export default function Layout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });
  const { data: scenario } = useQuery({ queryKey: ['active-scenario'], queryFn: () => get('/api/scenarios/active'), refetchInterval: 30000 });

  async function logout() {
    await post('/api/auth/logout');
    navigate('/login');
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="bg-brand text-white px-4 py-3 flex items-center justify-between shadow-md sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <button
            className="md:hidden text-2xl touch-target flex items-center"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="เมนู"
          >☰</button>
          <span className="font-bold text-lg tracking-wide">LabVenture</span>
          {/* Scenario badge — ชิดซ้าย ถัดจาก LabVenture */}
          {scenario && (
            <div className="flex items-center gap-1.5 border border-white/40 rounded-lg px-2.5 py-1 text-xs text-white/90 ml-1">
              <span className={`w-2 h-2 rounded-full shrink-0 ${SCENARIO_COLORS[scenario.name] ?? 'bg-gray-400'}`} />
              สถานการณ์: {scenario.name}
            </div>
          )}
        </div>
        {/* Center — marquee */}
        <div className="flex-1 overflow-hidden mx-4">
          <marquee className="text-sm text-white/70" scrollamount="3">
            ประกาศ: ระบบ LabVenture พร้อมใช้งาน — กรุณาบันทึกค่าให้ครบทุกรอบ — หากพบค่าเกินเกณฑ์ให้ออก CAR ทันที — ข้อมูลจะถูกส่งขึ้น AquaDAT อัตโนมัติ
          </marquee>
        </div>
        <div className="flex items-center">
          {/* Bell */}
          <div className="flex items-center justify-center px-3 py-2 bg-brand">
            <span className="text-xl">🔔</span>
          </div>

          {/* Avatar */}
          {me?.avatarUrl && (
            <div className="flex items-center justify-center px-2 py-1 bg-brand">
              <img
                src={me.avatarUrl}
                alt={me.name || ''}
                onError={e => { e.currentTarget.style.display = 'none'; }}
                className="w-9 h-9 rounded-full object-cover border-2 border-white/40"
              />
            </div>
          )}

          {/* Name / Position */}
          {me?.name && (
            <div className="flex flex-col justify-center px-3 py-1 bg-brand leading-tight">
              <span className="text-sm font-semibold whitespace-nowrap">{me.name}</span>
              <span className="text-xs text-white/70 whitespace-nowrap">{me.position}</span>
            </div>
          )}

          {/* Time bar / countdown */}
          {me?.exp && (
            <div className="flex flex-col justify-center px-3 py-1 bg-brand leading-tight">
              <TokenCountdown exp={me.exp} />
            </div>
          )}

          {/* Logout */}
          <button
            onClick={logout}
            className="text-sm bg-white/20 hover:bg-white/30 px-3 py-2 touch-target border border-white/30 rounded-r-lg ml-1"
          >
            ออกจากระบบ
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop */}
        <nav className="hidden md:flex flex-col w-52 bg-white border-r border-gray-200 pt-4 gap-1 px-2 shrink-0 overflow-y-auto">
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors touch-target ${
                  isActive
                    ? 'bg-brand text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              <span>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>

        {/* Mobile menu overlay */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <nav className="absolute left-0 top-0 bottom-0 w-64 bg-white pt-16 px-3 flex flex-col gap-1 shadow-xl">
              {NAV.map(n => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium touch-target ${
                      isActive ? 'bg-brand text-white' : 'text-gray-700 hover:bg-gray-100'
                    }`
                  }
                >
                  <span>{n.icon}</span> {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
