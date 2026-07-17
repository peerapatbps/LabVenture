import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api.js';
import TokenCountdown from './TokenCountdown.jsx';
import { SidebarContext } from '../context/SidebarContext.jsx';

const ALL_NAV = [
  { to: '/op-dashboard', label: 'OP ภาพรวม',   icon: '🏭', page: 'op-dashboard', roles: ['operator', 'superadmin'] },
  { to: '/op-record',    label: 'OP บันทึก',   icon: '📋', page: 'op-record',    roles: ['operator', 'superadmin'] },
  { to: '/dashboard',    label: 'Sci ภาพรวม',  icon: '📊', page: 'dashboard' },
  { to: '/record',       label: 'Sci บันทึก',  icon: '✏️', page: 'record' },
  { to: '/chem-intake',  label: 'รับสารเคมี',   icon: '🧪', page: 'chem-intake' },
  { to: '/car',          label: 'CAR Log',     icon: '🔴', page: 'car' },
  { to: '/report',       label: 'รายงาน',      icon: '📈', page: 'report' },
  { to: '/config',       label: 'Config',      icon: '⚙️', page: 'config' },
];

// Pages each role may access (null = no restriction)
const ROLE_PAGES = {
  scientist:    null,
  operator:     ['op-dashboard', 'op-record', 'chem-intake', 'car', 'report'],
  executive_3a: ['car', 'report'],
  executive_3b: ['car', 'report'],
  observer:     null,
  superadmin:   null,
};

const SCENARIO_COLORS = {
  'ปกติ':       'bg-teal-500',
  'น้ำขุ่น':    'bg-amber-400',
  'สาหร่ายสูง': 'bg-red-400',
};

export default function Layout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });

  const role = me?.role ?? null;
  const allowedPages = ROLE_PAGES[role] ?? null;
  const NAV = ALL_NAV.filter(n => {
    if (n.roles && role && !n.roles.includes(role)) return false;
    if (allowedPages && !allowedPages.includes(n.page)) return false;
    return true;
  });
  const { data: scenario } = useQuery({ queryKey: ['active-scenario'], queryFn: () => get('/api/scenarios/active'), refetchInterval: 30000 });
  const { data: epidemicData } = useQuery({ queryKey: ['epidemic'], queryFn: () => get('/api/scenarios/epidemic'), refetchInterval: 30000 });
  const isEpidemic = !!epidemicData?.epidemic;
  const { data: marqueeData } = useQuery({ queryKey: ['marquee'], queryFn: () => get('/api/scenarios/marquee'), refetchInterval: 60000 });
  const marqueeText = marqueeData?.marquee_text || '';

  async function logout() {
    await post('/api/auth/logout');
    qc.clear();
    navigate('/login', { replace: true });
  }

  return (
    <SidebarContext.Provider value={{ collapsed: true }}>
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
            {scenario && (
              <div className="flex items-center gap-1.5 border border-white/40 rounded-lg px-2.5 py-1 text-xs text-white/90 ml-1">
                <span className={`w-2 h-2 rounded-full shrink-0 ${SCENARIO_COLORS[scenario.name] ?? 'bg-gray-400'}`} />
                สถานการณ์: {scenario.name}
              </div>
            )}
            <div className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs ml-1
              ${isEpidemic
                ? 'border-red-300 bg-red-500/30 text-white'
                : 'border-white/30 text-white/70'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${isEpidemic ? 'bg-red-300' : 'bg-white/40'}`} />
              โรคระบาด: {isEpidemic ? 'ใช่' : 'ไม่ใช่'}
            </div>
          </div>
          <div className="flex-1 overflow-hidden mx-4">
            {marqueeText && (
              <marquee className="text-sm text-white/70" scrollamount="3">
                {marqueeText}
              </marquee>
            )}
          </div>
          <div className="flex items-center">
            <div className="flex items-center justify-center px-3 py-2 bg-brand">
              <span className="text-xl">🔔</span>
            </div>
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
            {me?.name && (
              <div className="flex flex-col justify-center px-3 py-1 bg-brand leading-tight">
                <span className="text-sm font-semibold whitespace-nowrap">{me.name}</span>
                <span className="text-xs text-white/70 whitespace-nowrap">{me.position}</span>
              </div>
            )}
            {me?.exp && (
              <div className="flex flex-col justify-center px-3 py-1 bg-brand leading-tight">
                <TokenCountdown exp={me.exp} />
              </div>
            )}
            <button
              onClick={logout}
              className="text-sm bg-white/20 hover:bg-white/30 px-3 py-2 touch-target border border-white/30 rounded-r-lg ml-1"
            >
              ออกจากระบบ
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — desktop: always icon-strip, slides open on hover */}
          <div
            onMouseEnter={() => setSidebarHover(true)}
            onMouseLeave={() => setSidebarHover(false)}
            className={`hidden md:flex flex-col shrink-0 bg-white border-r border-gray-200 transition-[width] duration-200 ease-out overflow-hidden z-20 relative ${sidebarHover ? 'w-52' : 'w-12'}`}
          >
            <nav className="flex flex-col gap-1 pt-2 overflow-y-auto flex-1">
              {NAV.map(n => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap
                     ${isActive ? 'bg-brand text-white' : 'text-gray-700 hover:bg-gray-100'}`
                  }
                >
                  <span className="shrink-0 w-6 text-center">{n.icon}</span>
                  <span className={`transition-opacity duration-150 ${sidebarHover ? 'opacity-100' : 'opacity-0'}`}>
                    {n.label}
                  </span>
                </NavLink>
              ))}
            </nav>
          </div>

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
            {me?.bypass && me.role === 'observer' && (
              <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg flex items-center gap-2">
                <span>👁</span>
                <span>โหมดผู้สังเกตการณ์ — ดูข้อมูลได้อย่างเดียว ไม่สามารถดำเนินการใดๆ ได้</span>
              </div>
            )}
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
