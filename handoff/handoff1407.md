# Handoff — 14 July 2026

## Project
**LabVenture AquaDAT Operator Recorder — Excel-like Table UI (OpRecord)**
Stack: React 18 frontend (Vite) · Node/Express backend (port 3001) · BellBeast ASP.NET (port 443, serves `client/dist`)

Working directories:
- LabVenture: `C:\Users\peera\OneDrive\Desktop\LabVenture`
- Client: `C:\Users\peera\OneDrive\Desktop\LabVenture\client`
- Server: `C:\Users\peera\OneDrive\Desktop\LabVenture\server`

Build command: `cd client && npm run build` → ผลไปที่ `client/dist` แล้ว BellBeast serve อัตโนมัติ (ไม่ต้อง restart)

URL ทดสอบ: `http://localhost:443/labventure/op-record?station=RWS1`

---

## Context — Session นี้ทำอะไร

Session นี้สร้างและขัดเกลา `client/src/pages/OpRecord.jsx` โดยเน้นที่ component `RecordingTable` ซึ่งเป็น Excel-like table สำหรับให้ operator บันทึกค่าทีละ topic (FLOW RPS1, PUMP STATUS ฯลฯ)

**เริ่มต้นจาก**: table พื้นฐานที่ใช้ได้แต่มี UX หลายจุดที่แย่
**จบที่**: table ที่ทำงานเป็น Excel จริงๆ พร้อม copy/paste range, keyboard nav, type-based input

---

## Feature ที่ Implement ใน Session นี้ (ทั้งหมดอยู่ใน `RecordingTable`)

### 1. ลบ Spinner ออกจาก TEXT dropdown
**ปัญหา**: TEXT type cell แสดง spinner ตอน hover ทำให้ดูเหมือน loading
**แก้**: ตรวจ type แล้วแสดง `<select>` (listbox) แทน `<input type="number">`

### 2. TEXT cell แสดงเป็น listbox โดยตรง (ไม่ต้อง click arrow)
**ปัญหา**: TEXT dropdown ต้องคลิก arrow เล็กๆ ก่อนถึงจะเปิด
**แก้**: ใช้ `<select size={opts.length + 1}>` แทน `<select size={1}>` → listbox เปิดทันทีเข้า edit mode

### 3. ไม่ขยาย column เมื่อ select TEXT cell
**ปัญหา**: เมื่อ click TEXT cell ทำให้ column กว้างขึ้นผิดปกติ
**แก้**: กำหนด `minWidth: '90px'` แทนการใช้ width อัตโนมัติ + `absolute` positioning ออกจาก flow

### 4. Type-based display formatting
- `INT` → `Math.round()` ไม่มีจุดทศนิยม
- `FLOAT(n)` → `num.toFixed(n)` เช่น FLOAT(2) → "1.00"
- ฟังก์ชัน: `formatDisplayVal(val, type)` และ `formatAndCommit(p, slot)` (เรียกเมื่อออกจาก edit)

### 5. Excel-like Ctrl+C / Ctrl+V range copy/paste
- Ctrl+C บน selected cell/range → เก็บใน React state `clipboard` + set `copiedRange` สำหรับ marching ants
- Ctrl+V บน target cell → paste โดย tile ถ้า dest range ใหญ่กว่า src
- **Marching ants**: CSS animation (เส้นประสีน้ำเงินวิ่ง) บอกว่า range ไหนถูก copy — inject ผ่าน `injectMarchingAntsCSS()` ที่รัน useEffect ครั้งแรก
- Ctrl+C ยัง write ไปยัง OS clipboard (`navigator.clipboard.writeText`) เป็น tab-separated text

### 6. TEXT paste validation
**ปัญหา**: paste TEXT value ข้าม cell ได้แม้ค่าไม่อยู่ใน options เช่น "AUTO" → cell ที่มี {ON, STANDBY, REPAIR}
**แก้**: ใน `handlePaste()` ตรวจ `getCellOptions(p)` ของ target cell ก่อน paste — ถ้าค่าไม่อยู่ใน options ให้ข้ามเลย

