# LabVenture — Handoff Document (Session 4 + 5)
_Updated: 2026-07-17_

---

## Context

สืบเนื่องจาก [handoff.md](../handoff.md) (Session 3) ซึ่งครอบคลุม stack overview, bypass systems, role-based page access และ button guards ทั้งหมด อ่านไฟล์นั้นก่อนเสมอ — session นี้เพิ่มเติมเฉพาะส่วนที่ทำใหม่

---

## Session 4 — Time Row Configuration for OpRecord Tables

### สิ่งที่เพิ่ม

หน้า Operator Record (`/labventure/op-record?station=...`) แสดงตารางบันทึกข้อมูลแต่ละ topic โดย time rows (แถวเวลา) ก่อนหน้านี้รองรับแค่ 2 โหมด คือ 13 slots (ทุก 2 ชม.) หรือ 25 slots (ทุก 1 ชม.) ค่า `time_slot` อื่นๆ เช่น 2, 4, 7 ตกไปยัง default 13 slots ซึ่งไม่ถูกต้อง

### การเปลี่ยนแปลงที่ทำ

#### 1. `client/src/pages/OpRecord.jsx` — เพิ่ม custom time_slots array support

```js
function topicSlots(topic) {
  if (Array.isArray(topic?.time_slots)) return topic.time_slots;   // ← เพิ่ม
  const count = topic?.time_slot;
  if (count === 13) return Array.from({ length: 13 }, (_, i) => String(i * 2).padStart(2, '0') + ':00');
  if (count === 25) return Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');
  // legacy fallback ...
}
```

#### 2. `server/config/operator_nodes.json` — เพิ่ม `time_slots` field ให้ทุก topic ที่ต้องการ

เพิ่ม field `"time_slots": [...]` เข้าไปใน topic object โดย **ไม่ลบ** `time_slot` เดิม (backward compat)

| Station | Topic | time_slots |
|---------|-------|------------|
| RWS1 | COMPENSATE | `["00:00","24:00"]` |
| RWS2 | COMPENSATE | `["00:00","24:00"]` |
| CWS1 | %SLUDGE P#12 | `["00:00","02:00","06:00","10:00","14:00","18:00","22:00"]` |
| CWS1 | OVERVIEW P#12 | `["00:00","08:00","16:00","24:00"]` |
| CWS2 | %SLUDGE P#34 | `["00:00","02:00","06:00","10:00","14:00","18:00","22:00"]` |
| CWS2 | DRAIN P#34 | `["00:00","08:00","16:00","24:00"]` |
| FWS1 | STATUS P#12 | `["00:00","04:00","08:00","12:00","16:00","20:00","24:00"]` |
| FWS1 | FTR RUNTIME, ENERGY P#12 | `["00:00","24:00"]` |
| FWS1 | BACKWASHING P#12 | `["00:00","08:00","16:00","24:00"]` |
| FWS1 | LEVEL P#12 | `["00:00","04:00","08:00","12:00","16:00","20:00","24:00"]` |
| FWS2 | FTR RUNTIME, ENERGY P#34 | `["00:00","24:00"]` |
| FWS2 | STATUS P#34 | `["00:00","04:00","08:00","12:00","16:00","20:00","24:00"]` |
| FWS2 | BACKWASHING P#3 | `["00:00","08:00","16:00","24:00"]` |
| FWS2 | BACKWASHING P#4 | `["00:00","08:00","16:00","24:00"]` |
| FWS2 | LEVEL P#34 | `["00:00","04:00","08:00","12:00","16:00","20:00","24:00"]` |

