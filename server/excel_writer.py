"""
รับ JSON records แล้วเขียนค่าลง monthly Excel
กฎ: copy theme → เติมค่าใน cell ที่มีอยู่แล้วเท่านั้น ห้ามแตะโครงสร้าง

Flow:
  1. เขียนลง server/data/ เสมอ (source of truth / recovery base)
  2. ถ้า excel_data_dir ตั้งค่าไว้ → copy ไปปลายทาง + attrib -U เพื่อ unpin จาก OneDrive
"""
import sys, json, os, shutil, zipfile, re, subprocess
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')   # error ภาษาไทยต้องถึง Node เป็น UTF-8 (ไม่ใช่ cp874) ไม่งั้น UI จับข้อความไม่ได้

from openpyxl import load_workbook

def strip_defined_names(path):
    """Remove <definedNames> from workbook.xml to prevent Excel repair dialog."""
    tmp = path + '.tmp'
    with zipfile.ZipFile(path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'xl/workbook.xml':
                xml = data.decode('utf-8')
                xml = re.sub(r'<definedNames\s*/>', '', xml)
                xml = re.sub(r'<definedNames>.*?</definedNames>', '', xml, flags=re.DOTALL)
                data = xml.encode('utf-8')
            zout.writestr(item, data)
    os.replace(tmp, path)

def pin_local(path):
    """Force file to be local (unpinned) on OneDrive Files On-Demand."""
    try:
        subprocess.run(['attrib', '-U', path], check=False, capture_output=True)
    except Exception:
        pass

BASE       = os.path.dirname(os.path.abspath(__file__))
THEME      = os.path.join(BASE, 'data', 'DailyLab_theme.xlsx')
LOCAL_DATA = os.environ.get('LV_LOCAL_DATA') or os.path.join(BASE, 'data')   # env override ใช้ตอน e2e test

def _load_push_dir():
    if os.environ.get('LV_EXCEL_DIR'):   # e2e test
        return os.environ['LV_EXCEL_DIR']
    try:
        with open(os.path.join(BASE, 'config', 'paths.json'), encoding='utf-8') as f:
            cfg = json.load(f)
        d = cfg.get('excel_data_dir', '').strip().rstrip('/\\')
        return d if d else None
    except Exception as e:
        sys.stderr.write(f'[excel_writer] failed to load paths.json: {e}\n')
        return None

PUSH_DIR = _load_push_dir()

with open(os.path.join(BASE, 'config', 'excel_cell_map.json'), encoding='utf-8') as f:
    CELL_MAP = json.load(f)

_TITLE_PREFIXES = ['นางสาว', 'นาง', 'นาย', 'ดร.', 'รศ.ดร.', 'ผศ.ดร.', 'รศ.', 'ผศ.', 'ศ.ดร.', 'ศ.']

def _first_name(full_name):
    """Strip Thai title and return first name only (no surname)."""
    if not full_name:
        return ''
    s = full_name.strip()
    for prefix in _TITLE_PREFIXES:
        if s.startswith(prefix):
            s = s[len(prefix):].strip()
            break
    return s.split()[0] if s else ''

def _position_abbr(position_label):
    """Extract number from position_label and return 'นว.' + number, e.g. 'นว.5'."""
    if not position_label:
        return 'นว.'
    m = re.search(r'\d+', position_label)
    return f'นว.{m.group()}' if m else 'นว.'

_SHIFT_ROWS = {'00-08': 77, '08-16': 78, '16-24': 79}  # 1-indexed Excel rows

# static labels missing from DailyLab_theme.xlsx — written every day
_STATIC_LABELS = {
    'H63': 'at temp (  ̊C)',  # TW1 Langelier temp label
    'H69': 'at temp (  ̊C)',
    'Q63': 'at temp (  ̊C)',  # TW2 Langelier temp label
    'Q69': 'at temp (  ̊C)',
}

_MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
_MONTH_TH   = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

def _excel_filename(date_str):
    y, m, _ = date_str.split('-')
    month_num = int(m)
    abbr = _MONTH_ABBR[month_num - 1]
    buddhist_yy = (int(y) + 543) % 100
    return f'{month_num:02d}DailyLab_{abbr}{buddhist_yy:02d}.xlsx'

def local_monthly_path(date_str):
    return os.path.join(LOCAL_DATA, _excel_filename(date_str))

def push_monthly_path(date_str):
    if not PUSH_DIR:
        return None
    return os.path.join(PUSH_DIR, _excel_filename(date_str))

def ensure_local(local_path):
    """สร้างหรือซ่อมไฟล์ใน local staging."""
    if not os.path.exists(local_path):
        shutil.copy(THEME, local_path)
    try:
        wb = load_workbook(local_path)
        return wb
    except Exception as e:
        sys.stderr.write(f'[excel_writer] {os.path.basename(local_path)} corrupted ({e}), recreating\n')
        os.remove(local_path)
        shutil.copy(THEME, local_path)
        return load_workbook(local_path)

def push_to_dest(local_path, push_path):
    """Copy local file ไปปลายทาง แล้ว pin ให้เห็นใน OneDrive. ล้มเหลว → raise ให้เข้า excel_queue."""
    dest_dir = os.path.dirname(push_path)
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)
    shutil.copy2(local_path, push_path)
    pin_local(push_path)

