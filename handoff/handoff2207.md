# Handoff — LabVenture (2026-07-22)

Previous handoff: `handoff/handoff2007.md`

---

# Session 1 — sessionStorage Persistence สำหรับ Daily Report Tab

> เพิ่ม **sessionStorage persistence** ให้กับ Daily Report tab — ข้อมูลจาก QUERY ไม่หายอีกแม้ผู้ใช้สลับไป station อื่นแล้วกลับมา

## 1. ปัญหาที่แก้

### Root Cause
`DailyReportTab` ถูก **unmount** ทุกครั้งที่ `activeStation !== 'DAILY'` เพราะ conditional render ใน `OpRecord.jsx:2791`:

```jsx
{activeStation === 'DAILY' && (
  <DailyReportTab selectedDate={selectedDate} stage={stage} />
)}
```

เมื่อผู้ใช้กด QUERY → ได้ข้อมูล → สลับไป RWS1 → กลับมา DAILY: React unmount `DailyReportTab` → state ทั้งหมดถูกลบ → หน้า Daily Report ว่างเปล่า

---

## 2. การวิเคราะห์ 3 วิธี (Design Decision)

| วิธี | หลักการ | บรรทัดที่เปลี่ยน | อยู่หลัง refresh? |
|---|---|---|---|
| **1. sessionStorage** | บันทึกลง browser แล้ว restore ตอน mount | ~15 | ✓ ใช่ (ใน session) |
| **2. Lift State Up** | ย้าย state ขึ้นไปไว้ใน `OpRecord` | ~50+ | ✕ ไม่ |
| **3. CSS Hidden** | `hidden` class แทน unmount | 2 | ✕ ไม่ |

เลือก **วิธี 1 (sessionStorage)** เพราะ:
- ปิด browser = เลิกงาน; sessionStorage หายพร้อม tab ปิดเป็นพฤติกรรมที่ถูกต้อง
- Key ใช้วันที่ (`dr_report_2026-07-22`) ป้องกัน stale data ข้ามวัน
- แก้เฉพาะใน `DailyReportTab` ไม่กระทบ `OpRecord`
- วิธี 3 ทำให้ interval/stream ทำงานเบื้องหลังตลอดแม้ซ่อนอยู่ — ไม่เหมาะ

---

## 3. การ Implement

### ไฟล์ที่เปลี่ยน: `client/src/pages/OpRecord.jsx`

**จุดที่ 1** — `useEffect` restore เมื่อ mount หรือเปลี่ยนวันที่:
```jsx
useEffect(() => {
  try {
    const cached = sessionStorage.getItem(`dr_report_${selectedDate}`);
    setReportData(cached ? JSON.parse(cached) : null);
  } catch { setReportData(null); }
  try {
    const cached = sessionStorage.getItem(`dr_fwsbw_${selectedDate}`);
    setFwsBW(cached ? JSON.parse(cached) : null);
  } catch { setFwsBW(null); }
}, [selectedDate]);
```

**จุดที่ 2** — บันทึก `reportData` หลัง stream เสร็จ:
```jsx
} else if (data.type === 'done') {
  setReportData(data.report);
  try { sessionStorage.setItem(`dr_report_${selectedDate}`, JSON.stringify(data.report)); } catch {}
```

**จุดที่ 3** — บันทึก `fwsBW` หลัง fetch backwash:
```jsx
setFwsBW({ p12, p3, p4 });
try { sessionStorage.setItem(`dr_fwsbw_${selectedDate}`, JSON.stringify({ p12, p3, p4 })); } catch {}
```

### sessionStorage Keys

| Key | เนื้อหา |
|---|---|
| `dr_report_YYYY-MM-DD` | `reportData` object จาก `/api/daily-report/stream` |
| `dr_fwsbw_YYYY-MM-DD` | backwash history สำหรับ FWS1/FWS2 |

---

# Session 2 — ESC ปิด Query Popup + Popup ยืนยันก่อนสลับ Station

> เพิ่ม 2 animation/UX improvements ใน `OpRecord.jsx`

## 1. ESC ปิด Query Popup (DAILY Tab)

เพิ่ม `useEffect` subscribe `keydown` เฉพาะช่วงที่ modal เปิด:
```jsx
useEffect(() => {
  if (!showQueryModal) return;
  function onKey(e) {
    if (e.key === 'Escape' && !querying) setShowQueryModal(false);
  }
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [showQueryModal, querying]);
```

กด ESC ปิด modal ได้ทันที; ถ้ากำลัง query อยู่ (`querying = true`) → ESC ไม่ทำงาน

---

## 2. Popup ยืนยันก่อนสลับ Station หลัก

