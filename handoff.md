# LabVenture — Handoff Document
**Date:** 2026-06-21  
**Project root:** `C:\Users\peera\OneDrive\Desktop\LabVenture`  
**Stack:** Node.js/Express (server/) + React/Vite/Tailwind (client/) + SQLite (node-sqlite3-wasm) + AquaDAT GraphQL API

---

## What LabVenture Is

AquaDAT Scientist Recorder — a web app for water treatment plant scientists at โรงงานผลิตน้ำมหาสวัสดิ์ (plant_id=2). Replaces manual Excel entry with a structured form that:
- Lets lab staff record water quality measurements per time slot
- Writes data to AquaDAT GraphQL API (for params with `configparam_id`) and local SQLite
- Writes data to an Excel template file on a UNC path (Machine B)
- Applies threshold color alerts based on the active "scenario" (ปกติ / น้ำขุ่น / สาหร่ายสูง)

---

## Architecture

```
server/
  index.js              — Express app, cookie-parser, routes mount
  services/
    aquadat.js          — restLogin(), fetchUserProfile(), writeData() via AquaDAT GraphQL
    db.js               — initDb(), getDb(), SQLite schema + auto-seed scenarios + CAR migrations
    line.js             — pushCarMessage(car, statusCode) — LINE push notifications
  routes/
    auth.js             — POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout
    scenarios.js        — GET /api/scenarios, PUT /api/scenarios/:id/activate
    config.js           — GET /api/config/nodes, GET /api/config/params
    write.js            — POST /api/write/nodes
    car.js              — GET/POST/PATCH /api/car

client/src/
  components/
    Layout.jsx          — Header + sidebar nav
    TokenCountdown.jsx  — JWT expiry progress bar
  pages/
    Login.jsx
    Record.jsx          — Main data entry page (auto time-slot + grouped params)
    CARLog.jsx          — CAR log with 3 buckets, MiniCalendar sidebar, slide panel
    ConfigEditor.jsx
    Report.jsx
    Dashboard.jsx
  api.js                — fetch wrappers: get(), post(), patch()
```

---

## Key Data Structures

### nodes.json — node config
Each node has `id`, `label`, `sort`, `parameters[]`.  
Each parameter: `{ param_key, label, unit, frequency, subgroup?, configparam_id?, fixedTime? }`

### SQLite tables
- `scenarios` — id, name, description, threshold_file, active, activated_at
- `node_records` — param_key, trans_dtm, trans_time, trans_value, recorded_at (UNIQUE on first 3)
- `car_log` — CAR issue tracking (see CAR section below)
- `car_steps` — CAR step history

---

## Record Page Logic (client/src/pages/Record.jsx)

### Auto time-slot selection (added this session)
- Even-hour midpoint formula — if `minutesPastEven > 0` → higher odd slot; else lower odd slot
- Edge case: crossing midnight selects slot 23:00 and decrements date by 1 day
- 60-second `setInterval` keeps slot current; resets values/prompts when slot changes

---

## CAR Log Page (client/src/pages/CARLog.jsx) — Redesigned this session

### Status code system
| Code | Label | Bucket |
|------|-------|--------|
| 10 | ออกใบแล้ว | กำลังดำเนินการ |
| 20 | รออนุมัติ | กำลังดำเนินการ |
| 30 | รอติดตาม#1 | กำลังดำเนินการ |
| 40 | รอติดตาม#2 | กำลังดำเนินการ |
| 50 | แก้ไขแล้ว | กำลังดำเนินการ |
| 60 | ปิดแล้ว | ปิดแล้ว |
| 70 | ตีกลับ | ตีกลับ |

### UI layout (65 / 35 split)
- Left `flex-[13]`: 3 bucket sections
- Right `flex-[7]`: sticky `h-[78vh]` sidebar with two MiniCalendars (current + next month), 50/50 height
- Slide panel: `w-3/4` from right, Sections 1–5 digital CAR form
- CAR card: always shows progress dots 1→2→3→4→5 (no skipping — workflow handles stage 4)

### Calendar dot legend
- 🔴 red = deadline (`deadline_at`)
- 🟠 orange = correction deadline (`correction_deadline`)
- 🟢 green = prevention deadline (`prevention_deadline`)
- 🟣 purple = followup#2 deadline (`followup2_deadline`)

### Backend routes (server/routes/car.js)
- `GET /api/car` — list all (filterable by status_code, from, to)
- `POST /api/car` — create with status_code=10, fires LINE push
- `PATCH /api/car/:id` — merge form_data JSON, update status, extract deadline dates, fire LINE if status changed
- `GET /api/car/:id` — single by numeric id

### form_data column
Stored as merged JSON TEXT in `car_log.form_data`. Keys prefixed by section:
`s1_*`, `s2_*` (correction), `s3_*` (response), `s4_*` (follow-up), `s5_*` (close/reject)

### Calendar date filter (added this session)
- Clicking a date cell in MiniCalendar sets `filterDate` state (ISO string `YYYY-MM-DD`)
- All 3 buckets filter to CARs that have **any** deadline matching that date (deadline_at / correction_deadline / prevention_deadline / followup2_deadline)
- Selected date highlights in brand blue; clicking same date again clears filter
- Filter chip badge appears in header showing active date with `✕` to clear
- Props added to `MiniCalendar`: `selectedDate`, `onDateClick`
- Helper added: `isSelected(d)`, `toDateStr(d)`
- `matchesDate(car, date)` helper used in `inProgress`/`rejected`/`closed` useMemo

### Demo data in DB
- `car_id=5` → CQ-DEMO/68, `status_code=70` (ตีกลับ) ✓
- `car_id=6` → PAR-DEMO/68, `status_code=60` (ปิดแล้ว) ✓

---

## LabVenture.exe Launcher (added this session)