def _find_open_book(file_path):
    """คืน (app, book) ถ้าไฟล์เปิดอยู่ใน Excel instance ที่รันอยู่แล้ว ไม่เช่นนั้นคืน (None, None)."""
    import xlwings as xw
    norm = os.path.normcase(os.path.abspath(file_path))
    for app in xw.apps:
        for book in app.books:
            try:
                if os.path.normcase(os.path.abspath(book.fullname)) == norm:
                    return app, book
            except Exception:
                pass
    return None, None


def _assert_not_open_elsewhere(file_path):
    """Excel ที่เปิดไฟล์อยู่ (รวมถึงเครื่องอื่นบน network share) จะถือ handle แบบ deny-write
    → เปิด r+b ไม่ได้. เช็กก่อนให้ Excel ของเราเปิด เพราะถ้าเปิดได้แค่ read-only
    save() จะเงียบหรือเขียนลง copy อื่นแทนไฟล์จริง."""
    try:
        with open(file_path, 'r+b'):
            pass
    except PermissionError:
        raise RuntimeError(f'{os.path.basename(file_path)} ถูกเปิดค้างอยู่ (อาจเป็นเครื่องอื่น) '
                           f'— ปิดไฟล์แล้วระบบจะ retry เอง')


def _clear_stale_lock(file_path):
    """ลบ ~$filename lock file ถ้ามีอยู่แต่ไม่มี Excel COM instance เปิดไฟล์นั้นจริง ๆ
    Excel สร้าง lock file เมื่อเปิดไฟล์ และลบเมื่อปิด — ถ้า Excel crash lock จะค้างไว้
    ทำให้ invisible xlwings app เปิดไฟล์เป็น read-only โดยไม่จำเป็น"""
    dirpath = os.path.dirname(os.path.abspath(file_path))
    lock_path = os.path.join(dirpath, '~$' + os.path.basename(file_path))
    if os.path.exists(lock_path):
        try:
            os.remove(lock_path)
            sys.stderr.write(f'[excel_writer] removed stale lock: {os.path.basename(lock_path)}\n')
        except Exception as e:
            sys.stderr.write(f'[excel_writer] cannot remove stale lock {lock_path}: {e}\n')


