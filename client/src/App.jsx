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

function RequireAuth({ children }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => get('/api/auth/me'),
    retry: false,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen text-gray-500">กำลังโหลด...</div>
  );
  if (isError || !data?.ok) return <Navigate to="/login" replace />;
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
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="record" element={<Record />} />
        <Route path="car" element={<CARLog />} />
        <Route path="report" element={<Report />} />
        <Route path="config" element={<ConfigEditor />} />
        <Route path="chem-intake" element={<ChemIntake />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