### 7. FLOAT/INT input character filtering
**ปัญหา**: `<input type="text">` ให้พิมพ์ตัวอักษรได้
**แก้**: `onChange` handler filter ด้วย regex:
```js
const filtered = raw
  .replace(isInt ? /[^0-9\-]/g : /[^0-9.\-]/g, '')  // strip non-numeric
  .replace(/(?<=.)-/g, '')                            // minus ที่ต้นเท่านั้น
  .replace(/(\..*)\./g, '$1');                        // ทศนิยมเดียว
```

### 8. Focus fix — real keyboard ทำงานได้ (root cause ที่แท้จริง)
**ปัญหา root cause**: TD `onMouseDown` เรียก `e.preventDefault()` → Chrome block `.focus()` ทุกรูปแบบรวมถึง setTimeout
**อาการ**: Ctrl+C/V จาก real keyboard ไม่ทำงาน (ไม่มี marching ants, ไม่มี paste) แม้ Chrome extension test จะผ่าน
**แก้**: ลบ `e.preventDefault()` ออกจาก TD `onMouseDown` เพราะ CSS `select-none` บน cell div ทำหน้าที่ป้องกัน text-selection อยู่แล้ว → Chrome handle focus ให้เองตามธรรมชาติ
```js
onMouseDown={e => {
  if (e.button !== 0) return;
  // ไม่มี e.preventDefault() — CSS select-none จัดการ text-selection แล้ว
  isDragging.current = true;
  setSelAnchor({ si, pi });
  setSelCell({ si, pi });
  setEditCell(null);
  setCopiedRange(null);
  wrapRef.current?.focus();  // synchronous, works without preventDefault
}}
```

---

## Architecture ของ RecordingTable

```
OpRecord.jsx
└── RecordingTable (1 instance ต่อ 1 topic)
    ├── wrapRef  — div tabIndex=0, รับ keyboard events (handleWrapKeyDown)
    ├── selCell / selAnchor — active cell + drag anchor (range selection)
    ├── editCell — { si, pi } เมื่ออยู่ใน edit mode (null = navigation mode)
    ├── clipboard — { rows[][], h, w } internal copy buffer
    ├── copiedRange — { r1,c1,r2,c2 } สำหรับ marching ants
    └── dirtyRef — ref mirror ของ dirtyValues (ป้องกัน stale closure)
```

**Data flow:**
```
operator_nodes.json → topic.params (configparam_id, type, options)
                    → topic.time_slot → topicSlots() → ["00:00","02:00",...]
                    → onCellChange(topic, configparam_id, slot, value)
                    → dirtyValues state → POST /api/operator/record
```

**Type system ใน `operator_nodes.json`:**
- `FLOAT(n)` — ตัวเลขทศนิยม n ตำแหน่ง
- `INT` — ตัวเลขจำนวนเต็ม
- `TEXT{OPT1,OPT2,...}` — dropdown (listbox) มี options ตายตัว
- `readonly: true` — แสดงแต่แก้ไม่ได้
- `formula: "..."` — คำนวณจาก configparam_id อื่น (computed, ไม่ editable)

---

## โครงสร้าง operator_nodes.json

ไฟล์: `server/config/operator_nodes.json`
Format:
```json
{
  "stations": [
    {
      "id": "RWS1",
      "label": "สถานีน้ำดิบ 1",
      "sort": 1,
      "topics": [
        {
          "topic": "FLOW RPS1",
          "time_slot": 13,
          "params": [
            {
              "configparam_id": 1,
              "param_name": "...",
              "equipment_name": "...",
              "unit": "m³/s",
              "type": "FLOAT(2)"
            }
          ]
        }
      ]
    }
  ]
}
```

