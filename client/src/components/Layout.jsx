import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api.js';
import TokenCountdown from './TokenCountdown.jsx';
import { SidebarContext } from '../context/SidebarContext.jsx';
import { allowedPagesFor, hasRole } from '../config/pageAccess.js';
import { mhxViewUrl } from '../utils/mhxView.js';

const ALL_NAV = [
  { to: '/op-dashboard', label: 'OP ภาพรวม',   icon: '🏭', page: 'op-dashboard', roles: ['operator'] },
  { to: '/op-record',    label: 'OP บันทึก',   icon: '📋', page: 'op-record',    roles: ['operator'] },
  { to: '/dashboard',    label: 'Sci ภาพรวม',  icon: '📊', page: 'dashboard' },
  { to: '/record',       label: 'Sci บันทึก',  icon: '✏️', page: 'record' },
  { to: '/chem-intake',  label: 'รับสารเคมี',   icon: '🧪', page: 'chem-intake' },
  { to: '/car',          label: 'CAR Log',     icon: '🔴', page: 'car' },
  { to: '/report',       label: 'รายงาน',      icon: '📈', page: 'report' },
  { to: '/event-class',  label: 'Event Class', icon: '🔔', page: 'event-class' },
  { to: '/config',       label: 'Config',      icon: '⚙️', page: 'config' },
];

const SCENARIO_COLORS = {
  'ปกติ':       'bg-teal-500',
  'น้ำดิบความขุ่นสูง': 'bg-amber-400',
};