- Source: `start.ps1` at project root
- Built with `ps2exe` module, icon = `LabVenture.ico`, `-requireAdmin` flag
- Behaviour: kills any process on port 3001 → starts `node index.js` in `server/`
- Rebuild command:
  ```powershell
  # Must close LabVenture.exe first, then:
  Import-Module ps2exe
  Invoke-ps2exe -InputFile start.ps1 -OutputFile LabVenture.exe -iconFile LabVenture.ico `
    -title "LabVenture" -company "MWA" -version "1.0.0" -requireAdmin
  ```
- Note: Windows SmartScreen warns on first run (no code-signing cert) — click "More info → Run anyway"

---

## How to Start

```powershell
# Option A — double-click LabVenture.exe (UAC prompt, kills port 3001, starts server)
# Option B — manual
cd C:\Users\peera\OneDrive\Desktop\LabVenture\server && node index.js
cd C:\Users\peera\OneDrive\Desktop\LabVenture\client && npm run dev
```

- Server API: http://localhost:3001
- Frontend dev: http://localhost:5173

---

## Pending / Not Yet Done

| Item | Notes |
|------|-------|
| Slide panel save wiring | Section 2–5 form fields are UI only; need to wire onSave → PATCH /api/car/:id with form_data |
| CAR number auto-generation | Format `CQ-{seq}/{yy}` from sequence counter |
| Excel write service | `server/services/excel.js` not yet created. See previous handoff for cell-mapping details |
| Report page | Query + export to Excel/PDF |
| Dashboard page | Not implemented |
| Marquee content | Hardcoded in Layout.jsx — should be API-driven |
| Progress indicator per slot | Slot buttons could show ✓ / partial based on saved node_records |

---

## Known Issues / Watchpoints

- `node-sqlite3-wasm` can crash under large PATCH JSON bodies — monitor for regressions
- LINE push is silently skipped when `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_GROUP_ID` missing in `.env`
- Slide panel CAR form field names must match `s{n}_*` prefix convention for PATCH merging to work

---

## Suggested Skills for Next Session

- `/handoff` — update this doc at end of each session
- `/xlsx` — if implementing CAR report export to Excel
- `/code-review` — before merging Excel write service

---

---

# Session 2026-06-22 — CAR RBAC, Whitelist & Admin System

## What Was Built

Full role-based access control for the `/car` page plus an admin management UI at `/config`.

---

## New Files

### `server/services/ehr.js`
Scrapes employee lists from internal EHR system (`ehr.mwa.co.th`).
- `scrapeOrg(orgCode)` — HTTP GET + parse Thai honorific names from `<td valign='top' nowrap>`
- `syncWhitelist(db)` — loops ORG_MAP, upserts to `car_whitelist`, preserves `is_admin` flag

ORG_MAP:
| orgCode | group_code | shift |
|---------|-----------|-------|
| 00000350 | '1' | null |
| 00000351–54 | '2' | 1–4 |

### `server/routes/carAdmin.js`
Admin-only API (mounted at `/api/car-admin`):
- `GET /my-role` — returns resolved carUser for logged-in user
- `GET /whitelist` — full list (admin only)
- `POST /sync` — trigger EHR scrape
- `POST /manual` — add manual entry (group 3a/3b)
- `PATCH /:id` — update entry (blocked for superadmin)
- `DELETE /:id` — delete (blocked for superadmin)
- `POST /search-emp` — proxy EHR employee search by emp_id

---

## Modified Files

### `server/services/db.js`
- Added `car_whitelist` table with `UNIQUE(name, group_code)` (not UNIQUE(name))
- Auto-migration from old UNIQUE(name) schema on startup
- Permanent superadmin enforcement on every startup:
  ```js
  db.run("UPDATE car_whitelist SET is_admin = 1 WHERE name = ?", [SUPERADMIN_NAME])
  ```

### `server/services/aquadat.js`
Fixed Thai name construction:
```js
const firstPart = [u.title_name, u.first_name].filter(Boolean).join('');  // no space
const name = [firstPart, u.last_name].filter(Boolean).join(' ');           // space before last
```
Previously used `.join('')` causing names like "นายพีรพัฒน์สุขขารมย์" (no space).

### `server/services/line.js`
- `STATUS_LABEL[20]` → `'รออนุมัติ → รอ ผอ.กผจ. เห็นชอบ'`
- `STATUS_LABEL[50]` → `'แก้ไขแล้ว → รอ ผอ.ฝผม. อนุมัติปิด'`
- Removed `รหัสอ้างอิง: ${car.unique_key}` from LINE message body

### `server/routes/car.js`
- Added `attachCarUser` middleware (decode JWT → fetch AquaDAT profile → lookup whitelist → attach `req.carUser`)
- Role-based CAR filter on `GET /`:
  - Admin / Group 1 → see all
  - Group 2 → filter by receiver_dept shift + receiver_name
  - Group 3a → status_code=20 OR s2_approver history
  - Group 3b → status_code=50 OR s5_approver history
  - Not in whitelist → own CARs only
- `POST /`: locks `issuer_name`, `issuer_dept` from `req.carUser`
- `PATCH /:id`: locks `s2_respondent`, `s2_approver`, `s5_approver` from `req.carUser`
- Fixed SQLite crash: `datetime("now")` → `datetime('now')` (double-quoted string = column name in node-sqlite3-wasm)

### `server/index.js`
Added: `app.use('/api/car-admin', require('./routes/carAdmin'));`

### `client/src/pages/CARLog.jsx`
- Fetches `GET /api/car-admin/my-role` on mount → `myRole`
- Role badge in header (all groups shown, separate ⭐ Admin badge)
- `Inp` component: `readOnly` prop → gray bg, "(อัตโนมัติ)" suffix, cursor-default
- `CarSlidePanel` pre-fills + locks identity fields per group:
  - G2 → s2_respondent + pos
  - G3a → s2_approver
  - G1/Admin → s4_check1_by, s4_check2_by + pos
  - G3b → s5_approver
- "สร้าง CAR" button: visible only to Group 1 + Admin
- `AdminPanel` component: sync EHR button, manual add form, whitelist table
- Multi-group support: uses `cu.groups` array (not single `cu.group`)

### `client/src/pages/ConfigEditor.jsx`
Tabbed interface with 3 tabs:

| Tab | Visible to |
|-----|-----------|
| สถานการณ์ | Everyone |
| ⚙ Whitelist CAR | Admin |
| 🔒 Admin List | Superadmin only |

**Whitelist CAR tab:**
- Sync EHR button (group 1+2)
- Group 1 table with Admin badge toggle
- Group 2 — 4 shift tables with Admin badge toggle
- Group 3a/3b — search by emp_id → select title prefix (นาย/นาง/น.ส./ดร.) → add (max 5 each)

**Admin List tab (superadmin only):**
- All entries with `is_admin=1`, grouped by name
- Shows "✅ ใช้งานได้" vs "❌ ไม่ผ่านเงื่อนไข" based on AND condition
- Explains the logic in the UI

**Admin badge toggle (all tables):**
- `is_admin=0`: "ตั้ง Admin" → inline confirm [ใช่] [ไม่]
- `is_admin=1`: "⭐ Admin" + "ยกเลิก" link → inline confirm [ใช่] [ไม่]
- Superadmin row: locked badge, no controls

---

## Role / Access Rules (Final)

### carUser object
```js
req.carUser = {
  name,        // Full Thai name e.g. "นายพีรพัฒน์ สุขขารมย์"
  position,    // from AquaDAT
  group,       // primary group ('1','2','3a','3b' or null)
  groups,      // all groups this person belongs to (array)
  shift,       // 1-4 (group 2 only)
  deptLabel,   // from whitelist dept_label
  isAdmin,     // see condition below
}
```

### isAdmin condition (AND)
```js
isAdmin = (name === SUPERADMIN_NAME)
  || entries.some(e => e.is_admin === 1 && e.synced_at != null)