**Stations ทั้งหมดที่มีอยู่:**
| Station | Topics |
|---------|--------|
| RWS1 | FLOW RPS1, CURRENT TEMP, FEEDER 5&6, POWER / SPEED / BATTERY, PUMP STATUS, PUMP TOTALIZER & IHM, COMPENSATE, Temperature |
| RWS2 | FLOW RPS2, FEEDER 5&6, POWER / SPEED / BATTERY, PUMP TEMP, PUMP TOTALIZER & IHM, PUMP STATUS, COMPENSATE, other |
| CHEM1 | ALUM P#12, CHLORINE P#12, รับ/ส่ง/คืน, PACl P#12, POLYMER P#12, STOCK |
| CHEM2 | Alum set, PACl set, Polymer set, Chlorine set, Conclusion |
| TPS | Overview, Status, Property, Temperature, Energy, Other |
| DPS | Overview, Temperature, Energy, Other |
| CWS1 | Overview, Sludge |
| CWS2 | Sludge, Drain, Status, Speed, Other |
| FWS1 | Status, FTR Runtime, Backwashing, LEVEL, Other |
| FWS2 | FTR Runtime, Status, Backwashing#3, Backwashing#4, Level, Other |

---

## วิธี Scale ไปยัง Tab ถัดไป (เป้าหมายหลักของ session ถัดไป)

### เป้าหมาย: ทำ RWS#2 (และ tab อื่นๆ) ให้ได้ feature เดียวกับ RWS#1

**สิ่งที่ต้องทำ:**

#### Step 1: เพิ่ม params ของ station ใหม่ใน `operator_nodes.json`
อ้างอิง Excel sheet ของ station นั้น (เช่น RWS2 sheet) แล้ว map:
- column header → `equipment_name` + `param_name`
- unit → `unit`
- data type → `type` (FLOAT(n) / INT / TEXT{...})
- configparam_id → ดูจาก Aquadat หรือ mapping table

ตัวอย่าง RWS2 ที่มีอยู่แล้วใน nodes แต่อาจขาด params:
```json
{
  "topic": "FLOW RPS2",
  "time_slot": 13,
  "params": [ /* ตรวจสอบว่าครบไหม */ ]
}
```

#### Step 2: ตรวจสอบ URL param
OpRecord รับ `?station=RWS1` จาก URL → เปลี่ยนเป็น `?station=RWS2` เพื่อโหลด tab RWS#2

#### Step 3: ตรวจ configparam_id ว่าอยู่ใน Uroboros
ดูที่ `server/config/operator_configids.json` หรือ `Uroboros/operator_configids.json`
ถ้า configID ไม่อยู่ในไฟล์ → ต้องเพิ่มแล้ว republish Uroboros

#### Step 4: ทดสอบที่ URL
```
http://localhost:443/labventure/op-record?station=RWS2
```
- ตรวจว่า topic tabs ถูกต้อง
- ตรวจว่า cell types (FLOAT/INT/TEXT) render ถูก
- ทดสอบ copy/paste, keyboard navigation, input validation

**RecordingTable ไม่ต้องแก้โค้ดเลย** — feature ทุกอย่าง driven จาก `operator_nodes.json` 100%

---

## Key Functions Reference (OpRecord.jsx)

| Function | บทบาท |
|----------|--------|
| `RecordingTable` | main component, 1 instance / topic |
| `handleWrapKeyDown` | keyboard: arrows, tab, enter, delete, Ctrl+C/V |
| `handleCopy()` | copy selected range → clipboard state + OS clipboard |
| `handlePaste()` | paste clipboard → validate TEXT options → onCellChange |
| `startEdit(si,pi)` / `stopEdit()` | เข้า/ออก edit mode |
| `navigate(si,pi,shift)` | เลื่อน selection + extend range ถ้ากด Shift |
| `formatDisplayVal(val, type)` | format ค่าสำหรับแสดงผล (FLOAT→toFixed, INT→round) |
| `formatAndCommit(p, slot)` | format + write กลับ dirty state เมื่อออก edit |
| `getCellOptions(p)` | return string[] options ถ้า TEXT type, null ถ้าไม่ใช่ |
| `getCellType(p)` | return `'text'`, `'int'`, หรือ `'float'` |
| `injectMarchingAntsCSS()` | inject CSS animation สำหรับ marching ants (ครั้งเดียว) |
| `computeFormula(expr, slot, allHistory)` | คำนวณ formula expression จาก configparam_id อื่น |

---

## Known Issues & Gotchas