def _write_day_xlwings(file_path, date_str, day_records, recorders, controls=None):
    """เขียนข้อมูลลงไฟล์ที่มีอยู่แล้วผ่าน Excel COM — ไม่ rewrite ไฟล์ทั้งหมด.

    ถ้า Excel มีไฟล์นี้เปิดอยู่แล้ว → เขียนผ่าน book นั้นโดยตรง (ไม่สร้าง instance ใหม่)
    เพื่อหลีกเลี่ยงการเปิด read-only copy ที่ save แล้วไม่เขียนทับไฟล์จริง
    """
    import xlwings as xw

    pin_local(file_path)
    y, m, d = date_str.split('-')
    day = str(int(d))
    buddhist_year = int(y) + 543
    month_th = _MONTH_TH[int(m) - 1]

    # ถ้า Excel เปิดไฟล์นี้อยู่แล้ว ใช้ book นั้น (ไม่สร้าง app ใหม่)
    existing_app, wb = _find_open_book(file_path)
    owned_app = None
    if wb is None:
        _assert_not_open_elsewhere(file_path)
        _clear_stale_lock(file_path)   # ผ่าน check ข้างบนแล้ว = ไม่มีใครเปิดจริง → ~$ ที่เหลือคือ lock ค้างจาก crash
        owned_app = xw.App(visible=False, add_book=False)
        owned_app.display_alerts = False
        wb = owned_app.books.open(file_path)

    try:
        # เครื่องอื่นเปิดไฟล์ค้างบน share → Excel เปิดเป็น read-only แล้ว save() ไม่ลงไฟล์จริง
        if wb.api.ReadOnly:
            raise RuntimeError(f'{os.path.basename(file_path)} opened read-only '
                               f'(ไฟล์ถูกเปิดค้างอยู่ที่เครื่องอื่น — ปิดไฟล์แล้วระบบจะ retry เอง)')

        sheet_names = [s.name for s in wb.sheets]

        if day not in sheet_names:
            theme = wb.sheets['theme']
            theme.api.Copy(Before=wb.sheets[0].api)
            new_ws = wb.sheets[0]
            new_ws.name = day
            ws = new_ws
        else:
            ws = wb.sheets[day]

        ws['V1'].value = int(day)
        ws['X1'].value = month_th
        ws['AA1'].value = buddhist_year

        cells = {}
        for r in day_records:
            slot_map = CELL_MAP.get(r['param_key'])
            if not slot_map:
                continue
            addr = slot_map.get(r['trans_time'])
            if not addr:
                continue
            try:
                val = float(r['trans_value'])
            except (ValueError, TypeError):
                val = r['trans_value']
            if isinstance(val, str):
                ws[addr].number_format = '@'   # กัน Excel แปลงข้อความเอง เช่น RecommendDose "4 - 6" → วันที่ 6 เม.ย.
            ws[addr].value = val
            cells[addr] = val

        date_recorders = (recorders or {}).get(date_str, {})
        night = date_recorders.get('16-24', {})
        for shift_range, row in _SHIFT_ROWS.items():
            rec = date_recorders.get(shift_range)
            if not rec:
                continue
            ws[f'P{row}'].value = _first_name(rec.get('name', ''))
            ws[f'R{row}'].value = _position_abbr(rec.get('position_label', ''))
        if night:
            ws['S77'].value = _first_name(night.get('name', ''))
            ws['T78'].value = _position_abbr(night.get('position_label', ''))

        for addr, label in _STATIC_LABELS.items():
            ws[addr].value = label
        for addr, v in (controls or {}).items():   # Control Value จากสถานการณ์ที่ active
            ws[addr].value = v

        wb.save()
        if owned_app:
            wb.close()
    finally:
        if owned_app:
            owned_app.quit()

    _verify_saved(file_path, day, cells)
    return cells


def _verify_saved(file_path, sheet, cells):
    """อ่านไฟล์บนดิสก์กลับมาเช็กว่าค่าลงจริง — กัน save() ที่ไม่ error แต่ไม่ได้เขียนไฟล์."""
    if not cells:
        return
    wb = load_workbook(file_path, read_only=True)
    try:
        if sheet not in wb.sheetnames:
            raise RuntimeError(f'verify: sheet "{sheet}" not found in saved file')
        ws = wb[sheet]
        bad = []
        for addr, val in cells.items():
            got = ws[addr].value
            same = (got == val) or (isinstance(val, float) and isinstance(got, (int, float)) and abs(got - val) < 1e-9)
            if not same:
                bad.append(f'{addr}: expected {val!r} got {got!r}')
        if bad:
            raise RuntimeError('verify: saved file does not contain written values — ' + '; '.join(bad[:5]))
    finally:
        wb.close()


def _write_day(wb, date_str, day_records, recorders, sheet_name=None, controls=None):
    """เขียน records ของวันเดียวลง workbook ที่โหลดแล้ว (in-place)."""
    y, m, d = date_str.split('-')
    day = str(int(d))
    buddhist_year = int(y) + 543
    month_th = _MONTH_TH[int(m) - 1]
    sheet = sheet_name or day

    if sheet not in wb.sheetnames:
        ws = wb.copy_worksheet(wb['theme'])
        ws.title = sheet
    else:
        ws = wb[sheet]

    ws['V1'] = int(day)
    ws['X1'] = month_th
    ws['AA1'] = buddhist_year

    for r in day_records:
        slot_map = CELL_MAP.get(r['param_key'])
        if not slot_map:
            continue
        addr = slot_map.get(r['trans_time'])
        if not addr:
            continue
        try:
            val = float(r['trans_value'])
        except (ValueError, TypeError):
            val = r['trans_value']
        ws[addr] = val

    date_recorders = (recorders or {}).get(date_str, {})
    night = date_recorders.get('16-24', {})
    for shift_range, row in _SHIFT_ROWS.items():
        rec = date_recorders.get(shift_range)
        if not rec:
            continue
        fname = _first_name(rec.get('name', ''))
        pos   = _position_abbr(rec.get('position_label', ''))
        ws[f'P{row}'] = fname
        ws[f'R{row}'] = pos
    night_name = _first_name(night.get('name', '')) if night else None
    night_pos  = _position_abbr(night.get('position_label', '')) if night else None
    if night_name is not None:
        ws['S77'] = night_name
    if night_pos is not None:
        ws['T78'] = night_pos

    for addr, label in _STATIC_LABELS.items():
        ws[addr] = label
    for addr, v in (controls or {}).items():   # Control Value จากสถานการณ์ที่ active
        ws[addr] = v


