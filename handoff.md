# LabVenture + BellBeast — Handoff Document
_Updated: 2026-07-05 (Session 3)_

---

## Project Overview

Two separate web applications that work together:

| App | Stack | Port | Notes |
|---|---|---|---|
| **BellBeast** | ASP.NET Core Razor Pages (C#) | `localhost:443` | Main shell; proxies `/labventure/*` to LabVenture |
| **LabVenture** | React + Vite + TanStack Query (client) / Express.js (server) | `localhost:3001` | Accessed via BellBeast proxy |

LabVenture production build uses `base: '/labventure'` (Vite config) so all API calls route as `/labventure/api/...` through BellBeast → LabVenture.

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

### Session 1 (prior): `/labventure/chem-intake` — Role-restricted buttons

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

---

## ตาราง Persona vs Page / Button Access (อ่านจาก code, no magic)

> **Legend**: ✓ = เข้าได้ / กดได้, ✗ = redirect / disabled, — = ไม่เกี่ยวข้อง (ไม่สามารถเข้าหน้าได้อยู่แล้ว)
> Source: `ROLE_PAGES` + `RequireAuth` ใน `App.jsx`, `resolveCarUser` + `GET /me` ใน `auth.js`

---

### ตาราง 1 — Page Access: Bypass Login

| หน้า | scientist | operator | exec\_3a | exec\_3b | observer | superadmin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| /dashboard | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| /record | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| /chem-intake | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| /car | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /config | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |

> ✗ = `RequireAuth` redirect ไปหน้าแรกที่ allowed ใน `ROLE_PAGES`
> operator redirect → `/chem-intake`, exec\_3a/3b redirect → `/car`

---

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
> isAdmin = badge (is\_admin=1 AND synced\_at IS NOT NULL) หรือ SUPERADMIN\_NAME → role=null → เข้าได้ทุกหน้า

---

### ตาราง 3 — Button Access: `/chem-intake`

> Normal login ทุก persona: **ทุกปุ่ม enabled** (bypass=false ไม่ติด guard)

| Role (Bypass) | บันทึก — Top zone | รับ Sampling — Bottom zone | Logic |
|---|:---:|:---:|---|
| scientist | ✗ | ✓ | `canSaveTop=false`, `canSampling=true` |
| operator | ✓ | ✗ | `canSaveTop=true`, `canSampling=false` |
| exec\_3a | — | — | ไม่สามารถเข้าหน้าได้ |
| exec\_3b | — | — | ไม่สามารถเข้าหน้าได้ |
| observer | ✗ | ✗ | `canSaveTop=false`, `canSampling=false` |
| superadmin | ✓ | ✓ | `canSaveTop=true`, `canSampling=true` |

```js
// ChemIntake.jsx
canSaveTop  = !bypassRole || bypassRole === 'operator'  || bypassRole === 'superadmin'
canSampling = !bypassRole || bypassRole === 'scientist' || bypassRole === 'superadmin'
```

---

### ตาราง 4 — Button Access: `/record`

> Normal login ทุก persona (ที่เข้าหน้าได้): **ทุกปุ่ม enabled**

| Role (Bypass) | บันทึกค่า (main) | บันทึกสาหร่าย | ยืนยัน (dialog) | Logic |
|---|:---:|:---:|:---:|---|
| scientist | ✗ | ✗ | ✗ | `canRecord=false` |
| operator | — | — | — | ไม่สามารถเข้าหน้าได้ |
| exec\_3a | — | — | — | ไม่สามารถเข้าหน้าได้ |
| exec\_3b | — | — | — | ไม่สามารถเข้าหน้าได้ |
| observer | ✗ | ✗ | ✗ | `canRecord=false` |
| superadmin | ✗ | ✗ | ✗ | `canRecord=false` |

```js
// Record.jsx
canRecord = !bypassRole  // any bypass role → false
```

---

### ตาราง 5 — Button Access: `/config`

> Normal login ทุก persona (ที่เข้าหน้าได้): **ทุกปุ่ม enabled** (canAction ดูแค่ bypass)
> Whitelist admin features (Sync EHR, เพิ่ม, ลบ, AdminBadge, Kick) ถูกควบคุมแยกด้วย `isAdmin` จาก `GET /api/car-admin/my-role` — ไม่เกี่ยวกับ bypass

| Role | Action ทุกปุ่ม | Whitelist/Admin features | Logic |
|---|:---:|:---:|---|
| scientist bypass | ✗ | ✗ | `canAction=false` (bypass) |
| observer bypass | ✗ | ✗ | `canAction=false` (bypass) |
| superadmin bypass | ✗ | ✗ | `canAction=false` (bypass) |
| operator bypass | — | — | ไม่สามารถเข้าหน้าได้ |
| exec\_3a/3b bypass | — | — | ไม่สามารถเข้าหน้าได้ |
| group '1' normal (isAdmin=false) | ✓ | ✗ | bypass=false แต่ isAdmin=false |
| group '1' normal (isAdmin=true) | ✓ | ✓ | bypass=false และ isAdmin=true |
| Superadmin normal login | ✓ | ✓ | bypass=false และ isAdmin=true |

```js
// ConfigEditor.jsx
canAction = !(me?.bypass)  // false เมื่อ bypass=true เท่านั้น
```

---

### ตาราง 6 — Button Access: `/car`, `/report`, `/dashboard`

> **ไม่มี bypass guard ใดๆ** ในทั้ง 3 หน้า — ทุก persona ที่เข้าได้มีสิทธิ์กดทุกปุ่มเท่ากัน

| หน้า | สถานะ bypass guard |
|---|---|
| /dashboard | ไม่มี guard — `Dashboard.jsx` ไม่มี canAction/canRecord |
| /car (CARLog.jsx) | ไม่มี guard — ทุกปุ่มเปิดเสมอ |
| /report (Report.jsx) | ไม่มี guard — ทุกปุ่มเปิดเสมอ |

---

## BellBeast Bypass Panel (prior sessions, complete)

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

Pages with `data-bb-action` buttons:
- `BellBeast/Pages/CHEM_report.cshtml` — Load, Export CSV
- `BellBeast/Pages/Index.cshtml` — btnProceed
- `BellBeast/Pages/MH_report.cshtml` — btnGenerate

---

## Build Process

After any LabVenture client change:
```bash
cd C:\Users\peera\OneDrive\Desktop\LabVenture\client
npx vite build          # MUST be production mode (no --mode development)
```
Then hard refresh browser (`Ctrl+Shift+R`).

**Never** use `npx vite build --mode development` — it sets `PROD=false`, `BASE=''`, causing API calls to hit BellBeast directly instead of LabVenture.

---

## Key File Paths

| File | Purpose |
|---|---|
| `BellBeast/BellBeast/Program.cs` | Bypass set/clear endpoints; Aquadat API guards |
| `BellBeast/BellBeast/Pages/Shared/_Layout.cshtml` | Bypass panel UI + JS |
| `BellBeast/BellBeast/Pages/CHEM_report.cshtml` | data-bb-action buttons |
| `BellBeast/BellBeast/Pages/Index.cshtml` | data-bb-action buttons |
| `BellBeast/BellBeast/Pages/MH_report.cshtml` | data-bb-action buttons |
| `LabVenture/client/src/pages/ChemIntake.jsx` | canSaveTop / canSampling (bypass role guards) |
| `LabVenture/client/src/pages/Record.jsx` | canRecord (any bypass → disabled) |
| `LabVenture/client/src/pages/ConfigEditor.jsx` | BypassCtx read-only mode (bypass only) |
| `LabVenture/client/src/App.jsx` | ROLE_PAGES + RequireAuth page guard |
| `LabVenture/server/routes/auth.js` | bypass JWT set/decode; normal login group lookup |
| `LabVenture/server/routes/carAdmin.js` | resolveCarUser; BYPASS_ROLE_MAP; whitelist CRUD |

---

## Known Pitfalls

1. **JavaScript TDZ**: In any React component, always declare `const me = meData` BEFORE deriving `bypassRole` from it. Violating this causes silent `ReferenceError` → blank page.

2. **Two bypass systems**: BellBeast bypass (`bb_bypass_role` cookie, hyphens) ≠ LabVenture bypass (`aquadat_token` JWT, underscores). LabVenture components must use `me.bypass + me.role` from `/api/auth/me`, not the cookie.

3. **Build mode**: Always `npx vite build` (production). Development mode breaks the `/labventure` base path.

4. **observer in BellBeast** is enforced client-side via `[data-bb-action]` — pages lacking this attribute on their buttons won't be disabled for observer.

5. **`data.role` vs `data.bypass`**: Action restriction (canRecord, canSaveTop, etc.) must check `me.bypass`, NOT `me.role`. Normal login users now have a non-null `me.role` for page routing but must NOT be button-restricted.

6. **Group priority in whitelist**: `resolveCarUser` (and the same logic in auth.js GET /me) prefers `'3a'`/`'3b'` over other groups when a user appears in multiple group_code rows.

7. **isAdmin → no page restriction**: Admin-badge users and superadmin get `role: null` from `/me`, meaning no page restriction. The isAdmin flag only gates Whitelist tab visibility inside /config.

---

## Suggested Next Tasks

- Manually test normal login with each whitelist class: verify operator cannot reach `/record` or `/config`, executive cannot reach `/chem-intake` or `/record`
- Verify that isAdmin users (badge + synced) retain full page access after session 3 changes
- Review whether `CARLog.jsx`, `Report.jsx`, `Dashboard.jsx` need any bypass-aware action guards (currently none)
- Consider adding `data-bb-action` to any remaining BellBeast pages that have action buttons not yet covered (e.g., MHxView partials)

---

## Suggested Skills

- `/verify` — Run the app and confirm bypass + normal login behavior works end-to-end in browser
- `/code-review` — Review RequireAuth + auth.js group lookup for correctness
- `/handoff` — Generate next handoff when session ends
