# Handoff — LabVenture Formula Columns & Table Changes (2026-07-18)

**Project:** LabVenture — AquaDAT Scientist Recorder  
**Working dir:** `C:\Users\peera\OneDrive\Desktop\LabVenture`  
**Session date:** 2026-07-18 (sessions 1–3)  
**Branch:** master

---

## ภาพรวม

Session นี้ทำ 2 งานหลัก:
1. **ปรับโครงสร้างตาราง** — เปลี่ยน `time_slot` ของ TPS/DPS และเพิ่ม sentinel logic ใน `computeFormula()`
2. **เพิ่ม Formula Column** — RWS1, RWS2, TPS, DPS, CHEM1, CHEM2 ทั้งหมด 20 formula

---

## ส่วนที่ 1 — ปรับโครงสร้างตาราง

### 1.1 Code — `computeFormula()` sentinel (OpRecord.jsx:569)

เพิ่ม branch ก่อน `!isFinite` check:
```js
if (result === undefined || result === null) return null;
```

เมื่อ formula คืน `undefined` → `computeFormula` คืน `null` → cell นั้น editable (ยอดยกมา)

### 1.2 Code — Cell rendering per-slot (OpRecord.jsx)

แทน `isFormula` (param-level) ด้วย `isFormulaSlot` (slot-level):
```js
const formulaVal = isFormula ? getDisplayVal(p, slot) : null;
const isFormulaSlot = isFormula && formulaVal !== null;
const isReadonly = !!(p.readonly || isFormulaSlot);
```

Styling (`bg-[#ddeeff]`, ƒ indicator) ผูกกับ `isFormulaSlot` แทน

### 1.3 Code — `topicSlots()` เพิ่ม time_slot: 9 (OpRecord.jsx:20)

```js
if (count === 9) return Array.from({ length: 9 }, (_, i) => String(i * 3).padStart(2, '0') + ':00');
```

ผลิต: `["00:00","03:00","06:00","09:00","12:00","15:00","18:00","21:00","24:00"]`

### 1.4 TPS — เปลี่ยน time_slot ต่อ topic

| Topic | เดิม | ใหม่ | Interval |
|-------|------|------|---------|
| FLOW, PRESSURE, POWER, %SPEED | 13 | **25** | ทุก 1h |
| I.H.M & ENERGY | 13 | **25** | ทุก 1h |
| STATUS PUMP | 13 | **25** | ทุก 1h |
| SUCTION DISCHARGE PRESSURE, CURRENT | 9 | 9 | ทุก 3h |
| TEMP | 9 | 9 | ทุก 3h |

### 1.5 DPS — เปลี่ยน time_slot ต่อ topic

| Topic | เดิม | ใหม่ | Interval |
|-------|------|------|---------|
| FLOW, PRESSURE, POWER, SPEED | 13 | **25** | ทุก 1h |
| FEEDER, I.H.M | 13 | **25** | ทุก 1h |
| CURRENT, TEMP, BATTERY | 9 | 9 | ทุก 3h |

ไฟล์: `server/config/operator_nodes.json` บรรทัด 3452 และ 3884

---

## ส่วนที่ 2 — Formula Columns ทั้งหมด

> **Reference สมบูรณ์:** ดู `js_refer/col_formula.md` สำหรับ syntax, edge cases, และ placeholder ทั้งหมด

### Formula Syntax สรุป

- เขียนใน field `"formula"` ของ param ใน `operator_nodes.json`
- Placeholder: `{cfgId}` = ค่า slot ปัจจุบัน, `{cfgId,-1}` = slot ก่อนหน้า, `[slot]` = เวลา เช่น `"02:00"`
- `undefined` → cell กลาย editable (ยอดยกมา)
- ไม่ต้องแตะโค้ด JS — `computeFormula()` จัดการให้อัตโนมัติ

---

### 2.1 RWS1 — FLOW น้ำดิบ LINE A & B (cfgId 8384, 8385)

```json
"formula": "[slot]===\"00:00\" ? 0 : ({4}-{4,-1})*100"
"formula": "[slot]===\"00:00\" ? 0 : ({7}-{7,-1})*100"
```

- totalizer LINE A = cfgId 4, LINE B = cfgId 7
- 00:00 คืน `0` (ไม่ใช่ยอดยกมา)
- topic: station RWS1, `time_slot: 13`

### 2.2 RWS2 — FLOW น้ำดิบ LINE C & D (cfgId 8386, 8387)

```json
"formula": "[slot]===\"00:00\" ? 0 : ({42}-{42,-1})*100"
"formula": "[slot]===\"00:00\" ? 0 : ({44}-{44,-1})*100"
```

- totalizer LINE C = cfgId 42, LINE D = cfgId 44

### 2.3 TPS — FLOW RATE (cfgId 8388)

```json
"formula": "[slot]===\"00:00\" ? undefined : [slot]===\"01:00\" ? {759}*100 : ({759}-{759,-1})*100"
```

- totalizer FLOW SERVICE = cfgId 759
- 00:00 → editable (ยอดยกมา), 01:00 → `{759}*100`, 02:00+ → diff×100
- topic: `FLOW, PRESSURE, POWER, %SPEED`, `time_slot: 25`
- Excel: `=IF(A2="00:00",0,IF(A2="01:00",(C2-0)*100,(C2-C1)*100))`

### 2.4 DPS — FLOW RATE LINE A & B (cfgId 8389, 8390)

```json
"formula": "[slot]===\"00:00\" ? undefined : [slot]===\"01:00\" ? {873}*100 : ({873}-{873,-1})*100"
"formula": "[slot]===\"00:00\" ? undefined : [slot]===\"01:00\" ? {875}*100 : ({875}-{875,-1})*100"
```