```
- badge alone (is_admin=1) is NOT enough
- must also have `synced_at IS NOT NULL` (= was added by EHR sync, not manual)
- Group 3 members are manually added → synced_at=null → cannot be Admin
- If person left org and is no longer synced, badge remains but admin access is lost

### Superadmin
- Hardcoded: `นายพีรพัฒน์ สุขขารมย์` (emp 00102616, Operator ผลัด 4)
- `db.js` enforces `is_admin=1` on every server startup
- Cannot be toggled, deleted, or modified via API (HTTP 403)
- Bypasses AND condition — always isAdmin=true
- Override via env var: `SUPERADMIN_NAME=...`

### Multi-group
- Same person can be in both 3a and 3b (e.g. acting manager)
- `UNIQUE(name, group_code)` allows multiple rows per name
- CAR filter: union of all group conditions with OR

---

## SQLite car_whitelist Schema

```sql
car_whitelist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,          -- Full Thai name with prefix
  group_code TEXT NOT NULL,          -- '1','2','3a','3b'
  shift      INTEGER,                -- 1-4 for group 2
  dept_label TEXT,                   -- org abbreviation from EHR
  is_admin   INTEGER DEFAULT 0,
  synced_at  TEXT,                   -- NULL = manually added
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, group_code)
)
```

---

## Pending Items

| Item | Notes |
|------|-------|
| EHR sync never deletes | If person leaves org, old entry stays. Admin must manually revoke badge. Considered intentional — AquaDAT account closure is the security gate. |
| Group 3 cannot be Admin | By design (no synced_at). If ผอ. needs admin rights, they'd need an entry in group 1 or 2 as well. |
| Slide panel save wiring | Section 2–5 form fields are UI only; need to wire onSave → PATCH /api/car/:id with form_data |
| CAR number auto-generation | Format `CQ-{seq}/{yy}` |
| Excel write service | Not yet created |
| Report page | Not implemented |
| Dashboard page | Not implemented |

---

## Suggested Skills for Next Session

- `/handoff` — update this doc at end of each session
- `/code-review` — before any production deploy of RBAC changes
- `/xlsx` — when implementing CAR report export

---

---

# Session 2026-06-22 (ต่อ) — Dashboard Grouping & Admin Badge UX

## What Was Built

1. **Dashboard 3-level collapsible grouping** — "สถานะรายหัวข้อ" จัดกลุ่ม node cards เป็น 3 กลุ่มพร้อม +/− พับได้
2. **Admin badge confirm flow** — badge ถาวร ต้องยืนยันก่อนตั้ง/ยกเลิก
3. **Admin AND condition** — `is_admin=1 AND synced_at IS NOT NULL`
4. **Admin List tab** — superadmin เท่านั้น เห็นรายชื่อ admin ทั้งหมดพร้อมสถานะ

---

## Dashboard Grouping (`client/src/pages/Dashboard.jsx`)

### 3-level collapse structure
```
Level 1 — GroupSection (+/−)           ← ใหม่
  └── กลุ่มน้ำดิบ / ระบบผลิต / น้ำประปา  [aggregate %]
       Level 2 — NodeProgressCard (▲/▼)  ← มีอยู่เดิม
         └── node label + overall % + slot buttons
              Level 3 — Param rows       ← มีอยู่เดิม
                └── รายพารามิเตอร์ + slot status buttons
```

### NODE_GROUPS config (hardcoded in Dashboard.jsx)
```js
const NODE_GROUPS = [
  { key: 'raw',  label: 'กลุ่มน้ำดิบ',        color: 'bg-emerald-700 ...', nodeIds: ['Incoming','JarTest','RW'] },
  { key: 'prod', label: 'กลุ่มน้ำระบบผลิต',   color: 'bg-blue-800 ...',    nodeIds: ['CW_Phase1','CW_Phase2','CW_Phase3','CW_Phase4'] },
  { key: 'tap',  label: 'กลุ่มน้ำประปา',       color: 'bg-amber-700 ...',   nodeIds: ['TW12','TW34'] },
];
```

- GroupSection เปิดเริ่มต้น (`useState(true)`)
- % ที่หัว group = sum ของ totalRecorded / totalExpected ทุก node ในกลุ่ม
- Node ที่ไม่อยู่ใน NODE_GROUPS ใดเลย → fallback แสดงเป็น flat card ด้านล่าง

---

## Admin Badge & Access UX (ConfigEditor.jsx + server)

### Badge toggle (AdminBadge component)
- `is_admin=0` → ปุ่ม "ตั้ง Admin" → คลิก → inline confirm **[ใช่] [ไม่]**
- `is_admin=1` → badge "⭐ Admin" + link "ยกเลิก" เล็กๆ → คลิก → confirm **[ใช่] [ไม่]**
- Superadmin: badge static ไม่มีปุ่มใดๆ

### isAdmin condition (server — car.js + carAdmin.js)
```js
const isAdmin = profile.name === SUPERADMIN_NAME
  || entries.some(e => e.is_admin === 1 && e.synced_at != null);
```
- badge อย่างเดียวไม่พอ — ต้อง synced จาก EHR ด้วย
- กลุ่ม 3 (manually added, synced_at=null) ไม่สามารถเป็น Admin ได้

### Admin List tab (ConfigEditor.jsx — superadmin only)
- แสดงทุกคนที่ `is_admin=1` collapsed by name (multi-group)
- คอลัมน์ "สิทธิ์ Admin": ✅ ใช้งานได้ (synced_at มีค่า หรือ superadmin) / ❌ ไม่ผ่านเงื่อนไข
- แสดงวันที่ sync ล่าสุด

---

## Updated Pending Items

| Item | Status | Notes |
|------|--------|-------|
| Dashboard grouping | ✅ Done | 3-level collapse, NODE_GROUPS config |
| Admin badge confirm | ✅ Done | Inline confirm before set/revoke |
| Admin AND condition | ✅ Done | badge + synced_at |
| Superadmin permanent | ✅ Done | enforce on startup, locked in UI |
| Multi-group support | ✅ Done | UNIQUE(name, group_code) |
| EHR sync never deletes | Open | intentional design |
| Slide panel save wiring | Open | Section 2–5 needs PATCH wiring |
| CAR number auto-generation | Open | Format `CQ-{seq}/{yy}` |
| Excel write service | Open | |
| Report page | Open | |

---

## Suggested Skills for Next Session

- `/handoff` — update this doc at end of each session
- `/code-review` — before production deploy
- `/xlsx` — when implementing CAR report export

---

---

# Deploy Guide — Production on Port 443 via ASP.NET YARP

## สถาปัตยกรรม

```
คนใช้งาน (Browser)
    ↓  HTTPS port 443
