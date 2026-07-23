"""
รับ JSON records แล้วเขียนค่าลง monthly Excel
กฎ: copy theme → เติมค่าใน cell ที่มีอยู่แล้วเท่านั้น ห้ามแตะโครงสร้าง

Flow:
  1. เขียนลง server/data/ เสมอ (source of truth / recovery base)
  2. ถ้า excel_data_dir ตั้งค่าไว้ → copy ไปปลายทาง + attrib -U เพื่อ unpin จาก OneDrive
"""
import sys, json, os, shutil, zipfile, re, subprocess
sys.stdout.reconfigure(encoding='utf-8')

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
LOCAL_DATA = os.path.join(BASE, 'data')
THEME      = os.path.join(LOCAL_DATA, 'DailyLab_theme.xlsx')

def _load_push_dir():
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
    """Copy local file ไปปลายทาง แล้ว pin ให้เห็นใน OneDrive."""
    try:
        dest_dir = os.path.dirname(push_path)
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)
        shutil.copy2(local_path, push_path)
        pin_local(push_path)
    except Exception as e:
        sys.stderr.write(f'[excel_writer] push to {push_path} failed: {e}\n')

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


def _write_day_xlwings(file_path, date_str, day_records, recorders):
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
        _clear_stale_lock(file_path)   # ถ้า Excel crash ทิ้ง ~$ lock ไว้ ลบก่อนเปิด
        owned_app = xw.App(visible=False, add_book=False)
        wb = owned_app.books.open(file_path)

    try:
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

        written = 0
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
            ws[addr].value = val
            written += 1

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

        wb.save()
        if owned_app:
            wb.close()
        return written
    finally:
        if owned_app:
            owned_app.quit()


def _write_day(wb, date_str, day_records, recorders):
    """เขียน records ของวันเดียวลง workbook ที่โหลดแล้ว (in-place)."""
    y, m, d = date_str.split('-')
    day = str(int(d))
    buddhist_year = int(y) + 543
    month_th = _MONTH_TH[int(m) - 1]

    if day not in wb.sheetnames:
        ws = wb.copy_worksheet(wb['theme'])
        ws.title = day
    else:
        ws = wb[day]

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


def write_records(records, recorders=None):
    by_date = {}
    for r in records:
        by_date.setdefault(r['trans_dtm'], []).append(r)

    total = 0
    for date_str, day_records in by_date.items():
        local_path = local_monthly_path(date_str)
        push_path  = push_monthly_path(date_str)

        # ถ้าปลายทางมีไฟล์อยู่แล้ว → ใช้ xlwings เขียนเฉพาะ cell (ไม่ rewrite ไฟล์)
        if push_path and os.path.exists(push_path):
            try:
                total += _write_day_xlwings(push_path, date_str, day_records, recorders)
            except Exception as e:
                sys.stderr.write(f'[excel_writer] xlwings write to {push_path} failed: {e}\n')
            continue

        # ปลายทางไม่มีไฟล์ → ใช้ local staging แล้ว copy ออกไป
        if push_path and os.path.exists(local_path) and not os.path.exists(push_path):
            try:
                shutil.copy2(local_path, push_path)
            except Exception as e:
                sys.stderr.write(f'[excel_writer] pull from local to dest failed: {e}\n')

        wb = ensure_local(local_path)
        _write_day(wb, date_str, day_records, recorders)
        wb.save(local_path)
        strip_defined_names(local_path)
        total += sum(1 for r in day_records if CELL_MAP.get(r['param_key'], {}).get(r['trans_time']))

        if push_path:
            push_to_dest(local_path, push_path)

    return total

if __name__ == '__main__':
    data = json.loads(sys.argv[1])
    written = write_records(data['records'], data.get('recorders', {}))
    print(json.dumps({'written': written}))
