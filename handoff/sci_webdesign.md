# sci_webdesign — Design Handoff: Earth-Tone Theme

**Session:** LabVenture Full-Stack Theme Application (Session 8–9)  
**Date:** 2026-07-24  
**Scope:** Visual redesign ทุกหน้า — zero logic changes  
**Status:** ✅ Implemented & pushed to master (`fbdb318`)

---

## Design Direction

"Light leads, focal punctuates" — พื้นหลังทั้งหน้าจอเป็น warm earth-tone ใช้สีเข้ม focal เฉพาะจุดที่ต้องการ eye-focus เช่น logo, Sync btn, today dot, active nav

---

## Palette (4-tier hierarchy)

| Tier | Token | Hex | Role | ปรากฏที่ไหน |
|---|---|---|---|---|
| L1 | `earth.DEFAULT` | `#FFF9D2` | Page field | body bg, stat cards, inactive panel fill, table alternating even row, input fields |
| L2 | `earth.card` | `#FFEBCC` | Panel surface | topbar, sidebar, node cards, weekly cards, **calendars**, remark areas, modal/slide-panel z-50, header strips |
| L3 | `brand.light` | `#BFDDF0` | Data surface | MiniChart card bg only |
| **F** | **`brand.DEFAULT`** | **`#8CC0EB`** | **Focal** | logo mark, Sync btn, active nav bar, selected calendar day, progress ring, AquaDAT station active btn |
| F-dark | `brand.dark` | `#4A8CC8` | Focal w/ white text | today in calendar, selected day (high contrast), link text (`text-brand-dark`) |

### Supporting tokens (in `tailwind.config.js`)

```js
colors: {
  brand: {
    DEFAULT: '#8CC0EB',   // L3/Focal sky-mid
    dark:    '#4A8CC8',   // Focal dark — white text WCAG AA
    light:   '#BFDDF0',   // L3 data surface (MiniChart)
  },
  earth: {
    DEFAULT: '#FFF9D2',   // L1 page field
    card:    '#FFEBCC',   // L2 panel surfaces
    border:  '#EED8B0',   // L1/L2 border
    ink:     '#3A2410',   // dark warm-brown (primary text)
    ink2:    '#7A5830',   // medium warm-brown (secondary text)
    ink3:    '#B89060',   // light warm-brown (muted / placeholder)
  },
}
```

**Ink บน L3 (MiniChart):** ใช้ `#1A3A5C` (hardcoded) ไม่ใช่ earth.ink เพราะ L3 เป็น blue tint

### Status / Semantic colors (คงเดิม ไม่เปลี่ยน)

```
OK:    bg-green-500  text-white
WARN:  bg-amber-400  text-white
BAD:   bg-red-500    text-white
```

---

## Pattern: Group/Section Headers

ทุกกลุ่ม/สถานีใช้ **left-border accent** แทน solid color band:

```jsx
// Dashboard NODE_GROUPS
const NODE_GROUPS = [
  { key: 'raw',     accent: '#4A8C5C' },  // earthy green
  { key: 'prod',    accent: '#5A9EDC' },  // sky blue
  { key: 'tap',     accent: '#C87830' },  // warm amber
  { key: 'special', accent: '#B06878' },  // dusty rose
];

// GroupSection
<div style={{ borderLeftColor: group.accent, borderLeftWidth: 3 }}>
  <div className="bg-earth-DEFAULT/70">  {/* header */}

// OpDashboard STATION_ACCENTS
const STATION_ACCENTS = {
  RWS1: '#10b981', RWS2: '#14b8a6',
  CHEM1: '#7c3aed', CHEM2: '#a21caf',
  TPS: '#1d4ed8', DPS: '#3730a3',
  FWS: '#d97706', CWS: '#ea580c',
};

// StationRow
<div style={{ borderLeftColor: accent, borderLeftWidth: 4 }}>
  <div className="bg-earth-card px-4 py-2.5">  {/* header strip */}
```

---

## Calendar Rules

ทุก MiniCalendar ในโปรเจค:

| State | Class |
|---|---|
| Container | `bg-earth-card` (L2, ไม่ใช่ L1) |
| Today | `bg-brand-dark text-white font-semibold` |
| Selected | `bg-brand text-white font-bold` |
| Past (normal) | `text-earth-ink hover:bg-earth-DEFAULT/80` |
| Future (disabled) | `text-earth-border cursor-default` |

---

## Files Changed

### Tailwind config
- `client/tailwind.config.js` — เพิ่ม `earth.*`, ปรับ `brand.*`