**State ใหม่:**
```jsx
const [pendingStationSwitch, setPendingStationSwitch] = useState(null);
```

**`handleStationChange` + helper functions:**
```jsx
function handleStationChange(id) {
  if (!ACTIVE_STATIONS.has(id)) return;
  if (id === activeStation) return;
  const hasPending = activeStation !== 'DAILY' && stationDef?.topics?.some(t => {
    const d = dirtyValues[t.topic] || {};
    return Object.values(d).some(sm => sm && Object.values(sm).some(v => v !== ''));
  });
  if (hasPending) { setPendingStationSwitch(id); return; }
  doStationChange(id);
}
```

**Logic กรณีต่าง ๆ:**

| กรณี | พฤติกรรม |
|---|---|
| สลับ station โดยไม่มี dirty | สลับทันที ไม่มี popup |
| สลับ station โดยมี dirty | popup ขึ้น รอยืนยัน |
| กด [ส่งข้อมูล] → topic ใดส่ง error | ยังคงสลับ station ต่อ |
| DAILY → station อื่น | ไม่ trigger popup |

---

# Session 3 — Super Admin Bypass สามารถบันทึกใน Record.jsx

> แก้ให้ Super Admin bypass (`role = 'superadmin'`) กดปุ่มบันทึกใน `/labventure/record` ได้

## 1. Root Cause (2 ชั้น)

**ชั้นที่ 1 — Frontend `Record.jsx:532`:**
```js
const bypassRole = (me?.bypass && me?.role) ? me.role : null;
const canRecord = !bypassRole;  // false สำหรับทุก bypass user รวม superadmin
```

**ชั้นที่ 2** — `POST /api/write/nodes` ไม่มี bypass check เพราะ `requireAuth` ตรวจแค่ว่ามี cookie ไหม

## 2. การแก้ไข

**`client/src/pages/Record.jsx` (~line 532):**
```js
// เดิม
const bypassRole = (me?.bypass && me?.role) ? me.role : null;
// ใหม่ — ยกเว้น superadmin
const bypassRole = (me?.bypass && me?.role && me.role !== 'superadmin') ? me.role : null;
const canRecord = !bypassRole;
```

**`client/src/pages/OpRecord.jsx` (~line 2476):**
```js
// เดิม
const canRecord = !(me?.bypass);
// ใหม่
const canRecord = !(me?.bypass) || me?.role === 'superadmin';
```

**`server/routes/operator.js` (~line 357)** — เพิ่ม bypass token detection ใน stage 1:
```js
let isBypassToken = false;
try {
  const parts = token.split('.');
  if (parts.length === 3) {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    isBypassToken = !!p.bypass;
  }
} catch {}

if (isBypassToken) {
  const result = await forwardToUroboros(records, station_id);
  return res.json({ ...result, stage, routed_to: 'uroboros' });
}
```

| User role | ก่อนแก้ | หลังแก้ |
|---|---|---|
| superadmin bypass | ปุ่ม disabled | ปุ่ม enabled, บันทึกได้ปกติ |
| scientist bypass / operator bypass | ปุ่ม disabled | ยังคง disabled (intentional) |
| real login | ปุ่ม enabled | ไม่เปลี่ยน |

---

# Session 4 — Stage Awareness สำหรับ SCI บันทึก (Record.jsx)

> เพิ่ม stage awareness ให้ SCI บันทึก: Login แสดง offline UI ที่ stage=0, bypass users บันทึกได้ขณะออฟไลน์, connection indicator, auto-switch 1→0, และ fix bug dedup pending queue

## 1. Background & Design Decisions

**ทำไมต้องทำ:** `Record.jsx` (SCI) ไม่รู้จัก stage เลย ทำให้:
- Stage 0: user login ไม่ผ่าน AquaDAT → เข้าระบบไม่ได้ → บันทึกไม่ได้
- Bug: แก้ค่าเดิม 3 ครั้ง → queue แสดง "3 รายการ" แทน "1 รายการ"

**Semantics สำหรับ SCI (ต่างจาก OP):**
- Stage 1 = Stage 2 สำหรับ SCI (ไม่มี auto-retry เมื่อ stage=2)
- Queue button ต้องกดเองเสมอ — ไม่มี auto-send

---

## 2. Change 1 — Login.jsx: Stage-Aware UI

**ไฟล์:** `client/src/pages/Login.jsx`

เพิ่ม `get` ใน import, `useEffect` ดึง stage ตอน mount (`useState(null)` กัน flash):