IIS + ASP.NET .NET 9  (เครื่อง deploy)
    ├── route /             → ASP.NET app เดิม
    └── route /labventure/* → forward ภายในเครื่อง
                                ↓  HTTP port 3001
                             Node.js LabVenture
```

คนภายนอกเห็นเฉพาะ port 443 (HTTPS) — port 3001 ไม่ถูก expose ออกข้างนอก

---

## ขั้นตอน 1 — ติดตั้ง YARP ใน ASP.NET project

```bash
dotnet add package Yarp.ReverseProxy
```

---

## ขั้นตอน 2 — แก้ `Program.cs`

```csharp
var builder = WebApplication.CreateBuilder(args);

// ... services เดิม ...

builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

// ... middleware เดิม ...

app.MapReverseProxy();  // ต้องอยู่หลัง middleware อื่น

app.Run();
```

---

## ขั้นตอน 3 — เพิ่มใน `appsettings.json`

```json
{
  "ReverseProxy": {
    "Routes": {
      "labventure-route": {
        "ClusterId": "labventure-cluster",
        "Match": {
          "Path": "/labventure/{**catch-all}"
        },
        "Transforms": [
          { "PathRemovePrefix": "/labventure" }
        ]
      }
    },
    "Clusters": {
      "labventure-cluster": {
        "Destinations": {
          "dest1": {
            "Address": "http://localhost:3001/"
          }
        }
      }
    }
  }
}
```

`/labventure/api/car` → strip prefix → `http://localhost:3001/api/car`

---

## ขั้นตอน 4 — แก้ฝั่ง LabVenture

### `client/vite.config.js`
```js
export default defineConfig({
  base: '/labventure/',
  // ... rest เดิม
})
```

### `server/index.js`
```js
app.set('trust proxy', 1);  // เพิ่มบรรทัดนี้ก่อน routes
```

จากนั้น rebuild client:
```bash
cd client && npm run build
```

---

## ขั้นตอน 5 — ให้ Node.js ทำงานตลอดเวลา

ใช้ PM2 หรือ Windows Service:

**PM2 (แนะนำ):**
```bash
npm install -g pm2
cd C:\...\LabVenture\server
pm2 start index.js --name labventure
pm2 save
pm2 startup
```

**หรือ NSSM (Windows Service):**
```
nssm install LabVenture "node" "C:\...\LabVenture\server\index.js"
nssm set LabVenture AppDirectory "C:\...\LabVenture\server"
nssm start LabVenture
```

---

## สรุป URL หลัง deploy

| URL | ปลายทาง |
|-----|---------|
| `https://server/` | ASP.NET เดิม |
| `https://server/labventure/` | React SPA |
| `https://server/labventure/api/*` | Node.js API |

---

---

# Session 2026-06-23 — AquaDAT Process API Integration & Dashboard/Record Status Indicators

## What Was Built

1. **`aquadat_configs.json`** — config file ครบ 4 กลุ่ม mapping group/subgroup/parameter/configID จาก note.xlsx
2. **`/api/aquadat/fetch`** — endpoint POST ไปที่ AquaDAT process API, รับ CSV, parse และ return JSON
3. **`/api/aquadat/sync`** — endpoint ดึงข้อมูลจาก AquaDAT แล้ว upsert ลง SQLite `node_records`
4. **Init System UI** (`/config` tab "⬇ Init System") — ปุ่มสำหรับดึงข้อมูล AquaDAT เข้า DB ตอนเปิดระบบครั้งแรก
5. **Pre-fill Record page** — เมื่อเปลี่ยน slot จะ query `node_records` แล้ว pre-fill ค่าเดิมลงในกล่อง input
6. **Slot button สีเขียว/แดง** — ทั้ง Dashboard และ Record page แสดงสถานะต่อ slot
7. **กลุ่มพิเศษ** — เพิ่มกลุ่มที่ 4 (Chemical + Biological) ใน Dashboard และ nodes.json
8. **`GET /api/write/nodes?date=&slot=`** — endpoint ดึงค่าปัจจุบันจาก `node_records` สำหรับ date+slot

---

## New Files

### `server/config/aquadat_configs.json`
Config mapping ทุก parameter → configID จาก note.xlsx แบ่ง 4 กลุ่ม:
- **raw** (กลุ่มน้ำดิบ): RW (9 params, configID 887–8503), Incoming RW ท่าม่วง/บางเลน (configID 894–899), Jar Test Alum (configID 954–991), Jar Test PACl (configID 8045–8116)
- **prod** (กลุ่มน้ำระบบผลิต): Phase1–4, แต่ละ phase มี CW_xA/CW_xB/CWx/FWx (configID 996–1043)
- **tap** (กลุ่มน้ำประปา): TW1–4 (configID 1044–1067, 4345–4346)
- **special** (กลุ่มพิเศษ): Chemical RW/TW1/TW2 (configID 1068–1079), Biological Algae (configID 932–945), Bacteria (configID 946–952)

โครงสร้าง JSON:
```json
{
  "plant": "MS",
  "station": "QWS",
  "groups": [
    { "key": "raw", "label": "กลุ่มน้ำดิบ", "subgroups": [
      { "key": "RW", "label": "RW", "params": [
        { "key": "RW.Turb", "label": "Turb", "configID": "887" }, ...
      ]}
    ]}
  ]
}
```

หมายเหตุ: `key` ใน params ตรงกับ `param_key` ใน `nodes.json` เสมอ

### `server/routes/aquadatProcess.js`
ทุก route ใน `/api/aquadat/*`:

| Method | Path | หน้าที่ |
|--------|------|---------|
| POST | `/api/aquadat/fetch` | ดึง CSV จาก process API, return parsed JSON |
| POST | `/api/aquadat/sync` | ดึง CSV → upsert non-zero values → `node_records` |
| GET | `/api/aquadat/configs` | return aquadat_configs.json ให้ client |

**Process API payload format:**
```json
{
  "begin": "yyyy-mm-dd",
  "end": "yyyy-mm-dd",
  "token": "<aquadat_token จาก cookie>",
  "removeOddHour": false,
  "opt": "",
  "csvFilename": "data_ddmmyyhhmm.csv",
  "configs": [{ "configID": "887", "plant": "MS", "station": "QWS" }, ...],
  "user": "<sub จาก JWT>"
}
```

**URL upstream:** `http://172.16.198.150:443/api/process`

**CSV format ที่ได้รับ:** comma-separated (ไม่ใช่ tab) auto-detected
- Row 0: `Date,Time,DateTime,configID1,configID2,...`
- Row 1: Plant-Station info
- Row 2: Param-Equipment
- Row 3: Unit
- Row 4+: data rows

**Sync logic:**
- value == 0 → skip (AquaDAT ใช้ 0 แทน null)
- value != 0 → INSERT OR REPLACE ลง `node_records`
- param frequency == 'daily' → ใช้ trans_time = 'daily' (ต้อง match fixedTime จาก nodes.json)
- ข้าม row ที่ date ไม่ตรงกับ target date (เช่น carry-over 00:00 วันถัดไป)

---

## Modified Files

### `server/config/nodes.json`
เพิ่ม 2 nodes ใหม่ (sort 10 และ 11):

**Chemical node (id: "Chemical"):**
- 12 params: Al/Fe/Mn/Cl × RW/TW1/TW2
- frequency: "daily", subgroup: "RW" / "TW1" / "TW2"
- param_key pattern: `Chem.{station}.{element}`

**Biological node (id: "Biological"):**
- 18 params: Algae (Total+ClogFilter) × RW/CW1-4/TW1-2 + Bacteria (Coliform+EColi) × TW1/TW2
- frequency: "daily"
- param_key pattern: `Algae.{station}.{type}`, `Bacteria.{station}.{type}`
- unit: "cell/mL" (Algae), "CFU/100mL" (Bacteria)

### `server/routes/write.js`
เพิ่ม GET endpoint:
```
GET /api/write/nodes?date=YYYY-MM-DD&slot=HH:MM
→ { date, slot, values: { "RW.Turb": "20.5", ... } }
```
Query: `SELECT param_key, trans_value FROM node_records WHERE trans_dtm=? AND trans_time=?`

### `server/routes/progress.js`
`GET /api/progress/nodes-today` รับ query param `?date=` ได้แล้ว:
- ถ้าไม่ส่ง date → ใช้วันปัจจุบัน
- ถ้าส่ง date เป็นวันที่ผ่านมา → `nowMinutes = 24*60` (ทุก slot ถือว่า due)

### `server/index.js`
เพิ่ม: `app.use('/api/aquadat', require('./routes/aquadatProcess'));`

### `client/src/pages/Dashboard.jsx`
- เพิ่มกลุ่มที่ 4 ใน `NODE_GROUPS`:
  ```js
  { key: 'special', label: 'กลุ่มพิเศษ', color: 'bg-rose-800 ...', nodeIds: ['Chemical','Biological'] }
  ```
- เพิ่ม palette สำหรับ Chemical (`bg-rose-700`) และ Biological (`bg-pink-800`)

### `client/src/pages/Record.jsx`
1. **Pre-fill values:** `useQuery(['node-values', date, slot])` → `GET /api/write/nodes?date=&slot=` → `useEffect` set values เมื่อข้อมูลมาใหม่
2. **Slot button สี:** `useQuery(['progress-nodes', date])` → compute `slotStatus[slot] = { anyDue, allDone }`:
   - `anyDue && allDone` → สีเขียว (`bg-green-100 border-green-400`)
   - `anyDue && !allDone` → สีแดง (`bg-red-100 border-red-400`)
   - ไม่ due → default (ขาว)
   - ปุ่ม active → สี brand เสมอ (override สี)
3. ปุ่ม "วันละ 1 ครั้ง" (daily slot) ก็ใช้ logic เดียวกัน

### `client/src/pages/ConfigEditor.jsx`
เพิ่ม tab "⬇ Init System" (visible to everyone):
- Date picker (default วันนี้)
- Group selector (ทั้งหมด / raw / prod / tap / special)
- ปุ่ม "Init — ดึงข้อมูล AquaDAT เข้า DB" → POST `/api/aquadat/sync`
- แสดงผล: configsFetched / inserted / skipped
- หมายเหตุเรื่อง 0=null และ reset policy

---

## Workflow ที่กำหนด

```
นักวิทย์คีย์ค่า
      ↓
LabVenture platform
      ↓
  ┌───────────────────────────────┐
  │  1. SQLite node_records       │  ← Daily DB (Lab daily report)
  │     - ไม่ reset ตาม 24h      │  - reset เมื่อยืนยันสร้างรายงาน
  │     - เป็น tempo DB สำหรับ   │
  │       รายงาน 1 วัน            │
  └───────────────────────────────┘
      ↓ (ใน session ต่อไป)
  ┌───────────────────────────────┐
  │  2. AquaDAT GraphQL API       │  ← ยังไม่ implement
  └───────────────────────────────┘
```

**Init System (เปิดระบบครั้งแรก / หลัง reboot):**
```
AquaDAT process API  →  CSV  →  parse  →  node_records (SQLite)
                                           ↓
                                    Dashboard slot buttons
                                    Record page pre-fill values
```

---

## Data Flow — Dashboard/Record Status

1. **Sync** → `node_records` มีข้อมูล (param_key + trans_dtm + trans_time + trans_value)
2. **`GET /api/progress/nodes-today?date=`** → loop ทุก node → ทุก param → ทุก slot → `done = recordedSet.has(param_key|slot)`
3. **Dashboard** → slot button เขียว/แดงตาม overallStatus(slot) ของ node
4. **Record** → slot button เขียว/แดงตาม slotStatus ของทุก node รวมกัน

---

## Pending Items

| Item | Status | Notes |
|------|--------|-------|
| AquaDAT write (ข้อ 2 ของ workflow) | Open | ยังไม่ implement — POST ค่าที่คีย์ไปยัง AquaDAT GraphQL |
| Reset Daily DB เมื่อยืนยันรายงาน | Open | ยังไม่มี UI/logic สำหรับ confirm + reset |
| Report page | Open | ยังไม่ implement |
| ค่า 0 override rule | Open | ปัจจุบัน 0 = ไม่มีข้อมูล (skip sync) แต่จะเพิ่ม rule ต่อไป |
| Hardcoded date `'2026-06-22'` | Open | `/api/aquadat/fetch` และ `/api/aquadat/sync` ยังใช้ hardcoded date สำหรับ testing — ต้องเปลี่ยนกลับเป็น `new Date()` เมื่อ go live |
| Slide panel save wiring | Open | Section 2–5 CAR form fields ยังเป็น UI only |
| CAR number auto-generation | Open | Format `CQ-{seq}/{yy}` |
| Excel write service | Open | |

---

## Notes / Gotchas

- **CSV delimiter**: AquaDAT process API return comma-separated (ไม่ใช่ tab แม้ตัวอย่างเดิมจะเป็น tab) — code auto-detect แล้ว
- **ค่า 0 vs null**: AquaDAT set 0 แทน null เสมอ → sync code skip value==0 เพื่อไม่ให้ slot เป็น green โดยไม่มีข้อมูลจริง
- **configID ≠ configparam_id**: `configID` ใน aquadat_configs.json คือ process API ส่วน `configparam_id` ใน nodes.json คือ REST API เก่า — เป็น ID system ต่างกัน
- **param_key ต้องตรงกัน**: `key` ใน aquadat_configs.json ต้อง match `param_key` ใน nodes.json เพื่อให้ sync เขียน node_records ได้ถูก slot

---

## Suggested Skills for Next Session

- `/handoff` — update this doc at end of each session
- `/xlsx` — เมื่อ implement Report page
- `/code-review` — ก่อน go live ส่วน AquaDAT write integration

---

---

# Session 2026-06-24 — Excel Write Pipeline (Python/openpyxl)

## What Was Built

ระบบเขียน Excel รายเดือนใหม่ทั้งหมด — แทนที่ ExcelJS ด้วย Python/openpyxl เพื่อแก้ปัญหา Excel repair dialog และ structural corruption

---

## ปัญหาที่แก้ได้

| ปัญหา | สาเหตุ | วิธีแก้ |
|-------|--------|---------|
| "We found a problem with some content" | ExcelJS re-write openpyxl-generated file ทำให้ sheet1.xml หาย 29KB | เปลี่ยนทุก Excel operation ไป Python ล้วน |
| Named range `วันที่` = `#REF!` | openpyxl rename sheet "1" → "theme" แต่ definedNames ยังอ้าง `'1'!$BD$3` | strip `<definedNames>` จาก workbook.xml ผ่าน zip |
| openpyxl re-add `<definedNames/>` ตอน save | openpyxl เพิ่ม self-closing tag กลับมา | regex strip ทั้ง `<definedNames/>` และ `<definedNames>…</definedNames>` |
| theme มี 32 sheets ทำให้ไฟล์ใหญ่ 621KB | pre-create sheet 1-31 ไว้ล่วงหน้า | ใช้ `copy_worksheet('theme')` runtime แทน — theme มี 1 sheet, monthly มีเฉพาะวันที่ที่ใช้ |

---

## Architecture ใหม่

```
form submit
    ↓
POST /api/write/nodes  (server/routes/write.js)
    ↓ saveToDb() → SQLite
    ↓ writeToExcel(records)
server/services/excelWriter.js
    ↓ spawn('python', [excel_writer.py, JSON])
server/excel_writer.py  (Python/openpyxl)
    ↓ shutil.copy(theme → monthly)  [ถ้าไม่มีไฟล์]
    ↓ wb.copy_worksheet('theme') rename เป็น "24"  [ถ้าไม่มี sheet]
    ↓ ws['C5'] = 22.8  (value only, ไม่แตะโครงสร้าง)
    ↓ wb.save()
    ↓ strip_defined_names()  (zip post-process)
server/data/DailyLab_2026_06.xlsx
```

---

## Files Changed

### `make_theme.py` (rewritten — simplified)
สร้าง `server/data/DailyLab_theme.xlsx` จาก `05DailyLab_May69.xlsx`:
- โหลด workbook, rename sheet "1" → "theme", ลบ sheet อื่นทั้งหมด
- ล้างค่าตัวเลข, formula (`=...`), Max/Min/Avg labels
- zip post-process: strip `<definedNames>` จาก workbook.xml
- ผล: **1 sheet** (theme เท่านั้น), ขนาด 30 KB

เดิม: pre-create sheet 1-31 ผ่าน zip manipulation (32 sheets, 621 KB) — ยกเลิกแล้ว

### `server/excel_writer.py` (new)
Python script รับ JSON records ผ่าน `sys.argv[1]`:
- `shutil.copy(THEME, path)` — binary copy ไม่แตะ XML
- `wb.copy_worksheet(wb['theme'])` + rename เมื่อ sheet วันที่ยังไม่มี
- เขียนเฉพาะ cell value ตาม `excel_cell_map.json`
- `strip_defined_names(path)` หลัง save ทุกครั้ง

```python
def strip_defined_names(path):
    tmp = path + '.tmp'
    with zipfile.ZipFile(path, 'r') as zin, zipfile.ZipFile(tmp, 'w', ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'xl/workbook.xml':
                xml = data.decode('utf-8')
                xml = re.sub(r'<definedNames\s*/>', '', xml)
                xml = re.sub(r'<definedNames>.*?</definedNames>', '', xml, flags=re.DOTALL)
                data = xml.encode('utf-8')
            zout.writestr(item, data)
    os.replace(tmp, path)
