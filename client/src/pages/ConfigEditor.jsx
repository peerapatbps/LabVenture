import React, { useState, useEffect, useContext, createContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, put, patch, del } from '../api.js';

// true = can perform actions; false = read-only (bypass mode)
const BypassCtx = createContext(true);

const SCENARIO_COLORS = {
  'ปกติ':       'bg-teal-500',
  'น้ำขุ่น':    'bg-amber-400',
  'สาหร่ายสูง': 'bg-red-400',
};

const GROUP_LABEL = { '1': 'นักวิทยาศาสตร์', '2': 'Operator', '3a': 'ผอ.กผจ.', '3b': 'ผอ.ฝผม.' };
const SUPERADMIN_NAME = 'นายพีรพัฒน์ สุขขารมย์';
const PREFIXES = ['นาย', 'นาง', 'น.ส.', 'ดร.นาย', 'ดร.นาง', 'ดร.น.ส.'];

// ── Epidemic toggle ───────────────────────────────────────────────────────

function EpidemicToggle() {
  const canAction = useContext(BypassCtx);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['epidemic'],
    queryFn: () => get('/api/scenarios/epidemic'),
  });
  const [saving, setSaving] = useState(false);
  const isEpidemic = !!data?.epidemic;

  async function toggle() {
    setSaving(true);
    try {
      await patch('/api/scenarios/epidemic', { epidemic: !isEpidemic });
      qc.invalidateQueries({ queryKey: ['epidemic'] });
      qc.invalidateQueries({ queryKey: ['active-scenario'] });
    } finally { setSaving(false); }
  }

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-gray-700">สถานการณ์โรคระบาด</span>
      <button
        onClick={toggle}
        disabled={isLoading || saving || !canAction}
        className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed
          ${isEpidemic ? 'bg-red-500 border-red-500' : 'bg-gray-200 border-gray-200'}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 mt-0.5
            ${isEpidemic ? 'translate-x-7' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
}