### Chrome Extension vs Real Keyboard
- Chrome extension (`mcp__claude-in-chrome__computer`) simulate click แบบ programmatic → ผ่านเสมอ
- Real physical mouse click ต้องการ native browser focus handling
- **อย่าเชื่อ Chrome extension test 100%** สำหรับ focus/keyboard behavior — ต้องให้ user ทดสอบจริง

### `e.preventDefault()` บน mousedown กับ `.focus()`
- ถ้าเรียก `e.preventDefault()` ใน mousedown handler → Chrome block `.focus()` แม้ใน setTimeout
- **วิธีแก้ที่ถูก**: ลบ `e.preventDefault()` + ใช้ CSS `select-none` แทน
- Reference: lines 769–780 ใน `OpRecord.jsx`

### Document-level capture listener vs handleWrapKeyDown
มีทั้งสอง handler สำหรับ Ctrl+C/V:
1. `handleWrapKeyDown` (lines 628–629) — fires เมื่อ wrapRef focused (primary)
2. `onDocKey` useEffect (lines 506–516) — fires ผ่าน document capture (backup)

ทั้งสองต้องตรวจ `editCell`/`editCellRef.current` ก่อนเสมอ ไม่เช่นนั้นจะ intercept native text copy ใน input

### TEXT cell type detection
```js
function getCellOptions(p) {
  const m = (p.type || '').match(/^TEXT\{(.+)\}$/);
  return m ? m[1].split(',').map(s => s.trim()) : null;
}
```
Format ใน JSON ต้องเป็น `"TEXT{OPT1,OPT2,OPT3}"` — ไม่มี space รอบ `{}`

### Build required หลังแก้ JSX
BellBeast serve จาก `client/dist` → ต้อง `npm run build` ทุกครั้ง → bundle filename เปลี่ยนทุก build (hash-based)
User ต้องทำ **`Ctrl+Shift+R`** (hard refresh) หลัง build เสร็จ

---

## Files ที่แก้ใน Session นี้

| File | การเปลี่ยนแปลง |
|------|----------------|
| `client/src/pages/OpRecord.jsx` | RecordingTable: ลบ spinner, listbox, column fix, formatting, copy/paste, TEXT validation, FLOAT/INT filter, focus fix |

---

## สิ่งที่ต้องทำใน Session ถัดไป

1. **เปิด Excel sheet RWS2** → map columns → เพิ่ม params ใน `operator_nodes.json` สำหรับ RWS2 ให้ครบ
2. **ทดสอบ** `?station=RWS2` ว่า feature ทุกอย่างทำงานเหมือน RWS1
3. **ทำซ้ำ** สำหรับ station อื่นตามลำดับความสำคัญ (CHEM1, CHEM2, TPS, ...)
4. **ตรวจ configparam_id** ของ station ใหม่ว่าอยู่ใน `operator_configids.json` ของ Uroboros แล้ว

### คำสั่งที่ใช้ซ้ำได้:
> "อยากปรับ RWS#2 ให้เหมือนกับ feature RWS#1 โดยอ้างอิง sheet RWS2 จากไฟล์ record_opt.xlsx (`C:\Users\peera\OneDrive\Desktop\LabVenture\record_opt.xlsx`)"

Agent ควร:
1. อ่าน `record_opt.xlsx` sheet "RWS2" ด้วย markitdown หรือ openpyxl
2. Map columns → params format ของ `operator_nodes.json`
3. เพิ่ม params เข้าไปใน station RWS2 topics
4. Build + ทดสอบ

---

## Previous Handoffs (อ้างอิง context ก่อนหน้า)

- `handoff\handoff1207.md` — Stage 0 offline history fetch (Uroboros integration)
- `handoff\handoff1107.md` — session ก่อนหน้า
- `handoff\plan.md` — stage machine architecture

---

## Suggested Skills

- `/handoff` — เมื่อ session ถัดไปเสร็จ เพื่อส่งต่อไป session ต่อไป
- `/xlsx` — อ่าน `record_opt.xlsx` เพื่อ map columns → `operator_nodes.json` params
- `/code-review` — ตรวจ OpRecord.jsx หลังเพิ่ม station ใหม่