```

### `server/services/excelWriter.js` (replaced)
จาก ExcelJS → spawn Python:
```js
const py = spawn('python', [WRITER, JSON.stringify({ records })]);
```

---

## Monthly File Structure (ผล)

```
DailyLab_2026_06.xlsx  (48 KB)
├── theme   ← binary copy จาก template, ไม่แตะ
└── 24      ← copy_worksheet('theme') rename, เติมเฉพาะ cell value
```

เทียบกับเดิม: 32 sheets, 621 KB

---

## Cell Map

`server/config/excel_cell_map.json` — mapping `param_key → { slot: cellAddress }`:
```json
{
  "RW.Turb": { "01:00": "C5", "03:00": "D5", ... },
  "JarTest.Alum.D1.Dose": { "daily": "D23" }
}
```
- slot คือ `trans_time` จาก `node_records` (เช่น "01:00" หรือ "daily")
- ถ้า param ไม่อยู่ใน cell_map → skip (ไม่ error)

---

## กฎสำคัญ (ห้ามละเมิด)

> **"กฎคือ ต้องก็อปไฟล์ไปเติมข้อมูลเท่านั้น ห้ามแก้ไขเนื้อหา ห้ามเพิ่ม row / column ใดๆ"**

- ห้าม add formula, Max/Min/Avg, หรือ row พิเศษ — user ดูแลสูตรเอง
- ห้าม modify โครงสร้าง Excel ใน runtime
- อนุญาต: binary copy theme → monthly, copy_worksheet + rename, เขียน cell value เท่านั้น

---

## Pending Items

| Item | Status | Notes |
|------|--------|-------|
| ดีเลย submit ~4-6 วิ | Open | Python cold start + openpyxl load/save — แก้ได้ด้วย Python microservice (Flask port 3002) ให้ stay warm |
| AquaDAT write | Open | POST ค่าไปยัง AquaDAT GraphQL ยังไม่ implement |
| Reset Daily DB | Open | ยังไม่มี logic confirm + reset |
| Report page | Open | |
| Slide panel CAR save wiring | Open | Section 2-5 ยังเป็น UI only |
| CAR number auto-generation | Open | Format `CQ-{seq}/{yy}` |

---

## Notes / Gotchas

- **ExcelJS incompatibility**: ExcelJS ไม่สามารถ re-write ไฟล์ที่ openpyxl สร้างได้ — XML structure ต่างกัน, sheet1.xml หาย 29KB → ห้ามใช้ ExcelJS กับไฟล์ที่ openpyxl เขียน
- **openpyxl definedNames**: openpyxl เพิ่ม `<definedNames/>` กลับมาทุกครั้งที่ save — ต้อง strip ผ่าน zip หลัง save เสมอ
- **theme sheet**: monthly file ต้องมี sheet "theme" ไว้เสมอ เพื่อใช้ `copy_worksheet` สร้างวันถัดไป
- **Python path**: excelWriter.js ใช้ `spawn('python', ...)` — Windows ต้องมี Python ใน PATH

---

## Suggested Skills for Next Session

- `/handoff` — update this doc at end of each session
- `/code-review` — ก่อน go live Excel pipeline
- `/xlsx` — ถ้า implement Report page

---

---

# Session 2026-06-24 (ต่อ) — Chemical Intake Page (รับสารเคมี)

## What Was Built

หน้าใหม่ `/chem-intake` สำหรับบันทึกการรับสารเคมีประจำวัน ออกแบบร่วมกันตั้งแต่ requirements จนถึง implementation พร้อม grill-me session

---

## System Constraints ที่ตกลง

- เครื่องชั่งสารเคมีแก้โปรแกรมไม่ได้ (กฎหมายชั่งตวงวัด) → WDATA คือ source of truth สำหรับน้ำหนัก
- ทะเบียนรถ (`TRUCK`) คือ Primary Key ในการ join ข้อมูล
- Operator กรอกเฉพาะข้อมูลหน้างาน — น้ำหนัก (W1/W2) มาจาก WDATA เท่านั้น

---

## Architecture

```
Uroboros Mini (IoT) → chem.db (SQLite, เครื่องชั่ง) ← ห้ามแก้
Uroboros (backend .NET) → poll chem.db ทุก 15 นาที → expose /api/wdata
LabVenture → GET /api/chem-intake/wdata (proxy) → merge กับ ChemHistory
```

**URL Uroboros กำหนดใน:** `server/config/services.json`
```json
{
  "uroboros": {
    "base_url": "http://localhost:5000",
    "endpoints": { "wdata": "/api/wdata" }
  }
}
```
อ่านทุก request (ไม่ต้อง restart server เมื่อเปลี่ยน URL)

---

## WDATA Schema (chem.db — ห้ามแก้)

```
STAT | TRUCK | CARTYPE | COMPANY | PRODUCT | DAYIN | TMIN | W1 | DAYOUT | TMOUT | W2
```

- `PRODUCT` เป็น code ("01"/"02"/"03") join กับ table `product` ใน chem.db
- Uroboros API ต้อง join WDATA + product ก่อน return → LabVenture รับ `product_name` สำเร็จรูป

---

## New Table: `chem_history` (ใน labventure.db)

```sql
CREATE TABLE chem_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  truck             TEXT NOT NULL,          -- ทะเบียนรถ (join key กับ WDATA)
  delivery_book     TEXT,                   -- ใบนำส่ง เล่มที่
  delivery_no       TEXT,                   -- ใบนำส่ง เลขที่
  sg                REAL,                   -- ค่า ถ.พ.
  temperature       REAL,                   -- อุณหภูมิ °C
  tank_a_before     REAL,
  tank_a_after      REAL,
  tank_b_before     REAL,
  tank_b_after      REAL,
  tank_c_before     REAL,
  tank_c_after      REAL,
  tank_d_before     REAL,
  tank_d_after      REAL,
  operator          TEXT,                   -- จาก login session
  shift             TEXT,
  created_at        TEXT DEFAULT (datetime('now','localtime')),
  chemical_type     TEXT,                   -- 'Alum' | 'PACl'
  bottle_found      INTEGER,               -- 1=พบ, 0=ไม่พบ (set ตอน claim popup)
  bottle_claimed_by TEXT,                  -- nullable
  bottle_claimed_at TEXT                   -- nullable
)
```

---

## New Files

### `server/routes/chemIntake.js`

| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/chem-intake?date=YYYY-MM-DD` | ดึง records ทั้งหมดของวัน |
| POST | `/api/chem-intake` | บันทึก Top record ใหม่ |
| GET | `/api/chem-intake/wdata?date=YYYY-MM-DD` | proxy → Uroboros `/api/wdata` |
| PATCH | `/api/chem-intake/claim-batch` | นักวิทย์ยืนยันรับขวด sampling (batch) |