DETAILS = []   # ไฟล์/ชีท/เซลล์ที่เขียนจริง — ส่งกลับใน JSON ให้ตรวจจาก response ได้

def write_records(records, recorders=None, controls=None):
    by_date = {}
    for r in records:
        by_date.setdefault(r['trans_dtm'], []).append(r)

    total = 0
    errors = []
    DETAILS.clear()
    for date_str, day_records in by_date.items():
        local_path = local_monthly_path(date_str)
        push_path  = push_monthly_path(date_str)

        # ถ้าปลายทางมีไฟล์อยู่แล้ว → ใช้ xlwings เขียนเฉพาะ cell (ไม่ rewrite ไฟล์)
        # ล้มเหลว → เก็บ error แล้ว exit 1 ให้ Node เข้า excel_queue (เดิมกลืน error แล้วคืน written 0)
        if push_path and os.path.exists(push_path):
            try:
                cells = _write_day_xlwings(push_path, date_str, day_records, recorders, controls)
                total += len(cells)
                DETAILS.append({'file': push_path, 'sheet': str(int(date_str[-2:])),
                                'mode': 'xlwings', 'cells': cells})
            except Exception as e:
                errors.append(f'xlwings write to {push_path} failed: {type(e).__name__}: {e}')
            continue

        # ปลายทางไม่มีไฟล์ → ใช้ local staging แล้ว copy ออกไป
        if push_path and os.path.exists(local_path) and not os.path.exists(push_path):
            try:
                shutil.copy2(local_path, push_path)
            except Exception as e:
                sys.stderr.write(f'[excel_writer] pull from local to dest failed: {e}\n')

        wb = ensure_local(local_path)
        _write_day(wb, date_str, day_records, recorders, controls=controls)
        wb.save(local_path)
        strip_defined_names(local_path)
        total += sum(1 for r in day_records if CELL_MAP.get(r['param_key'], {}).get(r['trans_time']))

        if push_path:
            try:
                push_to_dest(local_path, push_path)
            except Exception as e:
                errors.append(f'push to {push_path} failed: {type(e).__name__}: {e}')
                continue
        DETAILS.append({'file': push_path or local_path, 'sheet': str(int(date_str[-2:])),
                        'mode': 'openpyxl', 'local': local_path})

    if errors:
        raise RuntimeError('; '.join(errors))
    return total

_MONTH_TH_ABBR = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

_PRINT_AREA = 'A1:AA79'

def build_export(dates, records, recorders, out_path, controls=None, cells=None):
    """ไฟล์ใหม่สำหรับดาวน์โหลด/พิมพ์: 1 ชีทต่อวัน (copy จาก theme) — ไม่แตะไฟล์เดือน."""
    by_date = {}
    for r in records:
        by_date.setdefault(r['trans_dtm'], []).append(r)
    one_month = len({d[:7] for d in dates}) == 1
    wb = load_workbook(THEME)
    for date_str in sorted(dates):
        _, m, d = date_str.split('-')
        name = str(int(d)) if one_month else f'{int(d)} {_MONTH_TH_ABBR[int(m) - 1]}'
        _write_day(wb, date_str, by_date.get(date_str, []), recorders, sheet_name=name, controls=controls)
        for addr, v in ((cells or {}).get(date_str) or {}).items():   # เช่น Daily Dosage จาก Daily Report
            wb[name][addr] = v
    del wb['theme']
    for i, ws in enumerate(wb.worksheets):
        ws.sheet_view.tabSelected = i == 0   # กันชีทถูก group (copy มาจาก theme ที่ selected)
        # print area ของฟอร์มต้นฉบับ (05DailyLab_May69.xlsx: A1:AA79, พอดี 1 หน้า) — theme ไม่มีเพราะ strip_defined_names
        ws.print_area = _PRINT_AREA
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 1
    wb.active = 0
    wb.save(out_path)   # ไม่ strip_defined_names: theme ไม่มี name ค้าง และต้องเก็บ print area ไว้

if __name__ == '__main__':
    if sys.argv[1] == '--build':
        with open(sys.argv[2], encoding='utf-8') as f:
            data = json.load(f)
        build_export(data['dates'], data['records'], data.get('recorders', {}), sys.argv[3], data.get('controls'), data.get('cells'))
        print(json.dumps({'ok': True}))
        sys.exit(0)
    data = json.loads(sys.argv[1])
    try:
        written = write_records(data['records'], data.get('recorders', {}), data.get('controls'))
    except Exception as e:
        sys.stderr.write(f'[excel_writer] {e}\n')
        sys.exit(1)
    print(json.dumps({'written': written, 'details': DETAILS}))
