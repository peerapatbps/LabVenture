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
import EventClass from './pages/EventClass.jsx';
import ProjectPlan from './pages/ProjectPlan.jsx';
import { PAGE_ROUTES, allowedPagesFor } from './config/pageAccess.js';

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

  // Role-based page access (bypass AND normal login with whitelist group) + partial-deploy hidden pages
  if (page) {
    const allowed = allowedPagesFor(data);
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
        <Route path="event-class"   element={<RequireAuth page="event-class">  <EventClass />    </RequireAuth>} />
        <Route path="pm"            element={<RequireAuth page="pm">           <ProjectPlan />   </RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