### `server/config/services.json`
Config file สำหรับ external service URLs — แก้ได้โดยไม่ restart server

### `client/src/pages/ChemIntake.jsx`
หน้าหลัก 3 sections:

**Top** — Entry form:
- ฟิลด์: ทะเบียนรถ, ถ.พ., อุณหภูมิ, ใบนำส่ง (เล่มที่ + เลขที่)
- Chemical selector (Alum/PACl dot checkpoint แนวดิ่ง) + Tank graphic 2×2 + เติมถัง matrix
- Layout 3 columns 15%-25%-60% ในการ์ดเดียว
- Auto-clear form + focus ทะเบียนรถ หลังบันทึกสำเร็จ

**Middle** — Sampling:
- Aggregate ขวดตัวอย่างตาม product type (เช่น "อลูมิเนียมซัลเฟต 8 ขวด")
- ปุ่ม "รับ Sampling" → popup แสดง truck + toggle พบ/ไม่พบ ต่อคัน → "ยืนยันรับสารเคมี"
- Workflow: นักวิทย์รับขวดวันถัดไปเสมอ (WDATA sync ครบก่อนทุกครั้ง)

**Bottom** — Daily records:
- ตาราง merge `chem_history` + WDATA ตามทะเบียนรถ
- แสดง SYNC / UNSYNC status, น้ำหนัก W1/W2/สุทธิ, สถานะขวด
- Date picker ดูย้อนหลัง (เท่าที่ labventure.db มี)
- Auto-refresh ทุก 15 นาที เมื่อมีรายการ UNSYNC