function MarqueeEditor() {
  const canAction = useContext(BypassCtx);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['marquee'],
    queryFn: () => get('/api/scenarios/marquee'),
  });
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync fetched value into local state once
  React.useEffect(() => {
    if (data?.marquee_text !== undefined) setText(data.marquee_text);
  }, [data?.marquee_text]);

  async function save() {
    setSaving(true);
    try {
      await patch('/api/scenarios/marquee', { marquee_text: text });
      qc.invalidateQueries({ queryKey: ['marquee'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-2 pt-2 border-t border-gray-100">
      <span className="text-sm font-medium text-gray-700">ข้อความวิ่ง (Header)</span>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <button
        onClick={save}
        disabled={saving || !canAction}
        className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saved ? '✓ บันทึกแล้ว' : saving ? 'กำลังบันทึก...' : 'บันทึก'}
      </button>
    </div>
  );
}

// ── Scenario tab ─────────────────────────────────────────────────────────

function ScenarioTab() {
  const canAction = useContext(BypassCtx);
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
      {/* สถานการณ์ระบบผลิต */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-800">สถานการณ์ระบบผลิต</h2>
        {isLoading ? <p className="text-sm text-gray-400">กำลังโหลด...</p> : (
          <>
            <select value={activeId} onChange={e => handleActivate(Number(e.target.value))}
              disabled={pending || !canAction}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 disabled:cursor-not-allowed">
              {(scenarios || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {activeScenario && (
              <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
                <span className={`w-3 h-3 rounded-full shrink-0 ${SCENARIO_COLORS[activeScenario.name] ?? 'bg-gray-400'}`} />
                <p className="text-sm font-medium text-gray-800">{activeScenario.name}</p>
                <span className="ml-auto text-xs text-gray-400">{activeScenario.thresholds?.length ?? 0} เกณฑ์</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* สถานการณ์โรคระบาด — single line toggle */}
      <div className="border-t border-gray-100 pt-4">
        <EpidemicToggle />
      </div>

      {/* ข้อความวิ่ง */}
      <MarqueeEditor />
    </div>
  );
}

// ── Admin badge toggle (with confirm) ────────────────────────────────────

function AdminBadge({ entry, onToggle, locked }) {
  const canAction = useContext(BypassCtx);
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
        {canAction && (
          <button onClick={() => setConfirming('revoke')}
            className="text-xs text-gray-400 hover:text-red-500 underline">ยกเลิก</button>
        )}
      </span>
    );
  }

  return (
    <button onClick={() => canAction && setConfirming('set')}
      disabled={!canAction}
      className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-400 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed">
      ตั้ง Admin
    </button>
  );
}

// ── Whitelist row ─────────────────────────────────────────────────────────

function WhitelistRow({ entry, onToggleAdmin, onDelete }) {
  const canAction = useContext(BypassCtx);
  const qc = useQueryClient();
  const isSuperadmin = entry.name === SUPERADMIN_NAME;
  const [editing, setEditing] = useState(false);
  const [posVal, setPosVal] = useState(entry.position_label || '');
  const [saving, setSaving] = useState(false);

  async function savePosition() {
    if (posVal === (entry.position_label || '')) { setEditing(false); return; }
    setSaving(true);
    try {
      await patch(`/api/car-admin/${entry.id}`, { position_label: posVal });
      qc.invalidateQueries({ queryKey: ['whitelist'] });
    } finally { setSaving(false); setEditing(false); }
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-sm font-medium text-gray-800">
        {entry.name}
        {isSuperadmin && <span className="ml-1 text-xs text-yellow-600">🔒</span>}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">{entry.dept_label || '—'}</td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {editing ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={posVal}
              onChange={e => setPosVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePosition(); if (e.key === 'Escape') setEditing(false); }}
              onBlur={savePosition}
              className="border border-blue-300 rounded px-1.5 py-0.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="เช่น นักวิทยาศาสตร์ 4 สคบ.ฝผม."
              disabled={saving}
            />
          </span>
        ) : (
          <span
            onClick={() => !isSuperadmin && canAction && setEditing(true)}
            className={`${!isSuperadmin && canAction ? 'cursor-pointer hover:text-blue-600 hover:underline' : ''}`}
          >
            {entry.position_label || <span className="text-gray-300">— คลิกเพื่อใส่ตำแหน่ง</span>}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <AdminBadge entry={entry} onToggle={onToggleAdmin} locked={isSuperadmin} />
      </td>
      {onDelete && (
        <td className="px-3 py-2 text-center">
          {!isSuperadmin && canAction && (
            <button onClick={() => onDelete(entry.id)} className="text-red-400 hover:text-red-600 text-xs">ลบ</button>
          )}
        </td>
      )}
    </tr>
  );
}

// ── Group 3 search + add ──────────────────────────────────────────────────

function Group3Section({ group_code, title, entries, onRefresh }) {
  const canAction = useContext(BypassCtx);
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
        dept_label: searchResult.position,
        position_label: searchResult.position,
        is_admin: 0,
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
              <th className="px-3 py-2 text-left">หน่วยงาน</th>
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
            <button onClick={handleSearch} disabled={searching || !empId.trim() || !canAction}
              className="px-4 py-2 bg-brand hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg">
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
              <button onClick={handleAdd} disabled={adding || !canAction}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2 rounded-lg">
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
  const canAction = useContext(BypassCtx);
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
          <button onClick={handleSync} disabled={syncing || !canAction}
            className="px-4 py-2 bg-brand hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg">
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
              <th className="px-3 py-2 text-left">ตำแหน่ง</th>
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
                      <th className="px-3 py-2 text-left">ตำแหน่ง</th>
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
  const canAction = useContext(BypassCtx);
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
    <button onClick={() => canAction && setConfirming(true)}
      disabled={!canAction}
      className="px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 disabled:opacity-40 disabled:cursor-not-allowed">
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

// ── CAR Setting tab ──────────────────────────────────────────────────────

const CAR_TEMPLATE_FIELDS = [
  { key: 'cw_turbid', label: 'CW Turbid — ความขุ่นน้ำกรอง' },
  { key: 'cw_pre_cl', label: 'CW Pre-Cl — คลอรีนก่อนกรอง' },
  { key: 'tw_turbid', label: 'TW Turbid — ความขุ่นน้ำประปา' },
  { key: 'tw_pos_cl', label: 'TW Pos-Cl — คลอรีนปลายท่อ' },
];

function CARSettingTab() {
  const canAction = useContext(BypassCtx);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['car-templates'],
    queryFn: () => get('/api/scenarios/car-templates'),
  });
  const [templates, setTemplates] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.car_templates) setTemplates(data.car_templates);
  }, [data?.car_templates]);

  async function save() {
    setSaving(true);
    try {
      await patch('/api/scenarios/car-templates', templates);
      qc.invalidateQueries({ queryKey: ['car-templates'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  if (isLoading) return <p className="text-sm text-gray-400 py-4">กำลังโหลด...</p>;

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-5">
      <div>
        <h2 className="font-semibold text-gray-800">ข้อความมาตรฐาน CAR</h2>
        <p className="text-xs text-gray-500 mt-0.5">ข้อความที่จะ generate อัตโนมัติในช่อง "เรื่องที่พบ" เมื่อกราฟแสดงสถานะ BAD</p>
      </div>
      <div className="space-y-4">
        {CAR_TEMPLATE_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <textarea
              value={templates[key] ?? ''}
              onChange={e => setTemplates(t => ({ ...t, [key]: e.target.value }))}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={saving || !canAction}
        className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saved ? '✓ บันทึกแล้ว' : saving ? 'กำลังบันทึก...' : 'บันทึก'}
      </button>
    </div>
  );
}

// ── Daily Report Settings tab ─────────────────────────────────────────────

const CHEM_FIELDS = [
  { key: 'alum_ton',     label: 'สารส้ม (Alum)',          unit: 'บาท/ตัน' },
  { key: 'pacl_ton',     label: 'PACl',                   unit: 'บาท/ตัน' },
  { key: 'chlorine_ton', label: 'คลอรีน (Chlorine)',      unit: 'บาท/ตัน' },
  { key: 'sludge_day',   label: 'ค่ากำจัดตะกอน (Sludge)', unit: 'บาท/วัน' },
];

const ENERGY_FIELDS = [
  { key: 'peak_price',    label: 'ราคา Peak',     unit: 'บาท/kWh' },
  { key: 'offpeak_price', label: 'ราคา Off-Peak', unit: 'บาท/kWh' },
  { key: 'ft_price',      label: 'ค่า Ft',        unit: 'บาท/kWh' },
  { key: 'max_energy',    label: 'Demand Charge', unit: 'บาท/เดือน' },
];

function NumberInput({ value, onChange, unit, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="any"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        disabled={disabled}
        className="w-36 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <span className="text-xs text-gray-400 shrink-0">{unit}</span>
    </div>
  );
}

function FieldRow({ label, value, onChange, unit, disabled }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-gray-700">{label}</label>
      <NumberInput value={value} onChange={onChange} unit={unit} disabled={disabled} />
    </div>
  );
}

function ReportSettingsTab() {
  const canAction = useContext(BypassCtx);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['report-settings'],
    queryFn: () => get('/api/scenarios/report-settings'),
  });

  const [chem, setChem] = useState({});
  const [energy, setEnergy] = useState({});
  const [rwCost, setRwCost] = useState(0);
  const [cwtArea, setCwtArea] = useState(48000);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setChem(data.chem_cost ?? {});
    setEnergy(data.energy_cost ?? {});
    setRwCost(data.rw_cost ?? 0);
    setCwtArea(data.cwt_area_m2 ?? 48000);
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/scenarios/report-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chem_cost: chem, energy_cost: energy, rw_cost: rwCost, cwt_area_m2: cwtArea }),
      });
      qc.invalidateQueries({ queryKey: ['report-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  if (isLoading) return <p className="text-sm text-gray-400 py-4">กำลังโหลด...</p>;

  return (
    <div className="space-y-5 max-w-xl">
      {/* Chemical cost */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-800">ต้นทุนสารเคมี</h2>
          <p className="text-xs text-gray-400 mt-0.5">ใช้คำนวณต้นทุน บาท/ลบ.ม. ในรายงานประจำวัน</p>
        </div>
        <div className="space-y-3">
          {CHEM_FIELDS.map(({ key, label, unit }) => (
            <FieldRow
              key={key}
              label={label}
              unit={unit}
              value={chem[key] ?? 0}
              onChange={v => setChem(c => ({ ...c, [key]: v }))}
              disabled={!canAction}
            />
          ))}
        </div>
      </div>

      {/* Energy cost */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-800">ต้นทุนพลังงาน</h2>
          <p className="text-xs text-gray-400 mt-0.5">ราคาค่าไฟ TOU — Peak 09:00–22:00</p>
        </div>
        <div className="space-y-3">
          {ENERGY_FIELDS.map(({ key, label, unit }) => (
            <FieldRow
              key={key}
              label={label}
              unit={unit}
              value={energy[key] ?? 0}
              onChange={v => setEnergy(e => ({ ...e, [key]: v }))}
              disabled={!canAction}
            />
          ))}
        </div>
      </div>

      {/* Raw water + tank */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
        <h2 className="font-semibold text-gray-800">ค่าคงที่ระบบ</h2>
        <div className="space-y-3">
          <FieldRow
            label="ต้นทุนน้ำดิบ (RW Cost)"
            unit="บาท/ลบ.ม."
            value={rwCost}
            onChange={setRwCost}
            disabled={!canAction}
          />
          <FieldRow
            label="พื้นที่หน้าตัดถัง CWT"
            unit="ม²"
            value={cwtArea}
            onChange={setCwtArea}
            disabled={!canAction}
          />
          <p className="text-xs text-gray-400 leading-relaxed">
            พื้นที่หน้าตัดถังเก็บน้ำใส (CWT) ใช้แปลง Δระดับน้ำ (ม.) → Δปริมาตร (ลบ.ม.)
            สำหรับคำนวณ Water Loss
          </p>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || !canAction}
        className="px-6 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saved ? '✓ บันทึกแล้ว' : saving ? 'กำลังบันทึก...' : 'บันทึก'}
      </button>
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
  const canAction = useContext(BypassCtx);
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
          disabled={syncing || !canAction}
          className="w-full bg-brand hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors"
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

// ── Module Test tab ──────────────────────────────────────────────────────

const EXCEL_TEST_CASES = [
  {
    id: 'excel-path',
    label: 'Excel Path — ตรวจ directory',
    desc: 'อ่าน paths.json → ตรวจว่า excel_data_dir เข้าถึงได้ (R/W)',
    tooltip: {
      problem: 'ถ้า excel_data_dir ใน paths.json ชี้ไปยัง network path ที่ไม่มีอยู่ excel_writer.py จะ crash โดยไม่มี error ที่อ่านได้',
      fix: 'GET /api/test/excel-path — อ่าน config แล้ว fs.accessSync ตรวจ R/W permission จริง',
      expect: 'แสดง configOk, excelDir ที่จะใช้จริง, dirOk = true และ usingFallback',
    },
  },
  {
    id: 'excel-fail',
    label: 'Excel Write Fail',
    desc: 'บังคับ excel fail ด้วย path ผิด → excel_queue ต้องรับ row',
    tooltip: {
      problem: 'ถ้า excel_writer.py crash (network path ไม่มีอยู่) ข้อมูลจะหายเงียบๆ ไม่มีการ retry',
      fix: 'ตั้ง excel_data_dir เป็น invalid path ชั่วคราว → run write → ตรวจ excel_queue',
      expect: 'Excel Queue มี row ใหม่ status=pending หลัง run',
    },
  },
  {
    id: 'excel-retry',
    label: 'Excel Retry Queue',
    desc: 'POST /api/test/excel-retry — retry excel_queue ด้วย path ปัจจุบัน',
    tooltip: {
      problem: 'excel_queue ที่ pending อยู่ต้องสามารถ retry ได้เมื่อ network กลับมา',
      fix: 'POST /api/test/excel-retry — loop retry ทุก pending/dead row',
      expect: 'row ที่สำเร็จเปลี่ยน status=success, ที่ fail เพิ่ม attempts',
    },
  },
  {
    id: 'excel-clear',
    label: 'Clear Excel Queue',
    desc: 'ล้าง success/dead ออกจาก excel_queue',
    tooltip: {
      problem: 'หลังทดสอบ excel_queue จะมีแถวสะสม',
      fix: 'DELETE WHERE status IN (success, dead)',
      expect: 'Excel Queue เหลือแค่ pending (ถ้ามี)',
    },
  },
];

const CONFIG_TEST_CASES = [
  {
    id: 'config-files',
    label: 'Config File Integrity',
    desc: 'ตรวจว่า config files ครบตาม list และ JSON parse ได้ทุกไฟล์',
    tooltip: {
      problem: 'ถ้าไฟล์ config ใดหาย หรือ JSON พัง server จะ crash แบบไม่ชัดเจนตอน startup',
      fix: 'GET /api/test/config-files — อ่านทุกไฟล์ใน REQUIRED_CONFIG_FILES แล้ว JSON.parse',
      expect: 'allOk=true, ทุก filename แสดง parseable=true',
    },
  },
];

const TEST_CASES = [
  {
    id: 'aquadat-fail',
    label: 'AquaDAT Write Fail',
    desc: 'เปิด force-fail แล้ว run write → queue ต้องรับ row ใหม่',
    tooltip: {
      problem: 'ถ้า AquaDAT GraphQL fail ระหว่าง POST /write/nodes ระบบเดิมจะ log แล้วข้ามโดยไม่แจ้ง client',
      fix: 'จับ error แล้ว insert row เข้า aquadat_queue และส่ง warnings.aquadat กลับใน response',
      expect: 'Queue State มี row ใหม่ status=pending, Log แสดง "write failed (ถูกต้อง)"',
    },
  },
  {
    id: 'seed-pending',
    label: 'Seed Pending Row',
    desc: 'ใส่ fake pending row ตรงๆ เพื่อทดสอบ badge UI',
    tooltip: {
      problem: 'ต้องการทดสอบ UI (badge สีเหลืองใน Record + banner ใน Dashboard) โดยไม่ต้องผ่าน submit form',
      fix: 'insert fake row โดยตรงเข้า aquadat_queue ด้วย status=pending',
      expect: 'Queue State มี row ใหม่, หน้า Record/Dashboard แสดง badge ภายใน 30 วิ',
    },
  },
  {
    id: 'seed-dead',
    label: 'Seed Dead Row',
    desc: 'ใส่ fake dead row (attempts=3) เพื่อทดสอบ dead state',
    tooltip: {
      problem: 'ต้องการเห็นว่า dead item แสดงสีแดงและ script_name ถูกต้องใน dashboard',
      fix: 'insert row ด้วย status=dead, attempts=3',
      expect: 'Queue State มี row สีแดง, Dashboard แสดงหัวข้อ "ส่งไม่สำเร็จ X ครั้ง"',
    },
  },
  {
    id: 'retry',
    label: 'Retry Queue',
    desc: 'เรียก POST /queue/retry ด้วย token ปัจจุบัน',
    tooltip: {
      problem: 'ต้องการยืนยันว่า retry loop ทำงานถูกต้อง — pending → success หรือ dead ตามจำนวนครั้ง',
      fix: 'POST /api/write/queue/retry ใช้ token ปัจจุบันส่งไป AquaDAT จริง',
      expect: 'row ที่ส่งสำเร็จเปลี่ยน status=success, badge หาย; ถ้ายัง fail attempts เพิ่ม 1',
    },
  },
  {
    id: 'clear-done',
    label: 'Clear success/dead',
    desc: 'ลบแถว success + dead ออกจาก queue (housekeeping)',
    tooltip: {
      problem: 'หลังทดสอบ queue จะมีแถวเก่าสะสม ต้องการล้าง success/dead ออกโดยไม่กระทบ pending',
      fix: 'DELETE WHERE status IN (success, dead)',
      expect: 'Queue State เหลือแค่แถว pending (ถ้ามี)',
    },
  },
  {
    id: 'clear-all',
    label: 'Clear ALL queue',
    desc: 'ล้าง queue ทั้งหมด รวม pending (reset)',
    tooltip: {
      problem: 'ต้องการ reset สภาพ queue กลับเป็นว่างเปล่าทั้งหมด',
      fix: 'DELETE FROM aquadat_queue ทุก row (มี confirm dialog ก่อน)',
      expect: 'Queue State ว่างเปล่า, badge หายจาก Record และ Dashboard',
    },
  },
];

const STATUS_COLOR = { pending: 'bg-amber-100 text-amber-800', dead: 'bg-red-100 text-red-700', success: 'bg-green-100 text-green-700' };

function RunTooltip({ tooltip, children }) {
  const [pos, setPos] = useState(null);
  const ref = React.useRef(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top, right: window.innerWidth - r.right });
  }

  return (
    <div ref={ref} className="relative" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && (
        <div
          style={{ position: 'fixed', top: pos.top - 8, right: pos.right, transform: 'translateY(-100%)', zIndex: 9999 }}
          className="w-72 pointer-events-none"
        >
          <div className="bg-gray-900 text-white rounded-xl shadow-xl p-3 space-y-2 text-xs">
            <div>
              <p className="text-gray-400 font-semibold uppercase tracking-wide text-[10px] mb-0.5">ปัญหา</p>
              <p className="text-gray-200 leading-relaxed">{tooltip.problem}</p>
            </div>
            <div>
              <p className="text-gray-400 font-semibold uppercase tracking-wide text-[10px] mb-0.5">วิธีแก้</p>
              <p className="text-green-300 leading-relaxed">{tooltip.fix}</p>
            </div>
            <div>
              <p className="text-gray-400 font-semibold uppercase tracking-wide text-[10px] mb-0.5">จะเห็นอะไร</p>
              <p className="text-amber-300 leading-relaxed">{tooltip.expect}</p>
            </div>
          </div>
          <div className="w-3 h-3 bg-gray-900 rotate-45 absolute right-4 -bottom-1.5" />
        </div>
      )}
    </div>
  );
}

function QueueTable({ rows, refetchFn, label }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{label} ({rows.length} rows)</h3>
        <button onClick={refetchFn} className="text-xs text-gray-400 hover:text-gray-600">↻ refresh</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-center py-6 text-sm text-gray-400">ว่างเปล่า</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-3 py-2">id</th>
                <th className="px-3 py-2">trans_dtm</th>
                <th className="px-3 py-2">attempts</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">last_error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono">{row.id}</td>
                  <td className="px-3 py-2">{row.trans_dtm}</td>
                  <td className="px-3 py-2 text-center">{row.attempts}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full font-semibold text-xs ${STATUS_COLOR[row.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-red-500 max-w-xs truncate">{row.last_error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TestCaseSection({ title, cases, running, onRun, accent = 'gray', canAction = true }) {
  const headerCls = accent === 'blue'
    ? 'bg-blue-900'
    : accent === 'green'
    ? 'bg-green-900'
    : 'bg-gray-800';
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className={`${headerCls} px-4 py-3`}>
        <h2 className="font-semibold text-white text-sm">{title}</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {cases.map(tc => (
          <div key={tc.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
            <div>
              <p className="text-sm font-semibold text-gray-800">{tc.label}</p>
              <p className="text-xs text-gray-400">{tc.desc}</p>
            </div>
            <RunTooltip tooltip={tc.tooltip}>
              <button
                onClick={() => onRun(tc.id)}
                disabled={!!running || !canAction}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                  ${tc.id.includes('clear') ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
              >
                {running === tc.id ? '⏳ รัน...' : '▶ Run'}
              </button>
            </RunTooltip>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlgaeFileTestSection({ addLog }) {
  const canAction = useContext(BypassCtx);
  const [pinging, setPinging] = useState(false);
  const [result, setResult] = useState(null);

  async function ping() {
    setPinging(true); setResult(null);
    try {
      const r = await get('/api/test/ping-file');
      setResult(r);
      addLog(
        `algae file: ${r.exists ? `พบไฟล์ (${(r.stat?.sizeBytes / 1024).toFixed(1)} KB)` : 'ไม่พบไฟล์'} → ${r.path}`,
        r.ok
      );
    } catch (e) {
      addLog(`algae file error: ${e.message}`, false);
    } finally { setPinging(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="bg-indigo-900 px-4 py-3">
        <h2 className="font-semibold text-white text-sm">Algae File Test</h2>
      </div>
      <div className="px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">ตรวจสอบไฟล์ Algae2569.xlsx</p>
            <p className="text-xs text-gray-400">ตรวจว่า algae_excel_path ใน paths.json ชี้ถูกต้อง ไฟล์มีอยู่และอ่าน/เขียนได้</p>
          </div>
          <button onClick={ping} disabled={pinging || !canAction}
            className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shrink-0">
            {pinging ? '⏳' : '▶ Ping'}
          </button>
        </div>
        {result && (
          <div className={`rounded-lg border px-3 py-2.5 text-xs font-mono space-y-1
            ${result.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            <p className="break-all font-semibold">{result.exists ? '✅ พบไฟล์' : '❌ ไม่พบไฟล์'}</p>
            <p className="break-all text-gray-600">{result.path}</p>
            {result.stat && (
              <p>
                {(result.stat.sizeBytes / 1024).toFixed(1)} KB ·
                R:{result.readable ? '✓' : '✗'} W:{result.writable ? '✓' : '✗'} ·
                แก้ไขล่าสุด {new Date(result.stat.mtime).toLocaleString('th-TH')}
              </p>
            )}
            {result.error && <p className="text-red-600">{result.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function ModuleTestTab() {
  const canAction = useContext(BypassCtx);
  const qc = useQueryClient();
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(null);
  const [excelPathResult, setExcelPathResult] = useState(null);
  const [configFilesResult, setConfigFilesResult] = useState(null);

  const { data: status, refetch } = useQuery({
    queryKey: ['test-status'],
    queryFn: () => get('/api/test/status'),
    refetchInterval: 5000,
  });

  const { data: excelQueueData, refetch: refetchExcelQueue } = useQuery({
    queryKey: ['test-excel-queue'],
    queryFn: () => get('/api/test/excel-queue'),
    refetchInterval: 5000,
  });

  const forceFail = status?.forceFail ?? false;
  const excelForceFail = status?.excelForceFail ?? false;
  const queue = status?.queue ?? [];
  const excelQueue = excelQueueData?.items ?? [];

  function addLog(msg, ok = true) {
    setLog(prev => [{ ts: new Date().toLocaleTimeString('th-TH'), msg, ok }, ...prev].slice(0, 30));
  }

  async function run(id) {
    setRunning(id);
    try {
      let r;
      // ── AquaDAT cases ──────────────────────────────────────────
      if (id === 'aquadat-fail') {
        await post('/api/test/force-fail', { enabled: true });
        addLog('force-fail ON');
        r = await post('/api/test/run-write', {});
        addLog(r.error ? `write failed (ถูกต้อง): ${r.error}` : 'write succeeded (force-fail ไม่ทำงาน?)', !!r.error);
        await post('/api/test/force-fail', { enabled: false });
        addLog('force-fail OFF');
      } else if (id === 'seed-pending') {
        await post('/api/test/seed-queue', { status: 'pending', attempts: 0 });
        addLog('seeded pending row');
      } else if (id === 'seed-dead') {
        await post('/api/test/seed-queue', { status: 'dead', attempts: 3 });
        addLog('seeded dead row (attempts=3)');
      } else if (id === 'retry') {
        r = await post('/api/write/queue/retry');
        addLog(`retry: สำเร็จ ${r.succeeded} / ล้มเหลว ${r.failed}`);
      } else if (id === 'clear-done') {
        await post('/api/test/clear-queue', { all: false });
        addLog('cleared success+dead rows');
      } else if (id === 'clear-all') {
        if (!confirm('ล้าง queue ทั้งหมด รวม pending?')) { setRunning(null); return; }
        await post('/api/test/clear-queue', { all: true });
        addLog('cleared ALL queue rows');

      // ── Excel cases ────────────────────────────────────────────
      } else if (id === 'excel-path') {
        r = await get('/api/test/excel-path');
        setExcelPathResult(r);
        const ok = r.configOk && r.dirOk;
        addLog(
          `excel-path: configOk=${r.configOk} dirOk=${r.dirOk} fallback=${r.usingFallback} → ${r.excelDir}`,
          ok
        );
        if (r.configError) addLog(`config error: ${r.configError}`, false);
        if (r.dirError)    addLog(`dir error: ${r.dirError}`, false);
      } else if (id === 'excel-fail') {
        await post('/api/test/excel-force-fail', { enabled: true });
        addLog('excel force-fail ON');
        r = await post('/api/test/run-excel-write', {});
        addLog(r.error ? `excel write failed (ถูกต้อง): ${r.error}` : 'excel write succeeded (force-fail ไม่ทำงาน?)', !!r.error);
        await post('/api/test/excel-force-fail', { enabled: false });
        addLog('excel force-fail OFF');
        refetchExcelQueue();
      } else if (id === 'excel-retry') {
        r = await post('/api/test/excel-retry');
        addLog(`excel-retry: สำเร็จ ${r.succeeded} / ล้มเหลว ${r.failed}`);
        for (const f of (r.fileChecks || [])) {
          addLog(`file ping: ${f.filePath} → ${f.fileExists ? '✓ พบไฟล์' : '✗ ไม่พบไฟล์'}`, f.fileExists);
        }
        refetchExcelQueue();
      } else if (id === 'excel-clear') {
        if (!confirm('ล้าง excel_queue ทั้งหมด รวม pending?')) { setRunning(null); return; }
        await post('/api/test/clear-excel-queue', { all: true });
        addLog('cleared ALL excel queue rows');
        refetchExcelQueue();

      // ── Config file cases ──────────────────────────────────────
      } else if (id === 'config-files') {
        r = await get('/api/test/config-files');
        setConfigFilesResult(r);
        const bad = r.results.filter(f => !f.parseable);
        addLog(
          r.allOk ? `config-files: ✓ ครบทุกไฟล์ (${r.results.length} files)` : `config-files: ❌ พบปัญหา ${bad.length} ไฟล์`,
          r.allOk
        );
      }

      qc.invalidateQueries({ queryKey: ['test-status'] });
      refetch();
    } catch (e) {
      addLog(`ERROR: ${e.message}`, false);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Force-fail banners */}
      {forceFail && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-bold text-red-700">🔴 AquaDAT Force-Fail เปิดอยู่ — write ทุกครั้งจะ fail</p>
          <button
            onClick={() => post('/api/test/force-fail', { enabled: false }).then(() => refetch())}
            disabled={!canAction}
            className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >ปิด</button>
        </div>
      )}
      {excelForceFail && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-bold text-orange-700">🟠 Excel Force-Fail เปิดอยู่ — excel write ทุกครั้งจะ fail</p>
          <button
            onClick={() => post('/api/test/excel-force-fail', { enabled: false }).then(() => refetch())}
            disabled={!canAction}
            className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded-lg hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >ปิด</button>
        </div>
      )}

      {/* AquaDAT test cases */}
      <TestCaseSection title="AquaDAT Queue Tests" cases={TEST_CASES} running={running} onRun={run} canAction={canAction} />

      {/* AquaDAT Queue state */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">AquaDAT Queue ({queue.length} rows)</h3>
          <button onClick={() => refetch()} className="text-xs text-gray-400 hover:text-gray-600">↻ refresh</button>
        </div>
        {queue.length === 0 ? (
          <p className="text-center py-6 text-sm text-gray-400">ว่างเปล่า</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2">id</th>
                  <th className="px-3 py-2">script_name</th>
                  <th className="px-3 py-2">trans_dtm</th>
                  <th className="px-3 py-2">attempts</th>
                  <th className="px-3 py-2">status</th>
                  <th className="px-3 py-2">last_error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {queue.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{row.id}</td>
                    <td className="px-3 py-2 font-mono text-gray-600">{row.script_name}</td>
                    <td className="px-3 py-2">{row.trans_dtm}</td>
                    <td className="px-3 py-2 text-center">{row.attempts}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full font-semibold text-xs ${STATUS_COLOR[row.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-red-500 max-w-xs truncate">{row.last_error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Excel test cases */}
      <TestCaseSection title="Excel Path & Queue Tests" cases={EXCEL_TEST_CASES} running={running} onRun={run} accent="blue" canAction={canAction} />

      {/* Excel path result */}
      {excelPathResult && (
        <div className={`rounded-xl border px-4 py-3 text-xs space-y-1 font-mono
          ${excelPathResult.configOk && excelPathResult.dirOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <p className="font-semibold text-sm">Excel Path Result</p>
          <p>configOk: <strong>{String(excelPathResult.configOk)}</strong>{excelPathResult.configError ? ` — ${excelPathResult.configError}` : ''}</p>
          <p>excelDir: <strong className="break-all">{excelPathResult.excelDir}</strong>{excelPathResult.usingFallback ? ' (local fallback)' : ''}</p>
          <p>dirOk: <strong>{String(excelPathResult.dirOk)}</strong>{excelPathResult.dirError ? ` — ${excelPathResult.dirError}` : ''}</p>
        </div>
      )}

      {/* Excel queue */}
      <QueueTable rows={excelQueue} refetchFn={refetchExcelQueue} label="Excel Queue" />

      {/* Config file test cases */}
      <TestCaseSection title="Config File Integrity" cases={CONFIG_TEST_CASES} running={running} onRun={run} accent="green" canAction={canAction} />

      {/* Config files result */}
      {configFilesResult && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className={`px-4 py-2.5 border-b text-sm font-semibold
            ${configFilesResult.allOk ? 'bg-green-50 border-green-100 text-green-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
            {configFilesResult.allOk ? '✅ Config files ครบทุกไฟล์' : `❌ พบปัญหา ${configFilesResult.results.filter(r => !r.parseable).length} ไฟล์`}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-3 py-2">filename</th>
                <th className="px-3 py-2 text-center">exists</th>
                <th className="px-3 py-2 text-center">parseable</th>
                <th className="px-3 py-2">error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {configFilesResult.results.map(f => (
                <tr key={f.filename} className={f.parseable ? '' : 'bg-red-50'}>
                  <td className="px-3 py-2 font-mono">{f.filename}</td>
                  <td className="px-3 py-2 text-center">{f.exists ? '✅' : '❌'}</td>
                  <td className="px-3 py-2 text-center">{f.parseable ? '✅' : '❌'}</td>
                  <td className="px-3 py-2 text-red-500 text-xs">{f.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Algae file test */}
      <AlgaeFileTestSection addLog={addLog} />

      {/* Log */}
      <div className="bg-gray-900 rounded-xl p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-gray-500">— รอ log —</p>
        ) : (
          log.map((l, i) => (
            <p key={i} className={l.ok ? 'text-green-400' : 'text-red-400'}>
              <span className="text-gray-500">[{l.ts}]</span> {l.msg}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export default function ConfigEditor() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'scenario');

  const { data: myRole } = useQuery({
    queryKey: ['myRole'],
    queryFn: () => get('/api/car-admin/my-role'),
    staleTime: 5 * 60 * 1000,
  });

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });
  // bypass active → read-only; normal login → can act
  const canAction = !(meData?.bypass);

  const isAdmin = myRole?.isAdmin;
  const isSuperadmin = myRole?.name === SUPERADMIN_NAME;

  const tabs = [
    { key: 'scenario',        label: 'สถานการณ์',         show: true },
    { key: 'car-setting',     label: '📋 CAR Setting',     show: true },
    { key: 'report-settings', label: '📊 รายงานประจำวัน',  show: true },
    { key: 'init',            label: '⬇ Init System',     show: true },
    { key: 'whitelist',       label: '⚙ Whitelist CAR',   show: isAdmin },
    { key: 'admins',          label: '🔒 Admin List',      show: isSuperadmin },
    { key: 'module-test',     label: '🧪 Module Test',     show: true },
  ].filter(t => t.show);

  const wideTab = tab === 'whitelist';

  return (
    <BypassCtx.Provider value={canAction}>
    <div className={`${wideTab ? 'max-w-[84rem]' : 'max-w-4xl'} mx-auto space-y-5`}>
      {!canAction && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800 font-medium">
          🔒 Bypass Mode — ดูได้อย่างเดียว ปุ่ม action ทั้งหมดถูก disable
        </div>
      )}
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

      {tab === 'scenario'        && <ScenarioTab />}
      {tab === 'car-setting'     && <CARSettingTab />}
      {tab === 'report-settings' && <ReportSettingsTab />}
      {tab === 'init'            && <InitSystemTab />}
      {tab === 'whitelist'   && isAdmin && <WhitelistTab />}
      {tab === 'admins'      && isSuperadmin && <AdminListTab />}
      {tab === 'module-test' && <ModuleTestTab />}
    </div>
    </BypassCtx.Provider>
  );
}