export default function Layout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });

  const role = me?.role ?? null;
  const allowedPages = allowedPagesFor(me);
  const NAV = ALL_NAV.filter(n => {
    if (n.roles && role && !hasRole(me, n.roles)) return false;
    if (allowedPages && !allowedPages.includes(n.page)) return false;
    return true;
  });
  const showChem = NAV.some(n => n.page === 'chem-intake');
  const { data: chemCases } = useQuery({
    queryKey: ['chem-lab', 'cases', 'open'],
    queryFn: () => get('/api/chem-lab/cases?status=open'),
    enabled: showChem, retry: false, refetchInterval: 120000,
  });
  const showEvents = NAV.some(n => n.page === 'event-class');
  const { data: eventOcc } = useQuery({
    queryKey: ['eventclass', 'occurrences'],
    queryFn: () => get('/api/eventclass/occurrences?limit=200'),
    enabled: showEvents, retry: false, refetchInterval: 120000,
  });
  const badges = { 'chem-intake': chemCases?.cases?.length || 0, 'event-class': eventOcc?.pending || 0 };
  const BADGE_TITLE = { 'event-class': 'เหตุการณ์รอตัดสินใจเรื่อง CAR', 'chem-intake': 'เคสชดเชยเปิดอยู่' };
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
        {/* Top bar — L2 panel surface */}
        <header className="bg-earth-card border-b border-earth-border px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-sm">
          <div className="flex items-center gap-2">
            <button
              className="md:hidden text-2xl touch-target flex items-center text-earth-ink2"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="เมนู"
            >☰</button>
            {/* Logo mark */}
            <img src="/labventure/icon.png" alt="LabVenture" className="w-7 h-7 rounded-lg shrink-0 object-contain" />
            <span className="font-bold text-base tracking-wide text-earth-ink">LabVenture</span>
            <a
              href={mhxViewUrl()}
              title="กลับไปหน้า MHxView (BellBeast)"
              className="flex items-center gap-1 border border-earth-border rounded-lg px-2.5 py-1 text-xs font-medium text-earth-ink2 hover:bg-earth-DEFAULT/60 transition-colors ml-1 whitespace-nowrap"
            >↩ MHxView</a>
            {scenario && (
              <div className="flex items-center gap-1.5 border border-earth-border rounded-lg px-2.5 py-1 text-xs text-earth-ink2 ml-1">
                <span className={`w-2 h-2 rounded-full shrink-0 ${SCENARIO_COLORS[scenario.name] ?? 'bg-gray-400'}`} />
                สถานการณ์: {scenario.name}
              </div>
            )}
            <div className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs ml-1
              ${isEpidemic
                ? 'border-red-300 bg-red-100 text-red-700'
                : 'border-earth-border text-earth-ink3'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${isEpidemic ? 'bg-red-400' : 'bg-earth-border'}`} />
              โรคระบาด: {isEpidemic ? 'ใช่' : 'ไม่ใช่'}
            </div>
          </div>
          <div className="flex-1 overflow-hidden mx-4">
            {marqueeText && (
              <marquee className="text-xs text-earth-ink3" scrollamount="3">
                {marqueeText}
              </marquee>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl text-earth-ink2">🔔</span>
            {me?.avatarUrl && (
              <img
                src={me.avatarUrl}
                alt={me.name || ''}
                onError={e => { e.currentTarget.style.display = 'none'; }}
                className="w-8 h-8 rounded-full object-cover border-2 border-earth-border"
              />
            )}
            {me?.name && (
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold whitespace-nowrap text-earth-ink">{me.name}</span>
                <span className="text-xs text-earth-ink3 whitespace-nowrap">{me.position}</span>
              </div>
            )}
            {me?.exp && <TokenCountdown exp={me.exp} />}
            <button
              onClick={logout}
              className="text-xs bg-earth-DEFAULT/60 hover:bg-earth-DEFAULT border border-earth-border px-3 py-1.5 rounded-lg text-earth-ink2 transition-colors"
            >
              ออกจากระบบ
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — L2 panel, icon-strip collapsed, hover-expand */}
          <div
            onMouseEnter={() => setSidebarHover(true)}
            onMouseLeave={() => setSidebarHover(false)}
            className={`hidden md:flex flex-col shrink-0 bg-earth-card border-r border-earth-border transition-[width] duration-200 ease-out overflow-hidden z-20 relative ${sidebarHover ? 'w-52' : 'w-12'}`}
          >
            <nav className="flex flex-col gap-1 pt-2 overflow-y-auto flex-1 px-1">
              {NAV.map(n => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-2 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap
                     ${isActive
                       ? 'bg-brand-light/50 text-[#1A3A5C] border-l-[3px] border-brand font-semibold pl-[5px]'
                       : 'text-earth-ink2 hover:bg-earth-DEFAULT/60 border-l-[3px] border-transparent'}`
                  }
                >
                  <span className="shrink-0 w-6 text-center relative">
                    {n.icon}
                    {badges[n.page] > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center" title={BADGE_TITLE[n.page]}>{badges[n.page]}</span>}
                  </span>
                  <span className={`transition-opacity duration-150 ${sidebarHover ? 'opacity-100' : 'opacity-0'}`}>
                    {n.label}
                  </span>
                </NavLink>
              ))}
            </nav>
            <a
              href={mhxViewUrl()}
              title="กลับไปหน้า MHxView (BellBeast)"
              className="flex items-center gap-3 mx-1 mb-2 px-2 py-2.5 rounded-lg text-sm font-medium text-earth-ink2 hover:bg-earth-DEFAULT/60 border-l-[3px] border-transparent whitespace-nowrap"
            >
              <span className="shrink-0 w-6 text-center">↩</span>
              <span className={`transition-opacity duration-150 ${sidebarHover ? 'opacity-100' : 'opacity-0'}`}>MHxView</span>
            </a>
          </div>

          {/* Mobile menu overlay */}
          {menuOpen && (
            <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)}>
              <div className="absolute inset-0 bg-black/40" />
              <nav className="absolute left-0 top-0 bottom-0 w-64 bg-earth-card pt-16 px-3 flex flex-col gap-1 shadow-xl">
                {NAV.map(n => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium touch-target ${
                        isActive
                          ? 'bg-brand-light/50 text-[#1A3A5C] border-l-[3px] border-brand font-semibold'
                          : 'text-earth-ink2 hover:bg-earth-DEFAULT/60 border-l-[3px] border-transparent'
                      }`
                    }
                  >
                    <span>{n.icon}</span> {n.label}
                    {badges[n.page] > 0 && <span className="ml-auto min-w-5 px-1.5 rounded-full bg-red-600 text-white text-xs leading-5 text-center">{badges[n.page]}</span>}
                  </NavLink>
                ))}
                <a
                  href={mhxViewUrl()}
                  className="flex items-center gap-3 px-4 py-3 mt-2 rounded-lg text-sm font-medium touch-target text-earth-ink2 hover:bg-earth-DEFAULT/60 border-l-[3px] border-transparent border-t border-t-earth-border"
                >
                  <span>↩</span> กลับ MHxView
                </a>
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
