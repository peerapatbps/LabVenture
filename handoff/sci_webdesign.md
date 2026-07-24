# sci_webdesign — Design Handoff: Dashboard Modernization

**Session:** LabVenture Sci Dashboard Redesign  
**Date:** 2026-07-24  
**Scope:** Visual redesign only — zero logic changes

---

## Design Direction

"Light leads, focal punctuates" — ทุ่งหน้าจอเป็นสีอ่อน ใช้สีเข้มเฉพาะจุดที่ต้องการให้สายตาวิ่งไป

---

## Palette (4-tier hierarchy)

| Token | Hex | Role | ปรากฏที่ไหน |
|---|---|---|---|
| L1 | `#FFF9D2` | Page field | พื้นหลัง body, stat card bg บางจุด |
| L2 | `#FFEBCC` | Panel surface | topbar, sidebar, node card, weekly card, calendar, remarks |
| L3 | `#BFDDF0` | Data surface | MiniChart card bg, record-btn tint |
| **F** | **`#8CC0EB`** | **Focal only** | logo mark, Sync button, active nav indicator, today in calendar, progress ring, selected day, avatar |

**F-dark** `#4A8CC8` — F ที่เข้มกว่าสำหรับกรณีที่ต้องการ white text อ่านได้ (WCAG AA)

### Supporting tokens

```
Border L1/L2:  #EED8B0
Border L3:     #A8D0E8
Ink (warm):    #3A2410   ← text on L1/L2
Ink-2:         #7A5830
Ink-3:         #B89060
Ink-blue:      #1A3A5C   ← text on L3 (MiniChart)
White-on-F:    #FFFFFF   ← text on focal bg
```

### Status / Semantic (unchanged)
```
OK:      #4A8C5C
WARN:    #C87830
BAD:     #B84040
NONE:    #C8B090
FUTURE:  #E8D5B0
```

### Node group accents (left-border only)
```
raw:     #4A8C5C  (earthy green)
prod:    #5A9EDC  (F-derived blue)
tap:     #C87830  (warm amber)
special: #B06878  (dusty rose)
```

---

## Files to Modify

### 1. `client/tailwind.config.js`
เปลี่ยน `brand.DEFAULT` จาก `#0369a1` → `#8CC0EB` เพิ่ม `brand.dark: '#4A8CC8'`, `brand.light: '#BFDDF0'`  
เพิ่ม `earth` token group สำหรับ L1/L2/L3 และ border/ink

### 2. `client/src/index.css`
`body` bg จาก `bg-gray-50 text-gray-900` → `#FFF9D2 text #3A2410`

### 3. `client/src/components/Layout.jsx`

**Topbar** (`bg-brand text-white` → L2 panel):
- `bg-[#FFEBCC]` + `text-[#3A2410]` + `border-b border-[#EED8B0]`
- Logo: เพิ่ม colored square mark `bg-[#8CC0EB]` + white "LV"
- Scenario pills: ปรับ border สีอุ่น
- Logout btn: `bg-[#FFF9D2]/60 border-[#EED8B0] text-[#7A5830]`

**Sidebar** (`bg-white border-gray-200` → L2):
- `bg-[#FFEBCC] border-r border-[#EED8B0]`
- Nav item hover: `hover:bg-[#FFF9D2]/70`
- Nav item active: `border-l-[3px] border-l-[#8CC0EB] bg-[#BFDDF0]/40 text-[#1A3A5C]` (ไม่ fill ทั้งหลัง)

### 4. `client/src/components/DateSyncBar.jsx`
- Date pill: `bg-[#FFEBCC] border-[#EED8B0]`, label `bg-[#FFF9D2]`
- Sync btn: `bg-[#8CC0EB] text-white border-none` (FOCAL)

### 5. `client/src/components/WeeklyProgress.jsx`
- Card bg: `bg-white` → `bg-[#FFEBCC] border-[#EED8B0]`
- Progress bar: `bg-[#EED8B0]` track, `bg-[#8CC0EB]` fill (ไม่ต้องเปลี่ยน bar เมื่อ complete — ยังคง green)
- Links `text-brand` → คงไว้ (brand ใหม่ = `#8CC0EB`)