> **หมายเหตุ**: ใน JSON ของ FWS2 ใช้ชื่อ topic ว่า "FTR RUNTIME, ENERGY **P#34**" และ "LEVEL **P#34**" (ไม่ใช่ P#12) — station FWS2 คือ "FWS เฟส 3-4"

---

## Session 5 — RecordingTable Cell UX Fixes

### ภาพรวม

Session นี้แก้ไข UX ของ `RecordingTable` component (`client/src/pages/OpRecord.jsx`) ซึ่งเป็น Excel-like editable grid ในหน้า Operator Record โดยทั้งหมด 6 bug fix

---

### Function Map ของ RecordingTable

```
RecordingTable (component)
├── State
│   ├── editCell        — { si, pi } | null (cell ที่กำลัง edit)
│   ├── selCell         — { si, pi } (cell ที่ถูก select)
│   ├── selAnchor       — { si, pi } | null (anchor สำหรับ range select)
│   ├── clipboard       — { rows, h, w } | null (internal clipboard)
│   └── copiedRange     — { r1,c1,r2,c2 } | null (marching ants range)
│
├── Refs
│   ├── wrapRef         — div[tabIndex=0] ที่ครอบทั้งตาราง (ต้อง focus เพื่อ Ctrl+C/V)
│   ├── editCellRef     — mirror ของ editCell state (stale-closure-safe)
│   ├── handleCopyRef   — ref to handleCopy (updated every render)
│   ├── handlePasteRef  — ref to handlePaste (updated every render)
│   ├── skipNextChangeRef — bool flag: skip next input onChange (ป้องกัน double-char)
│   └── preEditValueRef — { cpid, slot, hadDirty, value } บันทึกค่าก่อน enter edit
│
├── Key Functions
│   ├── startEdit(si, pi, initChar?)
│   │   ├── บันทึก preEditValueRef (hadDirty + pre-value)
│   │   ├── ถ้า initChar valid → onCellChange(initChar) + skipNextChangeRef=true
│   │   └── setEditCell(pos)
│   │
│   ├── stopEdit(advanceRow?)
│   │   ├── clears preEditValueRef
│   │   ├── setEditCell(null)
│   │   └── wrapRef.focus()
│   │
│   ├── cancelEdit()           ← ใหม่ (Escape)
│   │   ├── อ่าน preEditValueRef
│   │   ├── hadDirty=false → onCellChange(undefined) → DELETE dirty slot
│   │   ├── hadDirty=true  → onCellChange(pre.value) → restore dirty
│   │   └── setEditCell(null)
│   │
│   ├── formatAndCommit(p, slot)   ← เรียกตอน Enter/Tab/blur
│   │   ├── ถ้า raw empty → return
│   │   ├── ถ้า numeric + NaN → onCellChange('') [clear invalid]
│   │   ├── ถ้า hasDirty → return (อย่า reformat dirty)
│   │   └── ถ้า history + numeric → compare parseFloat ก่อน reformat
│   │
│   ├── handleCopy()
│   │   ├── getRange() → loop cells → build rows[]
│   │   ├── setClipboard({ rows, h, w })
│   │   ├── setCopiedRange (marching ants)
│   │   └── navigator.clipboard.writeText (OS clipboard, best-effort)
│   │
│   ├── handlePaste()
│   │   ├── อ่าน clipboard state (ไม่ใช่ OS clipboard)
│   │   └── loop range → onCellChange ทุก cell
│   │
│   └── handleWrapKeyDown(e)
│       ├── Arrow / Tab / Enter / F2 / Delete / Backspace
│       └── Ctrl+C/V → ใช้ e.code === 'KeyC'/'KeyV' (Thai keyboard safe)
│
└── Document listener (capture phase)
    └── onDocKey: Ctrl+C/V เมื่อ wrapRef เป็น ancestor ของ activeElement
```

---

### Bug Fixes ที่ทำใน Session 5

#### Fix 1 — Ctrl+C/V ไม่ทำงานเมื่อใช้ Thai keyboard

**Root cause**: `e.key` ของ Ctrl+C บน Thai keyboard layout คือ `"แ"` ไม่ใช่ `"c"` → check `e.key.toLowerCase() === 'c'` fail

**Fix**: เพิ่ม `|| e.code === 'KeyC'` / `|| e.code === 'KeyV'` ใน 2 จุด:
- `handleWrapKeyDown` (line ~678)
- `onDocKey` capture listener (line ~561)

```js
// ก่อน (พัง Thai keyboard)
if (e.ctrlKey && e.key.toLowerCase() === 'c') { ... }

// หลัง (รองรับทุก layout)
if (e.ctrlKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) { ... }
```

**Gotcha**: `e.code` คือ physical key position ไม่ขึ้นกับ OS keyboard layout — ใช้เสมอเมื่อ shortcut เป็น position-based

---

#### Fix 2 — คลิก topic tab แล้ว Ctrl+C ไม่ทำงาน (focus stolen)

**Root cause**: topic tab buttons เป็น `<button>` ปกติ → เมื่อคลิก browser ย้าย focus จาก `wrapRef` → `onDocKey` check `wrapRef.contains(activeElement)` fail

**Fix**: เพิ่ม `onMouseDown={e => e.preventDefault()}` บน topic tab buttons

```jsx
<button
  onMouseDown={e => e.preventDefault()} // ← เพิ่ม: ป้องกัน focus steal
  onClick={() => setActiveTopic(t.topic)}
  ...
>
```

**Gotcha**: `e.preventDefault()` บน mousedown ป้องกัน browser default focus behavior แต่ **ไม่บล็อค** `click` event — setActiveTopic ยังทำงานปกติ

---

#### Fix 3 — พิมพ์ทับ non-empty cell: old value แสดง flash ก่อน replace

**Root cause**: เดิมใช้ `pendingKey` useEffect เพื่อ set dirty → effect fires หลัง browser paint → input แสดง old value ก่อนแล้วค่อย jump

**Fix**: เรียก `onCellChange(initChar)` ใน `startEdit()` โดยตรง (batches กับ `setEditCell` ใน React render เดียว)

```js
// ก่อน: pendingKey ref + useEffect
pendingKey.current = initChar;
setEditCell(pos);
// useEffect([editCell]): onCellChange(pendingKey) ← หลัง paint

// หลัง: direct call ใน event handler (batched)
if (initChar !== null) onCellChange(topic.topic, cpid, slot, initChar);
setEditCell(pos);
```

**Gotcha**: React 18 batches setState calls ใน event handlers → ทั้ง onCellChange (parent setState) และ setEditCell render พร้อมกัน → input แสดง initChar ทันทีไม่มี flash

---

#### Fix 4 — พิมพ์ทับ: ตัวแรก double (เช่น พิมพ์ "1" ได้ "11")

**Root cause**: หลัง React flush setEditCell synchronously → input mount + autoFocus → keypress event ที่กำลัง process (จาก "1") ยิงบน input → onChange fire → dirty "1" → "11"

**Fix**: `skipNextChangeRef` flag

```js
// startEdit เมื่อมี initChar:
skipNextChangeRef.current = true;

// input onChange:
onChange={e => {
  if (skipNextChangeRef.current) { skipNextChangeRef.current = false; return; }
  // ... ปกติ
}}
```

**Gotcha**: ใน React 18 event handlers, state flush เกิด synchronously หลัง handler return → autoFocus เกิดก่อน keypress → keypress ยิงบน input ใหม่ (ไม่ใช่ wrapRef) → ต้องมี guard

---

#### Fix 5 — Escape ไม่คืนค่าเดิม

**Root cause**: `stopEdit()` แค่ clear `editCell` แต่ dirty ยังอยู่

**Fix**: `cancelEdit()` function ใหม่ + `preEditValueRef` + support `undefined` ใน `handleCellChange`

```js
function cancelEdit() {
  const pre = preEditValueRef.current;
  preEditValueRef.current = null;
  if (pre) {
    if (pre.hadDirty) onCellChange(topic.topic, pre.cpid, pre.slot, pre.value);
    else onCellChange(topic.topic, pre.cpid, pre.slot, undefined); // delete dirty
  }
  setEditCell(null);
  wrapRef.current?.focus();
}
```

Parent `handleCellChange` แก้ให้รองรับ `value === undefined`:

```js
function handleCellChange(topicName, configparam_id, slot, value) {
  setDirtyValues(prev => {
    const slotMap = { ...(prev[topicName]?.[configparam_id] || {}) };
    if (value === undefined) { delete slotMap[slot]; }  // ← ใหม่
    else { slotMap[slot] = value; }
    ...
  });
}
```

**Gotcha**: `dirty[cpid][slot] = ''` (empty string) ≠ `undefined` — `getVal()` return "" ไม่ใช่ history value ดังนั้นต้องใช้ `delete` จริงๆ ผ่าน `value=undefined` path

---

#### Fix 6 — พิมพ์ตัวอักษรบน numeric cell → Enter/Escape ได้ "—" แทนค่าเดิม

**Root cause**: `initChar = "a"` ถูกส่งเข้า `startEdit` → dirty = "a" → Enter: `formatAndCommit` เห็น NaN → `onCellChange('')` → dirty = "" → แสดง "—"

**Fix**: Filter `initChar` ที่ `handleWrapKeyDown` ก่อนส่ง:

```js
// handleWrapKeyDown → default case:
if (getCellType(p) !== 'text') {
  const t = (p.type || '').trim();
  const isInt = t === 'INT';
  const filtered = e.key.replace(isInt ? /[^0-9\-]/g : /[^0-9.\-]/g, '');
  startEdit(si, pi, filtered || null); // invalid key → null = enter edit at end
} else startEdit(si, pi);
```

ถ้า key ไม่ valid สำหรับ type นั้น → `filtered = ""` → `null` → startEdit เข้า edit mode ที่ end ของค่าเดิม (ไม่แตะ dirty)

**Gotcha**: `formatAndCommit` ยังมี NaN check อยู่ (สำหรับกรณีที่ user ลบตัวเลขทั้งหมดจนเหลือแค่ "-" หรือ ".") — ควรทิ้ง logic นั้นไว้

---

### พฤติกรรมสุดท้ายที่ถูกต้อง (RecordingTable)

| สถานการณ์ | ผลลัพธ์ |
|-----------|---------|
| Cell ว่าง + พิมพ์ตัวเลข | input แสดงตัวเลขที่พิมพ์ (replace) |
| Cell มีค่า + พิมพ์ตัวเลข | input แสดงตัวเลขที่พิมพ์ทันที (ไม่ flash) |
| Cell มีค่า + Enter | input เปิดแสดง raw value ("4.5" ไม่ใช่ "4.50"), cursor ท้าย |
| Cell มีค่า + พิมพ์ตัวอักษรบน numeric | input เปิดแสดงค่าเดิม (invalid key ถูก ignore) |
| Escape หลัง start typing | คืนค่าเดิมก่อน edit (delete dirty ถ้าไม่มี dirty มาก่อน) |
| Escape หลัง Enter (ไม่ได้พิมพ์) | คืนค่าเดิม |
| Ctrl+C/V (Thai keyboard) | ทำงานได้ (ใช้ e.code) |
| คลิก topic tab แล้ว Ctrl+C | ทำงานได้ (wrapRef ไม่เสีย focus) |
| FLOAT(2) history "4.5" → Enter → Enter | ไม่เพิ่มใน dirty (4.5 == 4.50 numerically) |

---

### Key Files (Session 4 + 5)

| File | การเปลี่ยนแปลง |
|------|----------------|
| `client/src/pages/OpRecord.jsx` | Session 4: `topicSlots()` + Session 5: RecordingTable cell UX ทั้งหมด |
| `server/config/operator_nodes.json` | Session 4: `time_slots` field ใน 15 topics |

---

## Build Reminder

```powershell
Set-Location "C:\Users\peera\OneDrive\Desktop\LabVenture\client"
npx vite build
```

> **สำคัญ**: ต้องใช้ PowerShell เท่านั้น — Bash tool เขียนไปยัง sandboxed FS ไม่ใช่ Windows จริง

แล้ว hard refresh (`Ctrl+Shift+R`) ใน browser

---

## Suggested Skills

- `/verify` — Build และทดสอบ `/labventure/op-record` ใน browser ว่า cell behaviors ถูกต้องตาม table ด้านบน
- `/handoff` — สร้าง handoff เมื่อจบ session ถัดไป
- `/code-review` — ตรวจ `cancelEdit`, `skipNextChangeRef`, `formatAndCommit` ว่า edge cases ครบ