---

## Tank Graphic Config

```js
const CHEM_CONFIG = {
  Alum: { capacity: { A: 750, B: 750, C: 750, D: 650 } },  // m³
  PACl: { capacity: { A: 25,  B: 25,  C: 25,  D: 23  } },  // m³
}
```

- ก่อนเติม = ghost bar (โปร่งแสง), หลังเติม = solid bar
- Timestamp แสดง `dataUpdatedAt` จาก useQuery ของ WDATA (ไม่ใช่ real-time clock)

---

## Modified Files

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `server/services/db.js` | เพิ่ม CREATE TABLE `chem_history` + migration เพิ่ม column `chemical_type` |
| `server/index.js` | register `/api/chem-intake` route |
| `client/src/App.jsx` | เพิ่ม route `/chem-intake` |
| `client/src/components/Layout.jsx` | เพิ่ม nav "🧪 รับสารเคมี" (ใต้ บันทึก) |

---

## Pending Items (เพิ่มจาก session นี้)

| Item | Notes |
|------|-------|
| Uroboros API จริง | ปัจจุบัน `/api/chem-intake/wdata` return 502 (Uroboros ยังไม่ implement) — ต้องเขียน endpoint ฝั่ง Uroboros |
| ปริมาตร (ลบ.ม.) | คำนวณจาก น้ำหนักสุทธิ / ถ.พ. หลัง sync — ยังไม่แสดงในตาราง |
| chemical_type ใน Bottom | ตาราง Bottom ยังไม่แสดง chemical_type column |
| Mock WDATA | ต้อง swap mock data ออกหลัง Uroboros พร้อม |

