import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../api.js';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand to-sky-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">💧</div>
          <h1 className="text-2xl font-bold text-brand">LabVenture</h1>
          <p className="text-gray-500 text-sm mt-1">AquaDAT Scientist Recorder</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              AD Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand touch-target"
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand touch-target"
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

        <p className="text-center text-xs text-gray-400 mt-6">
          ใช้ AD username/password ของโรงงาน
        </p>

        <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
          <button
            type="button"
            onClick={async () => {
              setLoading(true);
              try {
                await post('/api/auth/bypass', {});
                navigate('/dashboard');
              } catch (err) {
                setError('Bypass ไม่สำเร็จ');
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="w-full border border-gray-300 text-gray-500 hover:bg-gray-50 text-sm py-2 rounded-lg touch-target transition-colors"
          >
            🧪 Dev Bypass (ทดสอบนอก Intranet)
          </button>
        </div>
      </div>
    </div>
  );
}