- totalizer LINE A = cfgId 873, LINE B = cfgId 875
- pattern เหมือน TPS ทุกประการ
- topic: `FLOW, PRESSURE, POWER, SPEED`, `time_slot: 25`

---

### 2.5 CHEM1 — หน่วย SET POINT: m³/s (cfgId 1, 2)

**ALUM P#12 — FLOW RATE PHASE 1 & 2 (cfgId 87, 90)**

```json
"formula": "[slot]===\"00:00\" ? undefined : {1}*{89}*5.4135"
"formula": "[slot]===\"00:00\" ? undefined : {2}*{92}*5.4135"
```

- SET POINT P1 = cfgId 1 (m³/s), P2 = cfgId 2
- DOSING RATE P1 = cfgId 89 (mg/L), P2 = cfgId 92
- Excel: `=B2*L2*5.4135` (B=cfgId1, L=cfgId89)
- `time_slot: 13`

**CHLORINE P#12 — FLOW RATE PRE/POST (cfgId 130, 132, 134, 136)**

```json
"formula": "[slot]===\"00:00\" ? undefined : {129}*{1}*3.6"   // PRE Cl2 P1
"formula": "[slot]===\"00:00\" ? undefined : {131}*{2}*3.6"   // PRE Cl2 P2
"formula": "[slot]===\"00:00\" ? undefined : {133}*{1}*3.6"   // POST Cl2 P1
"formula": "[slot]===\"00:00\" ? undefined : {135}*{2}*3.6"   // POST Cl2 P2
```

- DOSING PRE P1 = cfgId 129, PRE P2 = 131, POST P1 = 133, POST P2 = 135
- Excel: `=Z6*B6*3.6` (Z=cfgId129, B=cfgId1)

**PACl P#12 — FLOW RATE PHASE 1 & 2 (cfgId 8401, 8403)**

```json
"formula": "[slot]===\"00:00\" ? undefined : {1}*{8402}*8.6434"
"formula": "[slot]===\"00:00\" ? undefined : {2}*{8404}*8.6434"
```

- DOSING RATE P1 = cfgId 8402, P2 = cfgId 8404
- Excel: `=B5*K5*8.6434`

---

### 2.6 CHEM2 — หน่วย SET POINT: m³/h (cfgId 39, 40)

> ต่างจาก CHEM1 ตรงที่ต้องหาร 3600 เพื่อ convert m³/h → m³/s และหาร 60 อีกถ้า output เป็น L/min

**ALUM P#34 — FLOW RATE PHASE 3 & 4 (cfgId 149, 152) — unit: L/min**

```json
"formula": "[slot]===\"00:00\" ? undefined : ({151}*{39}*5.4135)/3600/60"
"formula": "[slot]===\"00:00\" ? undefined : ({154}*{40}*5.4135)/3600/60"
```

- DOSING RATE P3 = cfgId 151, P4 = cfgId 154
- Excel: `=((R7*B7*5.4135)/3600)/60`

**CHLORINE P#34 — FLOW RATE PRE/POST (cfgId 8391, 8392, 8393, 8394)**

```json
"formula": "[slot]===\"00:00\" ? undefined : {192}*{39}*3.6/3600"   // PRE Cl2 P3
"formula": "[slot]===\"00:00\" ? undefined : {194}*{40}*3.6/3600"   // PRE Cl2 P4
"formula": "[slot]===\"00:00\" ? undefined : {196}*{39}*3.6/3600"   // POST Cl2 P3
"formula": "[slot]===\"00:00\" ? undefined : {198}*{40}*3.6/3600"   // POST Cl2 P4
```

- DOSING PRE P3 = cfgId 192, PRE P4 = 194, POST P3 = 196, POST P4 = 198
- Excel: `=(AA7*B7*3.6)/3600`

**PACl P#34 — FLOW RATE PHASE 3 & 4 (cfgId 8415, 8417) — unit: L/h**

```json
"formula": "[slot]===\"00:00\" ? undefined : {39}*{8416}*0.0024"
"formula": "[slot]===\"00:00\" ? undefined : {40}*{8418}*0.0024"
```

- DOSING RATE P3 = cfgId 8416, P4 = cfgId 8418
- **0.0024 = 8.6434 / 3600** (เทียบ CHEM1 PACl)
- Excel: `=B6*K6*0.0024`

---

## ไฟล์ที่เปลี่ยน

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `server/config/operator_nodes.json` | formula RWS1/2, TPS, DPS, CHEM1×3 topics, CHEM2×3 topics; time_slot TPS×5, DPS×2 |
| `client/src/pages/OpRecord.jsx` | `computeFormula` sentinel, `isFormulaSlot` cell rendering, `topicSlots` case 9 |
| `js_refer/col_formula.md` | reference doc สมบูรณ์สำหรับทุก formula ที่ทำไปแล้ว |

---

## สิ่งที่ยังค้าง

- [x] **CWS/FWS**: ยืนยันแล้วว่า **ไม่มี** formula column ที่ต้องเพิ่ม
- [ ] **Verify TPS** (browser): 00:00 กรอกได้, 01:00 = totalizer×100, 02:00+ = diff×100
- [ ] **Verify DPS** (browser): FLOW RATE LINE A/B pattern เดียวกับ TPS
- [ ] **Verify RWS2** (browser): LINE C/D ƒ column แสดงค่าถูก

---

## Suggested Skills

- `/verify` — เปิด browser ที่ TPS, DPS, RWS2 แล้วตรวจ formula column ที่ยังไม่ได้ verify
- `js_refer/col_formula.md` — อ่านก่อนเริ่ม session ใหม่ทุกครั้งที่เกี่ยวข้องกับ formula
- `/handoff` — เมื่อจบ session ถัดไป
