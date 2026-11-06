"""
สร้างไฟล์รายงานสาหร่ายสำหรับดาวน์โหลด/พิมพ์ จาก templates/Algae_theme.xlsx — ไม่แตะไฟล์อื่นบน server

Usage: python algae_exporter.py <in.json> <out.xlsx>
in.json:
  {
    "days": [
      { "date": "2026-07-04",
        "records": [{ "species_name": "Achnanthes sp.", "station": "RW", "count": 200 }, ...],
        "wq": { "RW.turb": "25.3", "RW.pH": "7.2", "RW.OC": "2.1", "RW.Conduct": "180", ... } },
      ...
    ],
    "signer": { "name": "...", "position_label": "...", "dept_label": "..." } | null
  }
stdout: { "sheets": [...], "written": N, "unmapped": ["species ที่ไม่มีในฟอร์ม", ...] }

ต่อ 1 วันที่เก็บตัวอย่าง = 1 ชีท (ชื่อ "4 ก.ค." ตามไฟล์ต้นฉบับ)
  F3 = วันที่ไทย, แถว 9-11 = คุณภาพน้ำ 09:00 (RW/TW1/TW2, ซ่อนสถานีที่ไม่มีข้อมูลสาหร่าย),
  แถว 15-89 = ตารางชนิด×สถานี + AutoFilter A13:K89 คอลัมน์ D (RW) "ไม่ว่าง", C103/C104 = ผู้วิเคราะห์

แก้ไฟล์ theme ระดับ XML ด้วย xml.etree (ไม่ผ่าน openpyxl save) เพื่อเก็บโลโก้ (EMF), rich text (µS/cm, ตัวหนาบางคำ) และ style ไว้ครบ
"""
import sys, json, os, re, copy, zipfile, warnings
from xml.sax.saxutils import escape
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')   # error ภาษาไทยต้องถึง Node เป็น UTF-8 (ไม่ใช่ cp874) ไม่งั้น UI จับข้อความไม่ได้

import xml.etree.ElementTree as etree   # stdlib — เครื่อง deploy ติดตั้งแบบ offline จาก setup/py_wheels (ไม่มี lxml)
from openpyxl import load_workbook

BASE = os.path.dirname(os.path.abspath(__file__))
THEME = os.path.join(BASE, 'templates', 'Algae_theme.xlsx')

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
REL_SHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'
REL_CALC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain'
CT_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml'
q = lambda tag: f'{{{NS}}}{tag}'

# Station → matrix column (species count matrix, row 15-89)
STATION_COL = {'RW': 'D', 'TW1': 'E', 'TW2': 'F', 'CW1': 'G', 'CW2': 'H', 'CW3': 'I', 'CW4': 'J'}
STATION_COLS = list(STATION_COL.values())
WQ_ROW_MIN, WQ_ROW_MAX = 9, 12          # แถวคุณภาพน้ำ: ป้าย "1) RW" ในคอลัมน์ A
WQ_FIELDS = [('D', 'turb'), ('E', 'pH'), ('F', 'OC'), ('G', 'Conduct')]

SPECIES_ROW_MIN = 15
SPECIES_ROW_MAX = 89
FILTER_REF = 'A13:K89'
FILTER_COL = 'D'                        # แสดงเฉพาะแถวที่ RW ไม่ว่าง
SIGNER_NAME, SIGNER_POS = 'C103', 'C104'

_MONTH_ABBR_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
_MONTH_FULL_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']


def sheet_tab_name(date_str):
    """2026-07-04 → '4 ก.ค.'"""
    _, m, d = date_str.split('-')
    return f'{int(d)} {_MONTH_ABBR_TH[int(m) - 1]}'


def thai_date_label(date_str):
    """2026-07-04 → '   4 กรกฎาคม 2569'"""
    y, m, d = date_str.split('-')
    return f'   {int(d)} {_MONTH_FULL_TH[int(m) - 1]} {int(y) + 543}'


def to_num(val):
    if val is None or val == '':
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return val


