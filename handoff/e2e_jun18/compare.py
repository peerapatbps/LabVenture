import re, sys, warnings
warnings.filterwarnings('ignore')
from openpyxl import load_workbook
SRC = r'C:/Users/peera/OneDrive/Desktop/LabVenture/Algae2569.xlsx'
src_wb = load_workbook(SRC); src = src_wb['18 มิ.ย.']
out_wb = load_workbook(sys.argv[1] if len(sys.argv)>1 else 'printout_algae_2026-06-18.xlsx'); print('sheets:', out_wb.sheetnames)
out = out_wb[out_wb.sheetnames[0]]

def ev(ws, ref, depth=0):
    v = ws[ref].value
    if isinstance(v, str) and v.startswith('='):
        f = v[1:]
        m = re.fullmatch(r'SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)', f)
        if m:
            c, a, _, b = m.groups()
            return sum(ev(ws, f'{c}{r}', depth+1) or 0 for r in range(int(a), int(b)+1))
        if re.fullmatch(r'[A-Z]+\d+(\+[A-Z]+\d+)*', f):
            return sum(ev(ws, x, depth+1) or 0 for x in f.split('+'))
        return ('FORMULA', f)
    return v

lines = []; ok = 0; bad = 0
def cmp(label, a, b):
    global ok, bad
    same = a == b or (a in (None, '', 0) and b in (None, '', 0)) or \
        (isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) < 1e-9)
    if same: ok += 1
    else: bad += 1
    lines.append(f"{'OK ' if same else 'DIFF'} {label}: source={a!r} printout={b!r}")

# 1. header
cmp('F3 วันที่', (src['F3'].value or '').strip(), (out['F3'].value or '').strip())
cmp('B7 =F3', src['B7'].value, out['B7'].value)

# 2. water quality: map by station label
def wq_rows(ws, r0, r1):
    d = {}
    for r in range(r0, r1+1):
        a = ws[f'A{r}'].value
        if isinstance(a, str) and ')' in a:
            d[a.split(')')[1].strip()] = r
    return d
sw, ow = wq_rows(src, 9, 12), wq_rows(out, 9, 15 if out.max_row > 105 else 12)
for st, r in sw.items():
    orow = ow.get(st)
    if orow is None: cmp(f'WQ {st} row', 'present', 'missing'); continue
    cmp(f'WQ {st} label', src[f'A{r}'].value, out[f'A{orow}'].value)
    cmp(f'WQ {st} hidden', False, out.row_dimensions[orow].hidden)
    for c, name in zip('BDEFG', ['เวลา', 'Turb', 'pH', 'OC', 'Cond']):
        cmp(f'WQ {st} {name} ({c}{r}→{c}{orow})', src[f'{c}{r}'].value, out[f'{c}{orow}'].value)
for st, r in ow.items():
    if st not in sw:
        cmp(f'WQ {st} (ไม่มีในต้นฉบับ) hidden', True, out.row_dimensions[r].hidden)

# 3. species matrix by name
def sp_rows(ws, r0, r1):
    return {ws[f'C{r}'].value.strip(): r for r in range(r0, r1+1) if isinstance(ws[f'C{r}'].value, str) and ws[f'C{r}'].value.strip()}
OFF = 4 if out.max_row > 105 else 0
ss, os_ = sp_rows(src, 15, 89), sp_rows(out, 15+OFF, 89+OFF)
lines.append(f'-- species: source {len(ss)} ชนิด, printout {len(os_)} ชนิด; ไม่มีใน printout: {sorted(set(ss)-set(os_))}; ไม่มีในต้นฉบับ: {sorted(set(os_)-set(ss))}')
nz = 0
for name, r in ss.items():
    orow = os_.get(name)
    if orow is None: continue
    has = False
    for c in 'DEFGHIJ':
        a, b = src[f'{c}{r}'].value, out[f'{c}{orow}'].value
        if a not in (None, '', 0) or b not in (None, '', 0):
            cmp(f'{name} col {c} ({c}{r}→{c}{orow})', a, b); has = True; nz += 1
    if has: cmp(f'{name} row visible', False, out.row_dimensions[orow].hidden)
    cmp(f'{name} หมายเหตุ K', (src[f'K{r}'].value or '').strip(), (out[f'K{orow}'].value or '').strip())
hidden_empty = sum(1 for n, r in os_.items() if all(out[f'{c}{r}'].value in (None, '', 0) for c in 'DEFGHIJ') and out.row_dimensions[r].hidden)
lines.append(f'-- non-zero cells compared: {nz}; species rows ว่างที่ถูกซ่อน: {hidden_empty}/{len(os_) - sum(1 for n,r in os_.items() if any(out[f"{c}{r}"].value not in (None,"",0) for c in "DEFGHIJ"))}')

# 4. summary rows (evaluate formulas)
for label, sr in [('TO Algae', 90), ('TOX Algae', 91), ('PW Algae', 92), ('Aulacoseira sp.', 93), ('Filter clogging', 94), ('Total algae', 95)]:
    orow = sr + OFF
    cmp(f'สรุป label {label}', src[f'C{sr}'].value, out[f'C{orow}'].value)
    for c in 'DEF':
        cmp(f'สรุป {label} {c} (value)', ev(src, f'{c}{sr}'), ev(out, f'{c}{orow}'))

# 5. ป้าย Division ในแถวที่แสดง + filter + ผู้ลงนาม
vis = lambda ws, r: not ws.row_dimensions[r].hidden
lines.append('-- Division (แถวที่แสดง): source=' + repr([(src[f'C{r}'].value, src[f'A{r}'].value) for r in range(15, 90) if src[f'A{r}'].value and any(src[f'{c}{r}'].value for c in 'DEFGHIJ')]))
lines.append('-- Division (แถวที่แสดง): printout=' + repr([(out[f'C{r}'].value, out[f'A{r}'].value) for r in range(15+OFF, 90+OFF) if vis(out, r) and out[f'A{r}'].value]))
lines.append(f'-- autofilter printout: {out.auto_filter.ref} ' + repr([(fc.colId, [(c.operator, c.val) for c in fc.customFilters.customFilter] if fc.customFilters else None) for fc in out.auto_filter.filterColumn]))
lines.append('-- species rows ที่แสดงใน printout: ' + repr([out[f'C{r}'].value for r in range(15+OFF, 90+OFF) if vis(out, r)]))
print(f'OK {ok}  DIFF {bad}')
print('\n'.join(l for l in lines if not l.startswith('OK ')) )
print('=== ALL ===')
print('\n'.join(lines))