```js
const [stage, setStage] = useState(null); // null = กำลังตรวจสอบ

useEffect(() => {
  get('/api/operator/stage')
    .then(d => setStage(d.stage))
    .catch(() => setStage(1));
}, []);
```

**3 branch JSX:**

| `stage` | UI |
|---|---|
| `null` | "กำลังตรวจสอบการเชื่อมต่อ..." (ป้องกัน flash) |
| `0` | Banner "⚠️ ระบบออฟไลน์" + bypass buttons เท่านั้น |
| `!== 0` | Form AD username/password + bypass section (เดิม) |

**ทำไม `useState(null)` ไม่ใช่ `1`:** ถ้า default เป็น 1 จะ render form ปกติแล้ว flash เปลี่ยนเป็น offline UI ใน ~1 RTT

**หมายเหตุ:** `GET /api/operator/stage` ไม่ require auth — เรียกได้ก่อน login

---

## 3. Change 2 — Record.jsx: canRecord ที่ Stage 0

**ไฟล์:** `client/src/pages/Record.jsx` (~line 548–549)

```js
// เดิม
const bypassRole = (me?.bypass && me?.role && me.role !== 'superadmin') ? me.role : null;
const canRecord = !bypassRole;

// ใหม่
const bypassRole = (me?.bypass && me?.role && me.role !== 'superadmin') ? me.role : null;
const canRecord = !bypassRole || stage === 0;  // bypass users บันทึกได้เมื่อออฟไลน์
```

ที่ stage=1: พฤติกรรมเดิม (bypass ไม่บันทึก ยกเว้น superadmin)
ที่ stage=0: ทุก bypass role บันทึกได้ เพราะข้อมูลไปลง SQLite + queue เสมอ

---

## 4. Change 3 — Record.jsx: Connection Status Indicator

**ไฟล์:** `client/src/pages/Record.jsx` (~line 696)

เพิ่ม dot indicator แถวเดียวกับ queue button:

```jsx
<div className="flex items-center gap-2">
  <span className={`flex items-center gap-1 text-xs font-medium ${
    stage === 0 ? 'text-red-500' : stage === 2 ? 'text-amber-500' : 'text-emerald-600'
  }`}>
    <span className={`inline-block w-2 h-2 rounded-full ${
      stage === 0 ? 'bg-red-500' : stage === 2 ? 'bg-amber-400' : 'bg-emerald-500'
    }`} />
    {stage === 0 ? 'ออฟไลน์' : stage === 2 ? 'ซิงค์' : 'AquaDAT'}
  </span>
  {queueCount > 0 && <button ...>⚠️ AquaDAT ค้าง {queueCount} รายการ — ส่งใหม่</button>}
</div>
```

| Stage | Dot | Label |
|---|---|---|
| 1 | 🟢 `bg-emerald-500` | AquaDAT |
| 0 | 🔴 `bg-red-500` | ออฟไลน์ |
| 2 | 🟡 `bg-amber-400` | ซิงค์ |

---

## 5. Change 4 — Record.jsx: Stage Polling + Auto-Switch 1→0

**ไฟล์:** `client/src/pages/Record.jsx`

เพิ่ม `useRef` ใน import. เพิ่ม state และ 2 effects หลัง `qc = useQueryClient()`:

```js
const [stage, setStage] = useState(1);
const autoSwitchFiredRef = useRef(false);
```

**Effect 1 — Stage polling** (วางก่อน `me` ถูก declare):
```js
useEffect(() => {
  let cancelled = false;
  async function fetchStage() {
    try {
      const { stage: s } = await get('/api/operator/stage');
      if (!cancelled) setStage(s);
    } catch {}
  }
  fetchStage();
  const id = setInterval(fetchStage, 30_000);
  return () => { cancelled = true; clearInterval(id); };
}, []);
```

**Effect 2 — Auto-switch** (วางหลัง `const me = meData` เพื่อกัน TDZ error):
```js
useEffect(() => {
  if (stage !== 0) { autoSwitchFiredRef.current = false; return; }
  if (autoSwitchFiredRef.current) return;
  if (!me || me.bypass) return;
  if (me.role !== 'scientist') return;
  autoSwitchFiredRef.current = true;
  post('/api/auth/bypass', { role: 'scientist' })
    .then(() => qc.invalidateQueries({ queryKey: ['me'] }))
    .catch(() => { autoSwitchFiredRef.current = false; });
}, [stage, me?.bypass, me?.role, qc]); // eslint-disable-line
```