### 6. `client/src/pages/Dashboard.jsx`

**ProgressBar:** `bg-white` → `bg-[#FFEBCC]`, progress bar: keep color logic แต่ `bg-gray-100` → `bg-[#EED8B0]`

**GroupSection headers:** เปลี่ยนจาก solid color band (`bg-emerald-700 text-white`) → ไม่มี band; ใช้ left-border + `bg-[#FFF9D2]/70` header, text dark

**GroupSection container:** `rounded-xl border shadow-sm` ยังคงไว้ แต่ border ใช้สี group accent

**NodeRow:** `bg-white hover:bg-gray-50` → `bg-[#FFEBCC] hover:bg-[#FFF9D2]/80`

**MiniCalendar:**
- Container: `bg-white border-gray-100` → `bg-[#FFEBCC] border-[#EED8B0]`
- Selected day: `bg-brand text-white` → `bg-[#4A8CC8] text-white` (F-dark for contrast)
- Today day: `bg-blue-100 text-blue-700` → `bg-[#8CC0EB] text-white` (FOCAL)
- Past days: `text-gray-600 hover:bg-gray-100` → `text-[#3A2410] hover:bg-[#FFF9D2]/80`

**TodayTodo:** `bg-white border-gray-100` → `bg-[#FFEBCC] border-[#EED8B0]`  
Pending rows: ยังคง `bg-red-50 hover:bg-red-100` (status semantic color)

**AquadatRemarks:** `bg-white border-gray-100` → `bg-[#FFEBCC] border-[#EED8B0]`  
Active station button: `bg-brand text-white` → `bg-[#4A8CC8] text-white`

**ManualRemarks:** `bg-white` → `bg-[#FFEBCC]`, submit btn: `bg-brand` → `bg-[#4A8CC8]`

**MiniChartsSection filter buttons active:** `bg-amber-500` → `bg-[#4A8CC8] text-white`

### 7. `client/src/components/MiniChart.jsx`

**Card wrapper:** `bg-slate-800 border-white/10` → `bg-[#BFDDF0] border-[#A8D0E8]` (L3 data surface)

**Text:** `text-gray-200` → `text-[#1A3A5C]`

**CartesianGrid:** `stroke="#334155"` → `stroke="#A8D0E8"`

**XAxis/YAxis ticks:** `fill: '#6b7280'` → `fill: '#1A3A5C'`

**Tooltip:** `backgroundColor: '#1e293b'` → `backgroundColor: '#1A3A5C'`  
`itemStyle.color` `#60a5fa` → `#8CC0EB`

**Line stroke:** `#3b82f6` → `#5A9EDC`

**StatusBadge:** OK/WARN/BAD colors คงเดิม (semantic)  
Empty state: `text-gray-500` → `text-[#1A3A5C]/60`  
Single-value display: `text-blue-400` → `text-[#1A3A5C]`

---

## What Does NOT Change

- Logic ทั้งหมด: buildNodeDots, nextPendingSlot, latestStreak, API calls, query keys
- Routing และ role-based nav guards
- Thai language strings
- Component hierarchy
- MiniChart threshold shading bands (blue streak=1 / red streak≥2) — คงเดิม
- Status semantic colors (OK green, WARN amber, BAD red)
- CAR flow และ AquaDAT queue banner

---

## Verification Checklist

1. `npm run dev` ใน `client/` — ไม่มี import error
2. Topbar: warm peach (`#FFEBCC`), logo mark ฟ้า (`#8CC0EB`)
3. Sidebar collapsed: icon strip บน L2; hover expand: label ปรากฏ
4. Active nav: left-bar `#8CC0EB` + L3 tint fill (ไม่ใช่ solid brand)
5. Calendar: warm peach panel, วันที่ 24 (today) = focal blue pill
6. Node group headers: ไม่มี solid color band, มีแค่ left-border accent
7. MiniChart cards: `#BFDDF0` bg, dark navy text
8. ProgressBar + Sync button: focal `#8CC0EB`
9. Mobile overlay menu: L2 bg
