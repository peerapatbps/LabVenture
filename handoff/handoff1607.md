# Handoff — 16 July 2026
_อัปเดตล่าสุด: Session 4 (16 Jul 2026)_

---

## Project Overview

Two separate web applications that work together:

| App | Stack | Port | Notes |
|---|---|---|---|
| **BellBeast** | ASP.NET Core Razor Pages (C#) | `localhost:443` | Main shell; proxies `/labventure/*` to LabVenture |
| **LabVenture** | React + Vite + TanStack Query (client) / Express.js (server) | `localhost:3001` | Accessed via BellBeast proxy |

LabVenture production build uses `base: '/labventure'` (Vite config) so all API calls route as `/labventure/api/...` through BellBeast → LabVenture.

Working directories:
- LabVenture: `C:\Users\peera\OneDrive\Desktop\LabVenture`
- Client: `C:\Users\peera\OneDrive\Desktop\LabVenture\client`
- Server: `C:\Users\peera\OneDrive\Desktop\LabVenture\server`

Build command: `cd client && npm run build` → ผลไปที่ `client/dist` แล้ว BellBeast serve อัตโนมัติ (ไม่ต้อง restart)

URL ทดสอบ OpRecord: `http://localhost:443/labventure/op-record?station=RWS1`

---

## Two Independent Bypass Systems

### BellBeast Bypass (`bb_bypass_role` cookie)
- **Non-httpOnly** cookie, readable from JS
- Set via `POST /api/bypass/set?role=xxx`, cleared via `POST /api/bypass/clear`
- Roles use **hyphens**: `scientist`, `operator`, `executive-3a`, `executive-3b`, `observer`, `superadmin`
- Defined in `BellBeast/Program.cs` and `BellBeast/Pages/Shared/_Layout.cshtml`
- Exposes globals: `window.__bypassRole`, `window.__bypassCarStages`
- Dispatches `bb:bypass-changed` custom DOM event on role change
- Kills Aquadat API calls (early-return guards in Program.cs)

### LabVenture Bypass (`aquadat_token` JWT cookie)
- **httpOnly** cookie — not readable from JS
- Set via `POST /labventure/api/auth/bypass { role }` (Login page "Dev Bypass" buttons)
- Decoded by `GET /labventure/api/auth/me` → returns `{ ok: true, role, bypass: true, name }`
- Roles use **underscores**: `scientist`, `operator`, `executive_3a`, `executive_3b`, `observer`, `superadmin`
- Defined in `LabVenture/server/routes/auth.js`
- Page access controlled via `ROLE_PAGES` in `LabVenture/client/src/App.jsx`

**Critical rule**: LabVenture components must derive bypass state from `useQuery(['me'])` → `me.bypass && me.role`, NOT from reading `bb_bypass_role` cookie (which is always null in LabVenture context).

---

## Completed Work — All Sessions

### Session 1: `/labventure/chem-intake` — Role-restricted buttons

**File**: `LabVenture/client/src/pages/ChemIntake.jsx`

- `canSaveTop = !bypassRole || bypassRole === 'operator' || bypassRole === 'superadmin'`
- `canSampling = !bypassRole || bypassRole === 'scientist' || bypassRole === 'superadmin'`
- บันทึก (Top zone) disabled unless operator or superadmin bypass
- รับ Sampling (Bottom zone) disabled unless scientist or superadmin bypass
- **TDZ fix**: `bypassRole` derivation must come AFTER `const me = meData` in function body

### Session 2: `/labventure/record` — Disable บันทึก in all bypass modes

**File**: `LabVenture/client/src/pages/Record.jsx`

- Added `useQuery(['me'])` hook → `bypassRole = (me?.bypass && me?.role) ? me.role : null`
- `canRecord = !bypassRole` — any bypass role → cannot record
- Main submit button: `disabled={mutation.isPending || !canSubmit || !canRecord}`
- `handleSubmit()`: early return `if (!canRecord) return`
- Confirm dialog "ยืนยันบันทึก" button: `disabled={!canRecord}`
- `handleConfirm()`: early return `if (!canRecord) return`
- `AlgaeSpeciesPanel` receives `canRecord` prop → บันทึกสาหร่าย button disabled
- Rule: **any bypass role → cannot record**, regardless of time slot or stage

### Session 2: `/labventure/config` — Read-only in all bypass modes

**File**: `LabVenture/client/src/pages/ConfigEditor.jsx`

- Added `BypassCtx = createContext(true)` at top of file
- `ConfigEditor` fetches `me` via `useQuery(['me'])`, derives `canAction = !(me?.bypass)`
- Wraps entire UI in `<BypassCtx.Provider value={canAction}>`
- Shows amber banner "🔒 Bypass Mode — ดูได้อย่างเดียว" when bypass active
- All action components use `useContext(BypassCtx)`:

| Component | Disabled elements |
|---|---|
| EpidemicToggle | toggle button |
| MarqueeEditor | บันทึก |
| ScenarioTab | select dropdown |
| CARSettingTab | บันทึก |
| WhitelistTab | Sync EHR |
| Group3Section | ค้นหา, เพิ่ม |
| WhitelistRow | inline position edit, ลบ |
| AdminBadge | ตั้ง/ยกเลิก Admin |
| KickButton | Kick |
| InitSystemTab | Init button |
| TestCaseSection | all Run buttons |
| AlgaeFileTestSection | Ping |
| ModuleTestTab | close force-fail banners |

### Session 3: Normal login — Role-based page access from whitelist

**Goal**: Normal login users are restricted to the same pages as their bypass counterpart based on whitelist `group_code`, but action buttons are **not** restricted (buttons remain fully clickable).

#### `LabVenture/server/routes/auth.js`

Added at top:
```js
const { getDb } = require('../services/db');
const SUPERADMIN_NAME = process.env.SUPERADMIN_NAME || 'นายพีรพัฒน์ สุขขารมย์';
const GROUP_ROLE_MAP = { '1': 'scientist', '2': 'operator', '3a': 'executive_3a', '3b': 'executive_3b' };
```

In `GET /me` for non-bypass tokens, after `fetchUserProfile(token)`:
```js
let role = null;
if (profile?.name) {
  try {
    const db = getDb();
    const entries = db.all('SELECT group_code, is_admin, synced_at FROM car_whitelist WHERE name = ?', [profile.name]);
    const isAdmin = profile.name === SUPERADMIN_NAME || entries.some(e => e.is_admin === 1 && e.synced_at != null);
    if (!isAdmin && entries.length > 0) {
      const groups = entries.map(e => e.group_code);
      const primary = groups.find(g => g === '3a' || g === '3b') || groups[0] || null;
      role = GROUP_ROLE_MAP[primary] || null;
    }
  } catch { /* DB not ready or whitelist empty — no restriction */ }
}
```

Response now includes `role` (non-null only for whitelist members who are not admin/superadmin).

#### `LabVenture/client/src/App.jsx`

Changed `RequireAuth` guard condition from:
```js
if (data.bypass && page) {
```
to:
```js
if (data.role && page) {
```

This applies `ROLE_PAGES` to **both** bypass and normal login users when `data.role` is set. If `role` is `null` (superadmin, isAdmin, not-in-whitelist), no restriction applies.

#### Access matrix (after Session 3)

| Persona | Normal `role` from `/me` | Pages allowed | Action buttons |
|---|---|---|---|
| isAdmin badge (synced) | `null` | All | All |
| Superadmin name | `null` | All | All |
| Not in whitelist | `null` | All | All |
| Group '1' (นักวิทยาศาสตร์) | `'scientist'` | All (ROLE_PAGES=null) | All |
| Group '2' (Operator) | `'operator'` | chem-intake, car, report | All |
| Group '3a' (ผอ.กผจ.) | `'executive_3a'` | car, report | All |
| Group '3b' (ผอ.ฝผม.) | `'executive_3b'` | car, report | All |

Action restriction (`canRecord`, `canSaveTop`, `canSampling`, `canAction`) remains gated on `me.bypass`, so normal login users are **never** restricted from buttons regardless of group.

### Session 4: `/labventure/op-record` — Excel-like Table UI (OpRecord)

Feature: RecordingTable — Excel-like editable grid สำหรับ operator บันทึกค่าพารามิเตอร์ตาม station/topic/slot
รายละเอียด copy/paste, marching ants, keyboard nav, TEXT listbox, focus fix ดูใน `handoff\handoff1407.md`

#### Bug #1 — Numeric cell validation (ไม่ validate ก่อน commit)

**ปัญหา**: เมื่อผู้ใช้พิมพ์ค่าที่ไม่สมบูรณ์เช่น `-` หรือ `.` แล้วกด Enter/Tab/blur — ฟังก์ชัน `formatAndCommit` เดิมไม่ตรวจว่า `parseFloat(raw)` เป็น NaN หรือไม่ ค่า invalid จึงถูก commit เข้า `dirtyValues` และถูก POST ไปที่ server ได้

**Root Cause**:
```js
// เดิม — ไม่มีการ check NaN
function formatAndCommit(p, slot) {
  const raw = getVal(p.configparam_id, slot);
  if (raw === '' || raw == null) return;
  const formatted = formatDisplayVal(raw, p.type);
  if (formatted !== String(raw)) {
    onCellChange(topic.topic, p.configparam_id, slot, formatted);
  }
}
```
`formatDisplayVal('-', 'FLOAT(2)')` → `parseFloat('-')` = NaN → returns raw `'-'` → ค่า `'-'` ถูก commit ไป

**วิธีแก้ (แก้แล้ว)**:
```js
function formatAndCommit(p, slot) {
  const raw = getVal(p.configparam_id, slot);
  if (raw === '' || raw == null) return;
  const t = (p.type || '').trim();
  const isNumeric = t === 'INT' || t.startsWith('FLOAT(');
  if (isNumeric) {
    const num = parseFloat(raw);
    if (isNaN(num)) {
      onCellChange(topic.topic, p.configparam_id, slot, '');
      return;
    }
  }
  const formatted = formatDisplayVal(raw, p.type);
  if (formatted !== String(raw)) {
    onCellChange(topic.topic, p.configparam_id, slot, formatted);
  }
}
```

**Gotcha**: `onChange` filter ด้วย regex แล้ว แต่ไม่ครอบ case `-` เพียงตัวเดียว (valid character ตาม regex แต่ไม่ใช่ตัวเลขที่ parseFloat ได้) · Text cells (TEXT{...}) ไม่เข้า `formatAndCommit` อยู่แล้ว (จัดการผ่าน `<select>` แยก)

#### Bug #2 — Dropdown/select ปิดเองหลัง history endpoint return ข้อมูล

**ปัญหา**: เมื่อ operator เปิด TEXT cell (listbox `<select size>` เปิดอยู่) แล้ว history data โหลดเสร็จจาก `/api/operator/history` — listbox ปิดเองโดยที่ยังไม่ได้เลือกค่า

**Root Cause — Chain of events**:
```
React Query refetches opNodes (background, refetchOnWindowFocus=true หรือ stale)
  → opNodes ได้ object reference ใหม่
  → stationDef = opNodes?.stations?.find(...) ได้ object reference ใหม่
  → useEffect([activeStation, stationDef]) fire
  → setActiveTopic(stationDef.topics[0].topic)   ← รีเซ็ต topic ทุกครั้ง!
  → activeTopic เปลี่ยน → currentTopic เปลี่ยน
  → RecordingTable re-renders กับ topic prop ใหม่
  → useEffect([topic.topic]) fire ใน RecordingTable
  → setEditCell(null)                             ← SELECT ปิด!
  → setCopiedRange(null)                          ← marching ants หาย!
```

**วิธีแก้ (แก้แล้ว)** — แยก `useEffect` เป็น 2 effects:
```js
// Effect 1: reset เฉพาะเมื่อ station เปลี่ยน
useEffect(() => {
  setActiveTopic(null);
}, [activeStation]); // eslint-disable-line

// Effect 2: set first topic เมื่อ stationDef load แต่ preserve topic ถ้ายัง valid อยู่
useEffect(() => {
  if (!stationDef) return;
  setActiveTopic(prev => {
    if (prev && stationDef.topics?.some(t => t.topic === prev)) return prev;
    return stationDef.topics?.[0]?.topic ?? null;
  });
}, [stationDef]); // eslint-disable-line
```

**Gotcha**: `stationDef` ไม่ได้อยู่ใน `useMemo` — ใช้ inline `.find()` ซึ่ง return object reference ใหม่ทุกครั้งที่ `opNodes` refetch · React Query default `refetchOnWindowFocus: true` · `staleTime: 300000` ลด frequency แต่ไม่ป้องกัน 100% · ใช้ function form `setActiveTopic(prev => ...)` ใน Effect 2 เพื่อหลีกเลี่ยง infinite loop

---

## Files ที่แก้ใน Session 4

| File | การเปลี่ยนแปลง |
|------|----------------|
| `client/src/pages/OpRecord.jsx` | `formatAndCommit`: เพิ่ม NaN-check สำหรับ INT/FLOAT · `useEffect` สำหรับ activeTopic: แยกเป็น 2 effects |

---

## ตาราง Persona vs Page / Button Access

> **Legend**: ✓ = เข้าได้ / กดได้, ✗ = redirect / disabled, — = ไม่เกี่ยวข้อง
> Source: `ROLE_PAGES` + `RequireAuth` ใน `App.jsx`, `resolveCarUser` + `GET /me` ใน `auth.js`

### ตาราง 1 — Page Access: Bypass Login

| หน้า | scientist | operator | exec\_3a | exec\_3b | observer | superadmin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| /dashboard | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| /record | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| /chem-intake | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| /car | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /config | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |

> operator redirect → `/chem-intake`, exec\_3a/3b redirect → `/car`

### ตาราง 2 — Page Access: Normal Login (by whitelist group\_code)

| หน้า | group '1' นักวิทย์ | group '2' Operator | group '3a' ผอ.กผจ. | group '3b' ผอ.ฝผม. | isAdmin / Superadmin | ไม่อยู่ whitelist |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| /dashboard | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| /record | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| /chem-intake | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| /car | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /config | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |

> กฎเดียวกับ bypass (ใช้ `ROLE_PAGES` ตัวเดียวกัน) แต่ปุ่มทุกปุ่มใน page ที่เข้าได้ **ไม่ถูกจำกัด**

### ตาราง 3 — Button Access: `/chem-intake`

> Normal login ทุก persona: **ทุกปุ่ม enabled**

| Role (Bypass) | บันทึก — Top zone | รับ Sampling — Bottom zone | Logic |
|---|:---:|:---:|---|
| scientist | ✗ | ✓ | `canSaveTop=false`, `canSampling=true` |
| operator | ✓ | ✗ | `canSaveTop=true`, `canSampling=false` |
| exec\_3a/3b | — | — | ไม่สามารถเข้าหน้าได้ |
| observer | ✗ | ✗ | `canSaveTop=false`, `canSampling=false` |
| superadmin | ✓ | ✓ | `canSaveTop=true`, `canSampling=true` |

### ตาราง 4 — Button Access: `/record`

> Normal login ทุก persona (ที่เข้าหน้าได้): **ทุกปุ่ม enabled**

| Role (Bypass) | บันทึกค่า (main) | บันทึกสาหร่าย | ยืนยัน (dialog) |
|---|:---:|:---:|:---:|
| scientist | ✗ | ✗ | ✗ |
| observer | ✗ | ✗ | ✗ |
| superadmin | ✗ | ✗ | ✗ |
| operator/exec | — | — | — |

```js
canRecord = !bypassRole  // any bypass role → false
```

### ตาราง 5 — Button Access: `/config`

> Normal login ทุก persona: **ทุกปุ่ม enabled** (canAction ดูแค่ bypass)

| Role | Action ทุกปุ่ม | Whitelist/Admin features |
|---|:---:|:---:|
| scientist/observer/superadmin bypass | ✗ | ✗ |
| group '1' normal (isAdmin=false) | ✓ | ✗ |
| group '1' normal (isAdmin=true) | ✓ | ✓ |
| Superadmin normal login | ✓ | ✓ |

```js
canAction = !(me?.bypass)
```

### ตาราง 6 — `/car`, `/report`, `/dashboard`

**ไม่มี bypass guard ใดๆ** — ทุก persona ที่เข้าได้มีสิทธิ์กดทุกปุ่มเท่ากัน

---

## BellBeast Bypass Panel

**File**: `BellBeast/Pages/Shared/_Layout.cshtml`

```js
var VISIBILITY = {
  'scientist':    ['*'],
  'operator':     ['chem-intake', 'report', 'car'],
  'executive-3a': ['report', 'car'],
  'executive-3b': ['report', 'car'],
  'observer':     ['*'],
  'superadmin':   ['*']
};
```

Observer role: all `[data-bb-action]` elements disabled globally.

Pages with `data-bb-action` buttons: `CHEM_report.cshtml`, `Index.cshtml`, `MH_report.cshtml`

---

## Build Process

```bash
cd C:\Users\peera\OneDrive\Desktop\LabVenture\client
npx vite build          # MUST be production mode
```
Then hard refresh browser (`Ctrl+Shift+R`).

**Never** use `npx vite build --mode development` — it sets `PROD=false`, `BASE=''`, causing API calls to hit BellBeast directly.

---

## Key File Paths

| File | Purpose |
|---|---|
| `BellBeast/BellBeast/Program.cs` | Bypass set/clear endpoints; Aquadat API guards |
| `BellBeast/BellBeast/Pages/Shared/_Layout.cshtml` | Bypass panel UI + JS |
| `LabVenture/client/src/pages/ChemIntake.jsx` | canSaveTop / canSampling (bypass role guards) |
| `LabVenture/client/src/pages/Record.jsx` | canRecord (any bypass → disabled) |
| `LabVenture/client/src/pages/ConfigEditor.jsx` | BypassCtx read-only mode (bypass only) |
| `LabVenture/client/src/pages/OpRecord.jsx` | Excel-like operator recording table |
| `LabVenture/client/src/App.jsx` | ROLE_PAGES + RequireAuth page guard |
| `LabVenture/server/routes/auth.js` | bypass JWT set/decode; normal login group lookup |
| `LabVenture/server/routes/carAdmin.js` | resolveCarUser; BYPASS_ROLE_MAP; whitelist CRUD |
| `LabVenture/server/routes/operator.js` | OpRecord API (history, submit) |
| `LabVenture/server/config/operator_nodes.json` | Station/topic/param definitions สำหรับ OpRecord |

---

## Known Pitfalls (สะสมทุก session)

1. **JavaScript TDZ**: In any React component, always declare `const me = meData` BEFORE deriving `bypassRole` from it.

2. **Two bypass systems**: BellBeast bypass (`bb_bypass_role` cookie, hyphens) ≠ LabVenture bypass (`aquadat_token` JWT, underscores). LabVenture components must use `me.bypass + me.role` from `/api/auth/me`, not the cookie.

3. **Build mode**: Always `npx vite build` (production). Development mode breaks the `/labventure` base path.

4. **observer in BellBeast** is enforced client-side via `[data-bb-action]` — pages lacking this attribute won't be disabled for observer.

5. **`data.role` vs `data.bypass`**: Action restriction must check `me.bypass`, NOT `me.role`. Normal login users now have non-null `me.role` for page routing but must NOT be button-restricted.

6. **Group priority in whitelist**: prefers `'3a'`/`'3b'` over other groups when user appears in multiple group_code rows.

7. **isAdmin → no page restriction**: Admin-badge users and superadmin get `role: null` from `/me`.

8. **React Query `refetchOnWindowFocus`**: `opNodes` refetch on window focus → object references change → effects fire → can reset UI state (topic, editCell). Fix: use functional update form `setState(prev => ...)` and split effects by concern.

9. **Numeric cell NaN**: `parseFloat('-')` = NaN, `parseFloat('.')` = NaN. Always guard with `isNaN()` before committing numeric cell values.

---

## สิ่งที่ต้องทำใน Session ถัดไป

1. **เปิด Excel sheet RWS2** → map columns → เพิ่ม params ใน `operator_nodes.json` สำหรับ RWS2 ให้ครบ
2. **ทดสอบ** `?station=RWS2` ว่า feature ทุกอย่างทำงานเหมือน RWS1
3. **ทำซ้ำ** สำหรับ station อื่นตามลำดับ (CHEM1, CHEM2, TPS, ...)
4. **ตรวจ configparam_id** ของ station ใหม่ว่าอยู่ใน `operator_configids.json` ของ Uroboros แล้ว
5. **ทดสอบ** normal login แต่ละ whitelist class: operator ห้ามเข้า `/record`/`/config`, executive ห้ามเข้า `/chem-intake`/`/record`
6. **ตรวจ** isAdmin users ยังเข้าทุกหน้าได้หลัง Session 3 changes

---

## Suggested Skills

- `/xlsx` — อ่าน `record_opt.xlsx` เพื่อ map columns → `operator_nodes.json` params สำหรับ station ถัดไป
- `/verify` — Run the app and confirm bypass + normal login behavior works end-to-end in browser
- `/code-review` — ตรวจ OpRecord.jsx หลังเพิ่ม station ใหม่ / ตรวจ RequireAuth + auth.js group lookup
- `/handoff` — เมื่อ session ถัดไปเสร็จ