### CSS
- `client/src/index.css` — `body { background-color: #FFF9D2; color: #3A2410; }`

### Components
| File | Summary |
|---|---|
| `Layout.jsx` | Topbar + sidebar → earth-card; logo mark focal; active nav left-border brand |
| `DateSyncBar.jsx` | Date pill → earth-card; label strip → earth-DEFAULT; Sync btn → focal brand |
| `WeeklyProgress.jsx` | Cards → earth-card; progress track → earth-border |
| `MiniChart.jsx` | Card bg → brand-light (#BFDDF0); all text/grid → #1A3A5C; tooltip bg → #1A3A5C |

### Pages
| File | สิ่งที่เปลี่ยน |
|---|---|
| `Dashboard.jsx` | GroupSection left-border accent; NodeRow earth-card; MiniCalendar earth-card; AquaDAT remarks earth-DEFAULT |
| `CARLog.jsx` | CAR card → earth-DEFAULT; slide panel/admin modal z-50 → earth-card; table headers → earth-card |
| `ChemIntake.jsx` | Section cards → earth-DEFAULT; table/subheader → earth-card; tank track → earth-border |
| `ConfigEditor.jsx` | Table headers → earth-card; toggle track inactive → keep gray-200 (toggle UX) |
| `Login.jsx` | Login card → earth-card |
| `OpDashboard.jsx` | **StationRow** → earth-card header + left-border accent (ไม่ใช่ solid color band); **MiniCalendar** → earth-card; timeline track → earth-border; StationDot past/future → earth tokens |
| `OpRecord.jsx` | Layout columns → earth-DEFAULT; table rows alternating earth-DEFAULT/earth-card; thead → earth-card; pending bar → earth-card; topic pills inactive → earth-DEFAULT |
| `Record.jsx` | NODE_PALETTE 5th column (row bg) → earth-DEFAULT; input fields → earth-DEFAULT; inactive buttons → earth-DEFAULT |
| `Report.jsx` | Action buttons → earth-DEFAULT |
| `App.jsx` | Misc cleanup |

---

## What to KEEP WHITE (do not change)

| Pattern | ตำแหน่ง | เหตุผล |
|---|---|---|
| `bg-white rounded-full shadow` | Toggle knobs ทุกที่ | UX knob ต้องขาวเสมอเพื่อ affordance |
| `bg-white opacity-80` | Legend dot (ChemIntake) | อยู่บน colored header → contrast |
| `bg-white text-brand` | CAR stage active dot | active state บน colored bg |
| `bg-white/10`, `/20`, `/25`, `/30`, `/70` | Overlays บน colored bg | semi-transparent ไม่ขาวจริง |
| `bg-red-50`, `bg-green-50` | Status semantic rows | status color, ไม่ใช่ white-to-replace |
| `bg-gray-200` toggle track, `bg-gray-300` | Toggle off-state track | UX convention |
| `bg-gray-100 border-gray-200` (tiny dots) | Pump grid cells, status mini-indicators | pixel-level status ไม่เห็นความต่าง |

---

## What Does NOT Change

- Logic ทั้งหมด: buildNodeDots, nextPendingSlot, latestStreak, API calls, query keys
- Routing และ role-based nav guards
- Thai language strings และ component hierarchy
- MiniChart threshold shading bands (blue streak=1 / red streak≥2)
- Status semantic colors (OK/WARN/BAD/CAR colors)
- AquaDAT queue/banner logic
- Recharts chart logic

---

## Verification Checklist

1. **body bg** = `#FFF9D2` (warm cream), text = `#3A2410` (dark brown)
2. **Topbar + Sidebar** = `#FFEBCC` (peach panel)
3. **Logo mark** = `#8CC0EB` square, white "LV"
4. **Active nav** = left-bar `#8CC0EB` + `brand-light/50` fill
5. **Dashboard calendar** = peach panel; today = `#4A8CC8` pill
6. **OpDashboard calendar** = peach panel; station rows = earth-card header + accent left-border (ไม่มี solid color band)
7. **Node group headers** = ไม่มี solid color band — left-border accent only
8. **MiniChart cards** = `#BFDDF0` bg, dark navy text `#1A3A5C`
9. **Sync button** = `#8CC0EB` (focal)
10. **Toggle knobs** = ขาวเสมอ
11. **Table rows** = alternating `#FFF9D2` / `#FFEBCC` (ไม่ใช่ขาว/gray)
12. **Input fields** = `#FFF9D2` bg (L1)
