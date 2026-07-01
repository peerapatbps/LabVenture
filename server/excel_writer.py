"""
รับ JSON records แล้วเขียนค่าลง monthly Excel
กฎ: copy theme → เติมค่าใน cell ที่มีอยู่แล้วเท่านั้น ห้ามแตะโครงสร้าง
"""
import sys, json, os, shutil, zipfile, re
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

BASE    = os.path.dirname(os.path.abspath(__file__))
DATA    = os.path.join(BASE, 'data')
THEME   = os.path.join(DATA, 'DailyLab_theme.xlsx')

with open(os.path.join(BASE, 'config', 'excel_cell_map.json'), encoding='utf-8') as f:
    CELL_MAP = json.load(f)

def monthly_path(date_str):
    y, m, _ = date_str.split('-')
    return os.path.join(DATA, f'DailyLab_{y}_{m}.xlsx')

def write_records(records):
    by_date = {}
    for r in records:
        by_date.setdefault(r['trans_dtm'], []).append(r)

    total = 0
    for date_str, day_records in by_date.items():
        path = monthly_path(date_str)

        # Binary copy from theme — ไม่แตะ XML
        if not os.path.exists(path):
            shutil.copy(THEME, path)

        try:
            wb = load_workbook(path)
        except Exception as e:
            # ไฟล์พัง — recreate จาก theme
            sys.stderr.write(f'[excel_writer] {os.path.basename(path)} corrupted ({e}), recreating\n')
            os.remove(path)
            shutil.copy(THEME, path)
            wb = load_workbook(path)

        day = str(int(date_str.split('-')[2]))
        if day not in wb.sheetnames:
            ws = wb.copy_worksheet(wb['theme'])
            ws.title = day
        else:
            ws = wb[day]

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
            total += 1

        wb.save(path)
        strip_defined_names(path)

    return total

if __name__ == '__main__':
    data = json.loads(sys.argv[1])
    written = write_records(data['records'])
    print(json.dumps({'written': written}))