def col_num(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def split_ref(ref):
    m = re.match(r'([A-Z]+)(\d+)$', ref)
    return m.group(1), int(m.group(2))


def read_layout():
    """อ่านตำแหน่งจาก theme: {species: row}, {station: row คุณภาพน้ำ}, ป้าย Division (row → text)"""
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')   # openpyxl เตือนเรื่องรูป EMF — ใช้อ่านค่าอย่างเดียว
        ws = load_workbook(THEME).worksheets[0]
    species, labels = {}, {}
    for r in range(SPECIES_ROW_MIN, SPECIES_ROW_MAX + 1):
        v = ws[f'C{r}'].value
        if isinstance(v, str) and v.strip():
            species[v.strip()] = r
        a = ws[f'A{r}'].value
        if isinstance(a, str) and a.strip():
            labels[r] = a
    wq_rows = {}
    for r in range(WQ_ROW_MIN, WQ_ROW_MAX + 1):
        a = ws[f'A{r}'].value
        if isinstance(a, str) and ')' in a:
            wq_rows[a.split(')', 1)[1].strip()] = r
    return species, wq_rows, labels


class Sheet:
    """แก้ค่าเซลล์ใน worksheet XML โดยคง style (s=) และโครงสร้างอื่นไว้"""

    def __init__(self, root):
        self.root = root
        self.data = root.find(q('sheetData'))
        self.rows = {int(r.get('r')): r for r in self.data.findall(q('row'))}

    def row(self, r):
        el = self.rows.get(r)
        if el is None:
            el = etree.Element(q('row'), r=str(r))
            after = [k for k in self.rows if k < r]
            if after:
                insert_after(self.data, self.rows[max(after)], el)
            else:
                self.data.insert(0, el)
            self.rows[r] = el
        return el

    def cell(self, ref):
        col, r = split_ref(ref)
        row = self.row(r)
        prev = None
        for c in row.findall(q('c')):
            cc, _ = split_ref(c.get('r'))
            if cc == col:
                return c
            if col_num(cc) < col_num(col):
                prev = c
        c = etree.Element(q('c'), r=ref)
        if prev is not None:
            insert_after(row, prev, c)
        else:
            row.insert(0, c)
        return c

    def get(self, ref):
        """ค่าที่เขียนไว้ในชีทนี้ (inline / number) — ไม่อ่าน shared string"""
        col, r = split_ref(ref)
        row = self.rows.get(r)
        if row is None:
            return None
        for c in row.findall(q('c')):
            if c.get('r') == ref:
                v = c.find(q('v'))
                if c.get('t') == 'inlineStr':
                    return ''.join(c.itertext())
                return v.text if v is not None else None
        return None

    def set(self, ref, value):
        c = self.cell(ref)
        for child in list(c):
            c.remove(child)
        c.attrib.pop('t', None)
        if value is None:
            return
        if isinstance(value, (int, float)):
            etree.SubElement(c, q('v')).text = repr(value)
        else:
            c.set('t', 'inlineStr')
            t = etree.SubElement(etree.SubElement(c, q('is')), q('t'))
            t.text = str(value)
            t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

    def hide_row(self, r, hidden):
        row = self.row(r)
        if hidden:
            row.set('hidden', '1')
        else:
            row.attrib.pop('hidden', None)


def relocate_division_labels(sh, labels, visible):
    """ป้าย Division อยู่ที่แถวแรกของกลุ่มใน theme — ถ้าแถวนั้นถูกซ่อน ย้ายป้ายไปแถวแรกที่แสดงของกลุ่ม (เหมือนที่ทำมือในไฟล์จริง)"""
    starts = sorted(r for r, t in labels.items() if t.strip().startswith('Division'))
    for i, start in enumerate(starts):
        end = (starts[i + 1] - 1) if i + 1 < len(starts) else SPECIES_ROW_MAX
        block_labels = [r for r in sorted(labels) if start <= r <= end]
        texts = [labels[r] for r in block_labels]
        shown = [r for r in range(start, end + 1) if r in visible]
        if not shown or shown[:len(texts)] == block_labels:
            continue
        for r in block_labels:
            sh.set(f'A{r}', None)
        if len(shown) < len(texts):   # แถวที่แสดงน้อยกว่าป้าย → รวมป้ายที่เหลือไว้แถวสุดท้าย
            texts = texts[:len(shown) - 1] + [' '.join(t.strip() for t in texts[len(shown) - 1:])]
        for r, t in zip(shown, texts):
            sh.set(f'A{r}', t)


def fill_sheet(sh, date_str, records, wq, layout, signer=None):
    """เติมข้อมูล 1 วันลงชีท (XML ที่ copy มาจาก theme). คืน (written, unmapped_species)."""
    species_rows, wq_rows, labels = layout
    sh.set('F3', thai_date_label(date_str))

    stations_with_data = set()
    unmapped = set()
    written = 0
    for rec in records:
        species = (rec.get('species_name') or '').strip()
        station = (rec.get('station') or '').strip()
        count = rec.get('count')
        col = STATION_COL.get(station)
        if col is None or count is None:
            continue
        row = species_rows.get(species)
        if row is None:
            unmapped.add(species)
            continue
        sh.set(f'{col}{row}', to_num(count))
        stations_with_data.add(station)
        written += 1

    counter = 1
    for st, r in sorted(wq_rows.items(), key=lambda x: x[1]):
        for col, field in WQ_FIELDS:
            sh.set(f'{col}{r}', to_num(wq.get(f'{st}.{field}')))
        has_data = st in stations_with_data
        sh.hide_row(r, not has_data)
        if has_data:
            sh.set(f'A{r}', f'{counter}) {st}')
            counter += 1

    # AutoFilter: แสดงเฉพาะชนิดที่คอลัมน์ D ไม่ว่าง (Excel เก็บผลกรองเป็นแถวที่ซ่อน)
    visible = set()
    for r in range(SPECIES_ROW_MIN, SPECIES_ROW_MAX + 1):
        show = sh.get(f'{FILTER_COL}{r}') not in (None, '')
        sh.hide_row(r, not show)
        if show:
            visible.add(r)
    relocate_division_labels(sh, labels, visible)

    af = sh.root.find(q('autoFilter'))
    if af is None:
        af = etree.Element(q('autoFilter'))
        insert_after(sh.root, sh.data, af)
    for child in list(af):
        af.remove(child)
    af.set('ref', FILTER_REF)
    fc = etree.SubElement(af, q('filterColumn'), colId=str(col_num(FILTER_COL) - col_num(FILTER_REF[0])))
    etree.SubElement(etree.SubElement(fc, q('customFilters')), q('customFilter'), operator='notEqual', val=' ')

    if signer:
        name = (signer.get('name') or '').strip()
        position = (signer.get('position_label') or '').strip()
        dept = (signer.get('dept_label') or '').strip()
        if name:
            sh.set(SIGNER_NAME, f'({name})')
        pos_full = f'{position} {dept}'.strip()
        if pos_full:
            sh.set(SIGNER_POS, f'ตำแหน่ง  {pos_full}')

    # ค่า cache ของสูตรเป็นของ theme (ว่าง) — ลบทิ้งให้ Excel คำนวณใหม่ตอนเปิด
    for c in sh.data.iter(q('c')):
        if c.find(q('f')) is not None:
            v = c.find(q('v'))
            if v is not None:
                c.remove(v)

    return written, unmapped


def insert_after(parent, ref, el):
    parent.insert(list(parent).index(ref) + 1, el)


def parse(xml_bytes):
    # ใช้ prefix เดิมของไฟล์ (r:, xr:, mc:, ...) ตอนเขียนกลับ
    for prefix, uri in re.findall(r'xmlns:(\w+)="([^"]+)"', xml_bytes.decode('utf-8')):
        etree.register_namespace(prefix, uri)
    return etree.fromstring(xml_bytes)


def _xml(root, original):
    """serialize กลับโดยใช้ root tag เดิม — ElementTree ทิ้ง xmlns ที่อ้างแค่ใน mc:Ignorable (x14ac, xr2, ...)
    ซึ่ง Excel ถือว่าไฟล์เสีย จึงคืน tag เดิมแล้วเติม xmlns ที่ ElementTree ย้ายขึ้นมาไว้ root"""
    default = root.tag[1:].split('}')[0]
    etree.register_namespace('', default)   # default_namespace= ใช้ไม่ได้กับ attribute ไม่มี prefix
    body = etree.tostring(root, encoding='unicode')
    new_tag = re.match(r'<[^>]+>', body).group(0)
    orig_tag = re.search(r'<[A-Za-z][^>]*>', original.decode('utf-8')).group(0)
    have = set(re.findall(r'(xmlns(?::\w+)?)=', orig_tag))
    extra = ''.join(f' {k}="{v}"' for k, v in re.findall(r'(xmlns(?::\w+)?)="([^"]*)"', new_tag) if k not in have)
    tag = orig_tag[:-1] + extra + '>'
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + tag + body[len(new_tag):]).encode('utf-8')


