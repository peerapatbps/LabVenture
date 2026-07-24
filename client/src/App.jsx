import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from './api.js';

import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Record from './pages/Record.jsx';
import CARLog from './pages/CARLog.jsx';
import Report from './pages/Report.jsx';
import ConfigEditor from './pages/ConfigEditor.jsx';
import ChemIntake from './pages/ChemIntake.jsx';
import OpDashboard from './pages/OpDashboard.jsx';
import OpRecord from './pages/OpRecord.jsx';

const ROLE_PAGES = {
  scientist:    null,
  operator:     ['op-dashboard', 'op-record', 'chem-intake', 'car', 'report'],
  executive_3a: ['car', 'report'],
  executive_3b: ['car', 'report'],
  observer:     null,
  superadmin:   null,
};

const PAGE_ROUTES = {
  dashboard: '/dashboard', record: '/record', 'chem-intake': '/chem-intake',
  car: '/car', report: '/report', config: '/config',
  'op-dashboard': '/op-dashboard', 'op-record': '/op-record',
};

function RequireAuth({ children, page }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => get('/api/auth/me'),
    retry: false,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen text-earth-ink2">กำลังโหลด...</div>
  );
  if (isError || !data?.ok) return <Navigate to="/login" replace />;

  // Role-based page access (bypass AND normal login with whitelist group)
  if (data.role && page) {
    const allowed = ROLE_PAGES[data.role] ?? null;
    if (allowed && !allowed.includes(page)) {
      const firstAllowed = PAGE_ROUTES[allowed[0]] || '/car';
      return <Navigate to={firstAllowed} replace />;
    }
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        <RequireAuth>
          <Layout />
        </RequireAuth>
      }>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"   element={<RequireAuth page="dashboard">  <Dashboard />    </RequireAuth>} />
        <Route path="record"      element={<RequireAuth page="record">     <Record />       </RequireAuth>} />
        <Route path="car"         element={<RequireAuth page="car">        <CARLog />       </RequireAuth>} />
        <Route path="report"      element={<RequireAuth page="report">     <Report />       </RequireAuth>} />
        <Route path="config"      element={<RequireAuth page="config">     <ConfigEditor /> </RequireAuth>} />
        <Route path="chem-intake"   element={<RequireAuth page="chem-intake">  <ChemIntake />    </RequireAuth>} />
        <Route path="op-dashboard"  element={<RequireAuth page="op-dashboard"> <OpDashboard />   </RequireAuth>} />
        <Route path="op-record"     element={<RequireAuth page="op-record">    <OpRecord />      </RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
