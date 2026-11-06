"""
สร้าง DailyLab_theme.xlsx จาก 05DailyLab_May69.xlsx
- ใช้ sheet "1" เป็นต้นแบบ เปลี่ยนชื่อเป็น "theme"
- ล้างค่าตัวเลข, formula, Max/Min/Avg labels
- ลบ definedNames ที่พัง
"""
import sys, os, re, zipfile
sys.stdout.reconfigure(encoding='utf-8')

from openpyxl import load_workbook

SRC  = '05DailyLab_May69.xlsx'
DEST = 'server/templates/DailyLab_theme.xlsx'
TMP  = DEST + '.tmp'

os.makedirs('server/data', exist_ok=True)

# ── 1. Load & clean ──────────────────────────────────────────────────────────
wb = load_workbook(SRC)
sheet = wb['1']
sheet.title = 'theme'

for name in wb.sheetnames[:]:
    if name != 'theme':
        del wb[name]

MAX_MIN_LABELS = {'max', 'min', 'avg', 'average'}

for row in sheet.iter_rows():
    for cell in row:
        v = cell.value
        if v is None:
            continue
        if isinstance(v, (int, float)):
            cell.value = None
        elif isinstance(v, str) and v.startswith('='):
            cell.value = None
        elif isinstance(v, str) and v.strip().lower() in MAX_MIN_LABELS:
            cell.value = None

wb.save(DEST)

# ── 2. Strip definedNames via zip ────────────────────────────────────────────
with zipfile.ZipFile(DEST, 'r') as zin, zipfile.ZipFile(TMP, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'xl/workbook.xml':
            xml = data.decode('utf-8')
            xml = re.sub(r'<definedNames\s*/>', '', xml)
            xml = re.sub(r'<definedNames>.*?</definedNames>', '', xml, flags=re.DOTALL)
            data = xml.encode('utf-8')
        zout.writestr(item, data)
os.replace(TMP, DEST)

# ── 3. Verify ────────────────────────────────────────────────────────────────
with zipfile.ZipFile(DEST, 'r') as z:
    wb_xml_final = z.read('xl/workbook.xml').decode('utf-8')

print(f'Saved: {DEST}')
print(f'definedNames: {"definedNames" in wb_xml_final}  (ต้อง False)')