**ทำไมต้อง 2 effects แยกกัน:**
- Effect 1 ไม่ต้องการ `me` → deps array สั้น, ไม่ re-subscribe ทุกครั้ง `me` เปลี่ยน
- Effect 2 ใช้ `[stage, me?.bypass, me?.role]` เพื่อ fire เมื่อทั้ง stage และ me พร้อม (แก้ race condition กรณี page load ขณะ stage=0 อยู่แล้ว)
- `autoSwitchFiredRef` ป้องกัน double-call เมื่อ React Query refetch ด้วย stale `me` data
- Reset ref เมื่อ stage ≠ 0 เพื่อให้ future 1→0 transition trigger ใหม่ได้

**หมายเหตุ Admin:** ผู้ใช้ที่เป็น `is_admin=1` ใน whitelist จะได้ `me.role = null` → ไม่ auto-switch → ต้อง navigate ไป /login แล้วเลือก bypass role เอง

**Stage 1 = Stage 2 สำหรับ SCI:** Effect 2 ตอบสนองแค่ stage=0 เท่านั้น; stage=2 ไม่มีการกระทำใด ๆ (indicator แสดง "ซิงค์" เพื่อบอกข้อมูลเท่านั้น)

---

## 6. Change 6 — write.js: Dedup Pending Queue (Bug Fix)

**ไฟล์:** `server/routes/write.js` — catch block หลัง `writeData` fail (~line 304)

**Bug เดิม:** plain `INSERT INTO aquadat_queue` ทุกครั้งที่ AquaDAT ล้มเหลว → แก้ค่าเดิม 3 ครั้ง = 3 rows = "ค้าง 3 รายการ"

**ข้อควรระวัง Critical:** ต้อง match ทั้ง `trans_dtm` **และ** `trans_time` (จาก payload) — ถ้า match แค่วันที่จะลบ queue rows ของ slot อื่นที่ configparam_id ซ้อนกัน → data loss

```js
const transDtm = finalRecords[0]?.trans_dtm ?? '';
const newTransTime = aquadatRecords[0]?.trans_time;  // e.g. '09:00' หรือ 'daily'
const newCfgIds = new Set(aquadatRecords.map(r => r.configparam_id));

// ลบ stale rows ของ slot เดียวกัน (pending และ dead) ก่อน insert
const existingRows = db.all(
  `SELECT id, payload FROM aquadat_queue WHERE trans_dtm = ? AND status IN ('pending','dead')`,
  [transDtm]
);
for (const row of existingRows) {
  try {
    const p = JSON.parse(row.payload);
    const sameSlot = p[0]?.trans_time === newTransTime;
    const overlaps = p.some(r => newCfgIds.has(r.configparam_id));
    if (sameSlot && overlaps) db.run(`DELETE FROM aquadat_queue WHERE id = ?`, [row.id]);
  } catch {}
}

db.run(
  `INSERT INTO aquadat_queue (created_at, trans_dtm, payload, status) VALUES (?, ?, ?, 'pending')`,
  [now, transDtm, JSON.stringify(aquadatRecords)]
);
```

`dead` rows รวมในการ cleanup เพื่อกัน count เป็น 2 เมื่อ re-record slot ที่เคย dead

---

## 7. สรุปไฟล์ที่เปลี่ยนแปลง (Session 4)

| ไฟล์ | สิ่งที่เปลี่ยน |
|---|---|
| `client/src/pages/Login.jsx` | import `get`+`useEffect`, stage state (null), 3-branch JSX |
| `client/src/pages/Record.jsx` | import `useRef`, stage state + autoSwitchFiredRef, polling effect, auto-switch effect (หลัง `me`), canRecord fix, indicator JSX |
| `server/routes/write.js` | dedup logic ก่อน INSERT (trans_time + trans_dtm + configparam_id matching) |

ต้อง rebuild หลังแก้ frontend: `cd client && npm run build`

---

## 8. สิ่งที่ยังไม่ได้ทดสอบ / ข้อจำกัด

- **Auto-switch 1→0 end-to-end:** ต้องการ real AquaDAT login (stage=1) แล้วให้ stage ตกเป็น 0 ขณะอยู่ที่ /record — ทดสอบได้เฉพาะบน machine ใน intranet
- **writeData TCP timeout:** `fetch` ใน `aquadat.js` ไม่มี `AbortSignal` → รอ OS TCP timeout (~60s+) เมื่อ AquaDAT unreachable — เป็น existing behavior ไม่ใช่ regression
- **Queue count หลัง dedup:** ยืนยันจาก code review; ทดสอบ live ไม่ได้จบสมบูรณ์เพราะ POST ค้างรอ timeout

---

## 9. Suggested Skills สำหรับ Session ถัดไป

- `/handoff` — สืบทอด context ต่อ
- `/run` — start dev server ทดสอบใน browser
