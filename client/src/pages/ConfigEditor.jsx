import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, put, patch, del } from '../api.js';

const SCENARIO_COLORS = {
  'ปกติ':       'bg-teal-500',
  'น้ำขุ่น':    'bg-amber-400',
  'สาหร่ายสูง': 'bg-red-400',
};

const GROUP_LABEL = { '1': 'นักวิทยาศาสตร์', '2': 'Operator', '3a': 'ผอ.กผจ.', '3b': 'ผอ.ฝผม.' };
const SUPERADMIN_NAME = 'นายพีรพัฒน์ สุขขารมย์';
const PREFIXES = ['นาย', 'นาง', 'น.ส.', 'ดร.นาย', 'ดร.นาง', 'ดร.น.ส.'];

// ── Scenario tab ─────────────────────────────────────────────────────────

function ScenarioTab() {
  const qc = useQueryClient();
  const { data: scenarios, isLoading } = useQuery({
    queryKey: ['scenarios-list'],
    queryFn: () => get('/api/scenarios'),
  });
  const { data: activeScenario } = useQuery({
    queryKey: ['active-scenario'],
    queryFn: () => get('/api/scenarios/active'),
  });
  const [pending, setPending] = useState(false);
  const activeId = scenarios?.find(s => s.active === 1)?.id ?? '';

  async function handleActivate(id) {
    if (!id) return;
    setPending(true);
    try {
      await put(`/api/scenarios/${id}/activate`);
      qc.invalidateQueries({ queryKey: ['scenarios-list'] });
      qc.invalidateQueries({ queryKey: ['active-scenario'] });
    } finally { setPending(false); }
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
      <h2 className="font-semibold text-gray-800">สถานการณ์การผลิต</h2>
      <p className="text-sm text-gray-500">เปลี่ยนสถานการณ์เพื่อปรับเกณฑ์สีเตือนค่าพารามิเตอร์</p>
      {isLoading ? <p className="text-sm text-gray-400">กำลังโหลด...</p> : (
        <div className="space-y-3">
          <select value={activeId} onChange={e => handleActivate(Number(e.target.value))}
            disabled={pending}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50">
            {(scenarios || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {activeScenario && (
            <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
              <span className={`w-3 h-3 rounded-full shrink-0 ${SCENARIO_COLORS[activeScenario.name] ?? 'bg-gray-400'}`} />
              <div>
                <p className="text-sm font-medium text-gray-800">{activeScenario.name}</p>
                <p className="text-xs text-gray-500">{activeScenario.description}</p>
              </div>
              <span className="ml-auto text-xs text-gray-400">{activeScenario.thresholds?.length ?? 0} เกณฑ์</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Admin badge toggle (with confirm) ────────────────────────────────────

function AdminBadge({ entry, onToggle, locked }) {
  const [confirming, setConfirming] = useState(false); // 'set' | 'revoke' | false

  if (locked) {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">⭐ Admin</span>;
  }

  if (confirming === 'set') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-xs text-gray-600">ยืนยัน?</span>
        <button onClick={() => { onToggle(entry, 1); setConfirming(false); }}
          className="px-1.5 py-0.5 rounded text-xs bg-yellow-500 text-white font-medium hover:bg-yellow-600">ใช่</button>
        <button onClick={() => setConfirming(false)}
          className="px-1.5 py-0.5 rounded text-xs bg-gray-200 text-gray-600 hover:bg-gray-300">ไม่</button>
      </span>
    );
  }

  if (confirming === 'revoke') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-xs text-gray-600">ยกเลิก Admin?</span>
        <button onClick={() => { onToggle(entry, 0); setConfirming(false); }}
          className="px-1.5 py-0.5 rounded text-xs bg-red-500 text-white font-medium hover:bg-red-600">ใช่</button>
        <button onClick={() => setConfirming(false)}
          className="px-1.5 py-0.5 rounded text-xs bg-gray-200 text-gray-600 hover:bg-gray-300">ไม่</button>
      </span>
    );
  }

  if (entry.is_admin) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">⭐ Admin</span>
        <button onClick={() => setConfirming('revoke')}
          className="text-xs text-gray-400 hover:text-red-500 underline">ยกเลิก</button>
      </span>
    );
  }

  return (
    <button onClick={() => setConfirming('set')}
      className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-400 hover:bg-gray-200">
      ตั้ง Admin
    </button>
  );
}

// ── Whitelist row ─────────────────────────────────────────────────────────

function WhitelistRow({ entry, onToggleAdmin, onDelete }) {
  const isSuperadmin = entry.name === SUPERADMIN_NAME;
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-sm font-medium text-gray-800">
        {entry.name}
        {isSuperadmin && <span className="ml-1 text-xs text-yellow-600">🔒</span>}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">{entry.dept_label || '—'}</td>
      <td className="px-3 py-2 text-center">
        <AdminBadge entry={entry} onToggle={onToggleAdmin} locked={isSuperadmin} />
      </td>
      {onDelete && (
        <td className="px-3 py-2 text-center">
          {!isSuperadmin && (
            <button onClick={() => onDelete(entry.id)} className="text-red-400 hover:text-red-600 text-xs">ลบ</button>
          )}
        </td>
      )}
    </tr>
  );
}

// ── Group 3 search + add ──────────────────────────────────────────────────

function Group3Section({ group_code, title, entries, onRefresh }) {
  const [empId, setEmpId] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [prefix, setPrefix] = useState('นาย');
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();

  const canAdd = entries.length < 5;

  async function handleSearch() {
    if (!empId.trim()) return;
    setSearching(true); setSearchResult(null); setSearchError('');
    try {
      const r = await post('/api/car-admin/search-emp', { emp_id: empId.trim() });
      if (!r.results?.length) { setSearchError('ไม่พบข้อมูลพนักงาน'); }
      else { setSearchResult(r.results[0]); }
    } catch (e) { setSearchError(e.message); }
    finally { setSearching(false); }
  }

  async function handleAdd() {
    if (!searchResult) return;
    setAdding(true);
    try {
      const fullName = prefix + searchResult.name_no_prefix;
      await post('/api/car-admin/manual', {
        name: fullName, group_code, shift: null,
        dept_label: searchResult.position, is_admin: 0,
      });
      setSearchResult(null); setEmpId('');
      qc.invalidateQueries({ queryKey: ['whitelist'] });
      onRefresh?.();
    } catch (e) { setSearchError(e.message); }
    finally { setAdding(false); }
  }

  async function handleToggleAdmin(entry, val) {
    await patch(`/api/car-admin/${entry.id}`, { is_admin: val });
    qc.invalidateQueries({ queryKey: ['whitelist'] });
  }

  async function handleDelete(id) {
    if (!confirm('ลบรายชื่อนี้?')) return;
    await del(`/api/car-admin/${id}`);
    qc.invalidateQueries({ queryKey: ['whitelist'] });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="bg-purple-50 px-4 py-3 border-b border-purple-100">
        <h3 className="font-semibold text-purple-900">{title}</h3>
        <p className="text-xs text-purple-600 mt-0.5">{entries.length}/5 คน</p>
      </div>

      {entries.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="px-3 py-2 text-left">ชื่อ-สกุล</th>
              <th className="px-3 py-2 text-left">ตำแหน่ง</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => <WhitelistRow key={e.id} entry={e} onToggleAdmin={handleToggleAdmin} onDelete={handleDelete} />)}
          </tbody>
        </table>
      ) : (
        <p className="text-center py-4 text-gray-400 text-sm">ยังไม่มีรายชื่อ</p>
      )}

      {canAdd && (
        <div className="border-t border-gray-100 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600">ค้นหาเพิ่ม (รหัสพนักงาน)</p>
          <div className="flex gap-2">
            <input value={empId} onChange={e => setEmpId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="เช่น 00102616"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand font-mono" />
            <button onClick={handleSearch} disabled={searching || !empId.trim()}
              className="px-4 py-2 bg-brand hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {searching ? '...' : 'ค้นหา'}
            </button>
          </div>
          {searchError && <p className="text-sm text-red-500">{searchError}</p>}
          {searchResult && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-3">
              <div className="text-sm space-y-1">
                <p><span className="text-gray-500 text-xs">รหัส:</span> <span className="font-mono font-medium">{searchResult.emp_id}</span></p>
                <p><span className="text-gray-500 text-xs">ชื่อ:</span> <span className="font-medium">{searchResult.name_no_prefix}</span></p>
                <p><span className="text-gray-500 text-xs">ตำแหน่ง:</span> {searchResult.position}</p>
                <p><span className="text-gray-500 text-xs">หน่วยงาน:</span> {searchResult.dept}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-600 font-medium">คำนำหน้าชื่อ</p>
                <div className="flex flex-wrap gap-2">
                  {PREFIXES.map(p => (
                    <label key={p} className="flex items-center gap-1 text-sm cursor-pointer">
                      <input type="radio" name={`prefix-${group_code}`} value={p} checked={prefix === p}
                        onChange={() => setPrefix(p)} className="accent-brand" />
                      {p}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400">ชื่อที่จะบันทึก: <strong>{prefix + searchResult.name_no_prefix}</strong></p>
              </div>
              <button onClick={handleAdd} disabled={adding}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg">
                {adding ? 'กำลังเพิ่ม...' : `+ เพิ่มเข้า${title}`}
              </button>
            </div>
          )}
        </div>
      )}
      {!canAdd && (
        <p className="text-center py-2 text-xs text-gray-400 border-t border-gray-100">ครบ 5 คนแล้ว</p>
      )}
    </div>
  );
}

// ── Whitelist tab ─────────────────────────────────────────────────────────

function WhitelistTab() {
  const qc = useQueryClient();
  const { data: whitelist = [], isLoading, refetch } = useQuery({
    queryKey: ['whitelist'],
    queryFn: () => get('/api/car-admin/whitelist'),
  });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const g1 = whitelist.filter(e => e.group_code === '1');
  const g2s = [1, 2, 3, 4].map(s => whitelist.filter(e => e.group_code === '2' && e.shift === s));
  const g3a = whitelist.filter(e => e.group_code === '3a');
  const g3b = whitelist.filter(e => e.group_code === '3b');

  async function handleSync() {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await post('/api/car-admin/sync', {});
      setSyncMsg(`✅ Sync สำเร็จ: ${r.synced} รายชื่อ${r.errors?.length ? ` (${r.errors.length} org ล้มเหลว)` : ''}`);
      qc.invalidateQueries({ queryKey: ['whitelist'] });
    } catch (e) { setSyncMsg(`❌ ${e.message}`); }
    finally { setSyncing(false); }
  }

  async function handleToggleAdmin(entry, val) {
    await patch(`/api/car-admin/${entry.id}`, { is_admin: val });
    qc.invalidateQueries({ queryKey: ['whitelist'] });
  }

  if (isLoading) return <p className="text-sm text-gray-400 py-4">กำลังโหลด...</p>;

  return (
    <div className="space-y-6">
      {/* Sync EHR */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold text-gray-800">Sync จาก EHR (กลุ่ม 1 + 2)</h2>
            <p className="text-xs text-gray-500 mt-0.5">ดึงรายชื่อพนักงานล่าสุดจาก ehr.mwa.co.th</p>
          </div>
          <button onClick={handleSync} disabled={syncing}
            className="px-4 py-2 bg-brand hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {syncing ? 'กำลัง Sync...' : '🔄 Sync EHR'}
          </button>
        </div>
        {syncMsg && <p className="text-sm mt-3">{syncMsg}</p>}
      </div>

      {/* Group 1 */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-blue-50 px-4 py-3 border-b border-blue-100">
          <h3 className="font-semibold text-blue-900">กลุ่ม 1 — นักวิทยาศาสตร์ / Document Control</h3>
          <p className="text-xs text-blue-600 mt-0.5">{g1.length} คน · เห็น CAR ทั้งหมด · ออกใบได้</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="px-3 py-2 text-left">ชื่อ-สกุล</th>
              <th className="px-3 py-2 text-left">หน่วยงาน</th>
              <th className="px-3 py-2">Admin</th>
            </tr>
          </thead>
          <tbody>
            {g1.map(e => <WhitelistRow key={e.id} entry={e} onToggleAdmin={handleToggleAdmin} />)}
          </tbody>
        </table>
        {g1.length === 0 && <p className="text-center py-3 text-gray-400 text-sm">ยังไม่มีรายชื่อ — กด Sync EHR</p>}
      </div>

      {/* Group 2 */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-800">กลุ่ม 2 — Operator (4 ผลัด)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {g2s.map((members, i) => {
            const shift = i + 1;
            const deptLabel = members[0]?.dept_label || `สคน${shift}กผจ.ฝผม.`;
            return (
              <div key={shift} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="bg-green-50 px-4 py-3 border-b border-green-100">
                  <h3 className="font-semibold text-green-900">ผลัด {shift}</h3>
                  <p className="text-xs text-green-600 mt-0.5">{deptLabel} · {members.length} คน</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500">
                      <th className="px-3 py-2 text-left">ชื่อ-สกุล</th>
                      <th className="px-3 py-2 text-left">หน่วยงาน</th>
                      <th className="px-3 py-2">Admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(e => <WhitelistRow key={e.id} entry={e} onToggleAdmin={handleToggleAdmin} />)}
                  </tbody>
                </table>
                {members.length === 0 && <p className="text-center py-3 text-gray-400 text-sm">ยังไม่มีรายชื่อ</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Group 3 */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-800">กลุ่ม 3 — ผู้บริหาร</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Group3Section group_code="3a" title="ผอ.กผจ. (อนุมัติ Step 2)" entries={g3a} onRefresh={refetch} />
          <Group3Section group_code="3b" title="ผอ.ฝผม. (อนุมัติปิด Step 5)" entries={g3b} onRefresh={refetch} />
        </div>
      </div>
    </div>
  );
}

// ── Admin list tab (superadmin only) ──────────────────────────────────────

function KickButton({ ids, onKick }) {
  const [confirming, setConfirming] = useState(false);
  const [kicking, setKicking] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-xs text-gray-600">ถอด Admin?</span>
        <button
          onClick={async () => {
            setKicking(true);
            await onKick(ids);
            setConfirming(false);
            setKicking(false);
          }}
          disabled={kicking}
          className="px-1.5 py-0.5 rounded text-xs bg-red-500 text-white font-medium hover:bg-red-600 disabled:opacity-50">
          {kicking ? '...' : 'ใช่'}
        </button>
        <button onClick={() => setConfirming(false)}
          className="px-1.5 py-0.5 rounded text-xs bg-gray-200 text-gray-600 hover:bg-gray-300">ไม่</button>
      </span>
    );
  }

  return (
    <button onClick={() => setConfirming(true)}
      className="px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-500 hover:bg-red-100 border border-red-200">
      Kick
    </button>
  );
}

function AdminListTab() {
  const qc = useQueryClient();
  const { data: whitelist = [], isLoading } = useQuery({
    queryKey: ['whitelist'],
    queryFn: () => get('/api/car-admin/whitelist'),
  });

  if (isLoading) return <p className="text-sm text-gray-400 py-4">กำลังโหลด...</p>;

  const admins = whitelist.filter(e => e.is_admin === 1);

  // Group by name to collapse multi-group entries; collect all IDs
  const byName = {};
  for (const e of admins) {
    if (!byName[e.name]) byName[e.name] = { ...e, groups: [], ids: [] };
    byName[e.name].groups.push(e.group_code);
    byName[e.name].ids.push(e.id);
    if (e.synced_at) byName[e.name].synced_at = e.synced_at;
  }
  const rows = Object.values(byName);

  async function handleKick(ids) {
    await Promise.all(ids.map(id => patch(`/api/car-admin/${id}`, { is_admin: 0 })));
    qc.invalidateQueries({ queryKey: ['whitelist'] });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-yellow-50 px-4 py-3 border-b border-yellow-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-yellow-900">Admin Whitelist</h2>
            <p className="text-xs text-yellow-700 mt-0.5">รายชื่อที่มี badge Admin ทั้งหมด · {rows.length} คน</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-center py-6 text-gray-400 text-sm">ยังไม่มี Admin</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 text-left">
                <th className="px-4 py-2">ชื่อ-สกุล</th>
                <th className="px-4 py-2">กลุ่ม</th>
                <th className="px-4 py-2">หน่วยงาน</th>
                <th className="px-4 py-2">สิทธิ์ Admin</th>
                <th className="px-4 py-2">Synced จาก EHR</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isSuperadmin = r.name === SUPERADMIN_NAME;
                const hasEhr = !!r.synced_at;
                const isActive = isSuperadmin || hasEhr;
                return (
                  <tr key={r.name} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      {r.name}
                      {isSuperadmin && <span className="ml-1 text-yellow-500 text-xs">🔒</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {r.groups.map(g => GROUP_LABEL[g] || g).join(', ')}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{r.dept_label || '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {isActive ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">✅ ใช้งานได้</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">❌ ไม่ผ่านเงื่อนไข</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {r.synced_at ? new Date(r.synced_at).toLocaleDateString('th-TH') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {!isSuperadmin && <KickButton ids={r.ids} onKick={handleKick} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">เงื่อนไขสิทธิ์ Admin</p>
        <p>✅ ใช้งานได้ = มี badge Admin <strong>AND</strong> ชื่อถูก sync จาก EHR (หรือเป็น Superadmin)</p>
        <p>❌ ไม่ผ่านเงื่อนไข = มี badge แต่ชื่อไม่ถูก sync จาก EHR → อาจย้ายออกจากหน่วยงานแล้ว</p>
      </div>
    </div>
  );
}

// ── Init System tab ──────────────────────────────────────────────────────

const AQUADAT_GROUPS = [
  { key: '',        label: 'ทั้งหมด (ทุกกลุ่ม)' },
  { key: 'raw',     label: 'กลุ่มน้ำดิบ' },
  { key: 'prod',    label: 'กลุ่มน้ำระบบผลิต' },
  { key: 'tap',     label: 'กลุ่มน้ำประปา' },
  { key: 'special', label: 'กลุ่มพิเศษ' },
];

function InitSystemTab() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [group, setGroup] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleSync() {
    setSyncing(true); setResult(null); setError('');
    try {
      const body = { date };
      if (group) body.group = group;
      const r = await post('/api/aquadat/sync', body);
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-5">
        <div>
          <h2 className="font-semibold text-gray-800">Init System — ดึงข้อมูลจาก AquaDAT</h2>
          <p className="text-sm text-gray-500 mt-1">
            ใช้ตอนเปิดระบบครั้งแรก หรือหลัง reboot — ดึงค่าที่มีอยู่แล้วใน AquaDAT มาลง Daily DB
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600">วันที่</label>
            <input
              type="date"
              value={date}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600">กลุ่มพารามิเตอร์</label>
            <select
              value={group}
              onChange={e => setGroup(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {AQUADAT_GROUPS.map(g => (
                <option key={g.key} value={g.key}>{g.label}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-full bg-brand hover:bg-sky-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
        >
          {syncing ? '⏳ กำลังดึงข้อมูล...' : '⬇ Init — ดึงข้อมูล AquaDAT เข้า DB'}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            ❌ {error}
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 space-y-2">
            <p className="font-semibold text-green-800">✅ Sync สำเร็จ</p>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="bg-white rounded-lg py-2 border border-green-100">
                <p className="text-2xl font-bold text-gray-800">{result.configsFetched}</p>
                <p className="text-xs text-gray-500">configID ที่ส่ง</p>
              </div>
              <div className="bg-white rounded-lg py-2 border border-green-100">
                <p className="text-2xl font-bold text-green-700">{result.inserted}</p>
                <p className="text-xs text-gray-500">ค่าที่บันทึก</p>
              </div>
              <div className="bg-white rounded-lg py-2 border border-green-100">
                <p className="text-2xl font-bold text-gray-400">{result.skipped}</p>
                <p className="text-xs text-gray-500">ข้ามค่าว่าง</p>
              </div>
            </div>
            <p className="text-xs text-green-700">วันที่: {result.date} · dashboard และ record จะแสดงสถานะอัปเดตทันที</p>
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">หมายเหตุ</p>
        <p>• ค่าที่ดึงได้จะเขียนทับค่าเดิมใน DB (INSERT OR REPLACE)</p>
        <p>• ค่า 0 จาก AquaDAT จะถือว่า "ยังไม่มีข้อมูล" (ไม่นับเป็น done)</p>
        <p>• Daily DB จะ reset เมื่อนักวิทย์ยืนยันสร้างรายงาน ไม่ใช่ตามรอบ 24 ชั่วโมง</p>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export default function ConfigEditor() {
  const [tab, setTab] = useState('scenario');

  const { data: myRole } = useQuery({
    queryKey: ['myRole'],
    queryFn: () => get('/api/car-admin/my-role'),
    staleTime: 5 * 60 * 1000,
  });

  const isAdmin = myRole?.isAdmin;
  const isSuperadmin = myRole?.name === SUPERADMIN_NAME;

  const tabs = [
    { key: 'scenario', label: 'สถานการณ์', show: true },
    { key: 'init',     label: '⬇ Init System',  show: true },
    { key: 'whitelist', label: '⚙ Whitelist CAR', show: isAdmin },
    { key: 'admins', label: '🔒 Admin List', show: isSuperadmin },
  ].filter(t => t.show);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Config</h1>
        <div className="flex gap-2 flex-wrap">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === t.key ? 'bg-brand text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'scenario' && <ScenarioTab />}
      {tab === 'init' && <InitSystemTab />}
      {tab === 'whitelist' && isAdmin && <WhitelistTab />}
      {tab === 'admins' && isSuperadmin && <AdminListTab />}
    </div>
  );
}