---

## Suggested Skills for Next Session

- `/handoff` — update this doc at end of each session
- `/code-review` — ก่อน go live หน้า ChemIntake
- `/grill-me` — ถ้ามี feature ใหม่ที่ต้อง clarify requirements

---

---

# Session 2026-07-01 — กลุ่มพิเศษ: Weekly Slot + Algae Species Recording

## What Was Built

1. **ปรับ frequency** ของ Chemical Analysis และ Biological Algae → `"weekly"` + `skip_progress: true`
2. **Bacteria TW1/TW2** คงเป็น `"daily"` และยังนับ progress ตามเดิม
3. **ปุ่ม "สัปดาห์ละ 1 ครั้ง"** ใน slot selector ของ Record page
4. **ระบบบันทึกสาหร่ายระดับ species** (AlgaeSpeciesPanel) พร้อม search, select, count per station, เพิ่ม species ใหม่
5. **DB tables ใหม่** `algae_species` และ `algae_records` พร้อม seed 75 species จาก Excel

---

## Files Changed

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `server/config/nodes.json` | Chemical (12 params) + Biological Algae (14 params): `frequency→weekly`, `skip_progress:true`; Bacteria TW1/TW2 ไม่เปลี่ยน |
| `server/routes/progress.js` | เพิ่ม `weekly` case ใน `getAllSlots()` และ `getExpectedSlots()` |
| `server/services/db.js` | เพิ่ม `algae_species` table, `algae_records` table, seed function จาก `algae_species_seed.json` |
| `server/routes/algae.js` | **ไฟล์ใหม่** — 5 endpoints (ดูด้านล่าง) |
| `server/index.js` | register `app.use('/api/algae', require('./routes/algae'))` |
| `client/src/pages/Record.jsx` | เพิ่ม `WEEKLY_SLOT`, `slotMatchesFreq` weekly case, ปุ่ม slot, `AlgaeSpeciesPanel` component |
| `server/config/algae_species_seed.json` | **ไฟล์ใหม่** — 75 species seed จาก Algae2569.xlsx |

---

## DB Schema ใหม่

```sql
CREATE TABLE algae_species (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  division     TEXT,                    -- 'Division Bacillariophyceae', etc.
  species_name TEXT NOT NULL UNIQUE,
  category     TEXT,                    -- 'FC Algae','PW Algae','TOX Algae','TO Algae','not significant'
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE algae_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date TEXT NOT NULL,            -- YYYY-MM-DD
  station     TEXT NOT NULL,            -- 'RW','TW1','TW2'
  species_id  INTEGER NOT NULL REFERENCES algae_species(id),
  count       REAL,                     -- cells/100mL; NULL = ไม่พบ
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(record_date, station, species_id)
);
```

Seed จาก `server/config/algae_species_seed.json` (75 species, extracted จาก `Algae2569.xlsx` sheet "ต้นฉบับ")  
ทำครั้งแรกเมื่อ `algae_species` ว่างเปล่า (safe to restart)

---

## API Endpoints ใหม่ (`server/routes/algae.js`)

| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/algae/species?q=<text>` | ค้นหา species (LIKE %text%), max 50 results |
| POST | `/api/algae/species` | เพิ่ม species ใหม่ (body: division, species_name, category) |
| GET | `/api/algae/records?date=&station=` | ดึง records + join species_name |
| POST | `/api/algae/records` | upsert records (body: date, station, items:[{species_id, count}]) ใช้ `ON CONFLICT DO UPDATE` |
| DELETE | `/api/algae/records/:id` | ลบ record |

---

## AlgaeSpeciesPanel Component (`client/src/pages/Record.jsx`)

แสดงใต้ standard params เมื่อ `selectedSlot === 'weekly'`

### UI Features
- **Station tabs**: RW | TW1 | TW2 (แยก state ต่อ station)
- **Search box**: substring search → `/api/algae/species?q=...` (React Query, staleTime 5s)
- **ผลการค้นหา**: click → เพิ่มเข้า selected list; species ที่เลือกแล้ว → แสดง ✓ greyed out
- **Selected list**: species_name + count input (cells/100mL) + ปุ่มลบ
- **บันทึก**: POST `/api/algae/records` per station
- **Pre-fill**: โหลด existing records เมื่อ switch station/date (ถ้ายังไม่มีการแก้ไขใน session)
- **เพิ่มสาหร่ายใหม่**: form popup (division dropdown + species_name + category) → POST `/api/algae/species`

### ข้อสังเกต
- ใช้ React Query v5 — ไม่มี `onSuccess` callback → ใช้ `useEffect` แทน
- Pre-fill logic ตรวจ `prev[station]?.length > 0` ก่อน overwrite เพื่อรักษา in-progress edits

---

## Progress Behavior หลังการเปลี่ยน

| Node | params | expected/day |
|------|--------|-------------|
| Chemical | 12 params, weekly, skip_progress=true | 0 |
| Biological | 14 Algae (weekly, skip_progress=true) + 4 Bacteria (daily) | 4 |

Bacteria TW1/TW2: `Bacteria.TW1.Coliform`, `Bacteria.TW1.EColi`, `Bacteria.TW2.Coliform`, `Bacteria.TW2.EColi` — daily, ไม่มี skip_progress

---

## Algae Source Data

**File:** `Algae2569.xlsx` (project root)
- Sheet "ต้นฉบับ" = master list ทุก species (~75 species, 7 divisions)
- Sheets อื่น (35 sheets) = dated recording sheets เดิม (ม.ค.–มิ.ย. 2569)

**Divisions ที่ seed ไว้:**
`Bacillariophyceae`, `Chlorophyta`, `Cyanophyta`, `Euglenophyta`, `Cryptophyta`, `Pyrrhophyta`, `Chrysophyta`

---

## Pending Items (อัปเดต)

| Item | Status | Notes |
|------|--------|-------|
| Weekly Algae species recording | ✅ Done | AlgaeSpeciesPanel + DB + API |
| Weekly frequency (Chemical, Biological Algae) | ✅ Done | skip_progress=true |
| Bacteria TW1/TW2 daily | ✅ Done | คงเดิม |
| Uroboros API (ChemIntake) | Open | ยังไม่ implement ฝั่ง Uroboros |
| AquaDAT write | Open | POST ค่าไปยัง AquaDAT GraphQL ยังไม่ implement |
| Slide panel CAR save wiring | Open | Section 2–5 ยังเป็น UI only |
| CAR number auto-generation | Open | Format `CQ-{seq}/{yy}` |
| Excel write service (Python delay) | Open | ดีเลย 4-6 วิ — แก้ด้วย Flask microservice |
| Report page | Open | |

---

## Suggested Skills for Next Session

- `/handoff` — update this doc at end of each session
- `/code-review` — ก่อน go live Algae recording
- `/xlsx` — ถ้า implement รายงาน Algae weekly export