def _sheet_rels_target(rels_root, rel_type_suffix):
    for rel in rels_root:
        if rel.get('Type').endswith(rel_type_suffix):
            return rel
    return None


def build(days, signer, out_path):
    days = sorted(days, key=lambda d: d['date'])
    if not days:
        raise ValueError('no days to export')
    layout = read_layout()

    zin = zipfile.ZipFile(THEME)
    parts = {n: zin.read(n) for n in zin.namelist()}

    wb_root = parse(parts['xl/workbook.xml'])
    wb_rels = parse(parts['xl/_rels/workbook.xml.rels'])
    first_sheet = wb_root.find(q('sheets'))[0]
    sheet_rid = first_sheet.get(f'{{{NS_R}}}id')
    sheet_target = next(r.get('Target') for r in wb_rels if r.get('Id') == sheet_rid)
    sheet_path = 'xl/' + sheet_target.lstrip('/').replace('xl/', '', 1)
    sheet_rels_path = sheet_path.replace('worksheets/', 'worksheets/_rels/') + '.rels'
    sheet_xml = parts[sheet_path]
    sheet_rels = parse(parts[sheet_rels_path]) if sheet_rels_path in parts else None

    drawing_rel = _sheet_rels_target(sheet_rels, '/drawing') if sheet_rels is not None else None
    drawing_path = drawing_rels_path = None
    if drawing_rel is not None:
        drawing_path = os.path.normpath(os.path.join(os.path.dirname(sheet_path), drawing_rel.get('Target'))).replace('\\', '/')
        drawing_rels_path = drawing_path.replace('drawings/', 'drawings/_rels/') + '.rels'
    printer_rel = _sheet_rels_target(sheet_rels, '/printerSettings') if sheet_rels is not None else None
    printer_path = None
    if printer_rel is not None:
        printer_path = os.path.normpath(os.path.join(os.path.dirname(sheet_path), printer_rel.get('Target'))).replace('\\', '/')

    drop = {sheet_path, sheet_rels_path, drawing_path, drawing_rels_path, printer_path, 'xl/calcChain.xml'}
    out = {n: b for n, b in parts.items() if n not in drop}

    sheets, total, unmapped = [], 0, set()
    ct = parse(parts['[Content_Types].xml'])
    for o in list(ct):
        if o.get('PartName') in {'/' + p for p in drop if p}:
            ct.remove(o)
    for r in list(wb_rels):
        if r.get('Type') in (REL_SHEET, REL_CALC):
            wb_rels.remove(r)

    sheets_el = wb_root.find(q('sheets'))
    for s in list(sheets_el):
        sheets_el.remove(s)

    for i, day in enumerate(days, start=1):
        root = parse(sheet_xml)
        sh = Sheet(root)
        n, um = fill_sheet(sh, day['date'], day.get('records', []), day.get('wq', {}), layout, signer)
        total += n
        unmapped |= um
        name = sheet_tab_name(day['date'])
        sheets.append(name)

        sv = root.find(f"{q('sheetViews')}/{q('sheetView')}")
        if sv is not None:
            sv.attrib.pop('topLeftCell', None)
            if i == 1:
                sv.set('tabSelected', '1')
            else:
                sv.attrib.pop('tabSelected', None)

        out[f'xl/worksheets/sheet{i}.xml'] = _xml(root, sheet_xml)
        etree.SubElement(ct, f'{{{NS_CT}}}Override', PartName=f'/xl/worksheets/sheet{i}.xml', ContentType=CT_SHEET)
        if sheet_rels is not None:
            rels = copy.deepcopy(sheet_rels)
            for rel in rels:
                if rel.get('Type').endswith('/drawing'):
                    rel.set('Target', f'../drawings/drawing{i}.xml')
                elif rel.get('Type').endswith('/printerSettings'):
                    rel.set('Target', f'../printerSettings/printerSettings{i}.bin')
            out[f'xl/worksheets/_rels/sheet{i}.xml.rels'] = _xml(rels, parts[sheet_rels_path])
        if drawing_path:
            out[f'xl/drawings/drawing{i}.xml'] = parts[drawing_path]
            etree.SubElement(ct, f'{{{NS_CT}}}Override', PartName=f'/xl/drawings/drawing{i}.xml', ContentType=CT_DRAWING)
            if drawing_rels_path in parts:
                out[f'xl/drawings/_rels/drawing{i}.xml.rels'] = parts[drawing_rels_path]
        if printer_path:
            out[f'xl/printerSettings/printerSettings{i}.bin'] = parts[printer_path]

        rid = f'rIdLvSheet{i}'
        etree.SubElement(wb_rels, f'{{{NS_PKG}}}Relationship', Id=rid, Type=REL_SHEET, Target=f'worksheets/sheet{i}.xml')
        s = etree.SubElement(sheets_el, q('sheet'), name=name, sheetId=str(i))
        s.set(f'{{{NS_R}}}id', rid)

    # defined names: _FilterDatabase ต่อชีท (ของ theme ทิ้ง — เป็น localSheetId ของชีทเดิม)
    dn = wb_root.find(q('definedNames'))
    if dn is None:
        dn = etree.Element(q('definedNames'))
        insert_after(wb_root, sheets_el, dn)
    for d in list(dn):
        if d.get('localSheetId') is not None:
            dn.remove(d)
    for i, name in enumerate(sheets):
        d = etree.SubElement(dn, q('definedName'), name='_xlnm._FilterDatabase', localSheetId=str(i), hidden='1')
        a, b = FILTER_REF.split(':')
        d.text = "'{}'!${}${}:${}${}".format(name.replace("'", "''"), *re.match(r'([A-Z]+)(\d+)', a).groups(), *re.match(r'([A-Z]+)(\d+)', b).groups())
    if len(dn) == 0:
        wb_root.remove(dn)

    calc = wb_root.find(q('calcPr'))
    if calc is not None:
        calc.set('fullCalcOnLoad', '1')
    wv = wb_root.find(f"{q('bookViews')}/{q('workbookView')}")
    if wv is not None:
        wv.attrib.pop('activeTab', None)
        wv.attrib.pop('firstSheet', None)

    out['xl/workbook.xml'] = _xml(wb_root, parts['xl/workbook.xml'])
    out['xl/_rels/workbook.xml.rels'] = _xml(wb_rels, parts['xl/_rels/workbook.xml.rels'])
    out['[Content_Types].xml'] = _xml(ct, parts['[Content_Types].xml'])

    if 'docProps/app.xml' in out:   # รายชื่อชีทใน properties ให้ตรงกับไฟล์
        app = out['docProps/app.xml'].decode('utf-8')
        titles = ''.join(f'<vt:lpstr>{escape(n)}</vt:lpstr>' for n in sheets)
        app = re.sub(r'<TitlesOfParts>.*?</TitlesOfParts>',
                     f'<TitlesOfParts><vt:vector size="{len(sheets)}" baseType="lpstr">{titles}</vt:vector></TitlesOfParts>', app, flags=re.S)
        app = re.sub(r'(<vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>)\d+', rf'\g<1>{len(sheets)}', app)
        out['docProps/app.xml'] = app.encode('utf-8')

    order = ['[Content_Types].xml'] + [n for n in out if n != '[Content_Types].xml']
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for n in order:
            zout.writestr(n, out[n])
    return {'sheets': sheets, 'written': total, 'unmapped': sorted(unmapped)}


if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as f:
        data = json.load(f)
    print(json.dumps(build(data['days'], data.get('signer'), sys.argv[2]), ensure_ascii=False))
