import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api.js';
import { mhxViewUrl } from '../utils/mhxView.js';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(null); // null = fetching
  const [showSuper, setShowSuper] = useState(false); // Ctrl+Shift+F12 reveals Super Admin bypass
  const navigate = useNavigate();
  const offline = stage === 0 || stage === 2; // AquaDAT unavailable → bypass mode

  useEffect(() => {
    get('/api/operator/stage')
      .then(d => setStage(d.stage))
      .catch(() => setStage(1));
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'F12') {
        e.preventDefault();
        setShowSuper(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await post('/api/auth/login', { username, password });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  // stage=0 only: Scientist / Operator bypass
  const bypassButtons = [
    { role: 'scientist', label: 'Scientist', desc: 'ทุกหน้า · ออกใบ/ติดตาม CAR', color: 'border-sky-300 text-sky-700 hover:bg-sky-50' },
    { role: 'operator',  label: 'Operator',  desc: 'รับสารเคมี/รายงาน/CAR · ตอบใบ CAR', color: 'border-green-300 text-green-700 hover:bg-green-50' },
  ];
  const superButton = { role: 'superadmin', label: 'Super Admin', desc: 'ทุกหน้า · ทุกสิทธิ์', color: 'border-red-300 text-red-700 hover:bg-red-50' };

  function bypassButton({ role, label, desc, color }) {
    return (
      <button
        key={role}
        type="button"
        onClick={() => handleBypass(role)}
        disabled={loading}
        className={`w-full border ${color} disabled:opacity-50 text-xs py-2 px-3 rounded-lg touch-target transition-colors flex items-center justify-between`}
      >
        <span className="font-medium">{label}</span>
        <span className="text-earth-ink3">{desc}</span>
      </button>
    );
  }

  async function handleBypass(role) {
    setLoading(true);
    setError('');
    try {
      await post('/api/auth/bypass', { role });
      navigate('/dashboard');
    } catch {
      setError('Bypass ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="bg-earth-DEFAULT rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">💧</div>
          <h1 className="text-2xl font-bold text-brand">LabVenture</h1>
          <p className="text-earth-ink2 text-sm mt-1">AquaDAT Scientist Recorder</p>
        </div>
        <a
          href={mhxViewUrl()}
          className="-mt-5 mb-6 mx-auto flex w-fit items-center gap-1 rounded-lg border border-earth-border px-3 py-1 text-xs font-medium text-earth-ink2 hover:bg-earth-card transition-colors"
        >↩ กลับไปหน้า MHxView</a>

        {/* stage=null: loading placeholder */}
        {stage === null && (
          <div className="text-center text-earth-ink3 text-sm py-4">กำลังตรวจสอบการเชื่อมต่อ...</div>
        )}

        {/* stage=0/2: offline — show bypass only */}
        {offline && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-center">
              <p className="text-red-700 font-semibold text-sm">⚠️ ระบบออฟไลน์</p>
              <p className="text-red-500 text-xs mt-0.5">AquaDAT ไม่พร้อมใช้งาน — เลือกบทบาทเพื่อเข้าใช้งาน</p>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}
            <div className="space-y-2">
              {bypassButtons.map(bypassButton)}
            </div>
          </div>
        )}

        {/* stage=1: normal AD login only — bypass hidden */}
        {stage !== null && !offline && (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-earth-ink mb-1">
                  AD Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full border border-earth-border rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand touch-target"
                  placeholder="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-earth-ink mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border border-earth-border rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand touch-target"
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand hover:bg-sky-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg touch-target transition-colors"
              >
                {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              </button>
            </form>

            <p className="text-center text-xs text-earth-ink3 mt-6">
              ใช้ AD username/password ของโรงงาน
            </p>
          </>
        )}

        {showSuper && (
          <div className="mt-4 pt-4 border-t border-dashed border-earth-border space-y-2">
            {bypassButton(superButton)}
          </div>
        )}
      </div>
    </div>
  );
}
