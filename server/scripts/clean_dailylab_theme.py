"""ล้าง templates/DailyLab_theme.xlsx ให้ตรงกับไฟล์พิมพ์แบบใหม่ (รันครั้งเดียว ต้องปิดไฟล์ใน Excel ก่อน)
  - ลบ conditional formatting ที่อ้างเกณฑ์ (สีของค่าที่เกินเกณฑ์มาจาก services/dailyLabMarkup.js แล้ว)
    คงกฎที่ไม่เกี่ยวกับเกณฑ์ไว้: ข้อความ "found" (ผลแบคทีเรีย)
  - ล้างสีแดง/น้ำเงินที่ทาตายตัวในช่องข้อมูล (V35, C36, F36, P36, P37, S37, V37, C49, F49)
  - ล้างชื่อ/ตำแหน่งผู้บันทึกที่ค้าง (P/R 77–79, S77, T78)
  - ป้าย "ResCl2 = 0.7 - 1.2" → "ResCl2 =" (ค่าจริงอยู่ในช่อง Control Value ถัดไป)
  - ล้างสูตรนับ COUNTIF ที่อ้าง Control Value (T3:T11, AF52:AQ52, AF55:AQ55) — ระบบเขียนตัวเลขนับเอง
    python scripts/clean_dailylab_theme.py
"""
import os, shutil, sys, time
from openpyxl import load_workbook
from openpyxl.formatting.formatting import ConditionalFormattingList

sys.stdout.reconfigure(encoding='utf-8')
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(BASE, 'templates', 'DailyLab_theme.xlsx')

backup = PATH.replace('.xlsx', f'.backup_{time.strftime("%Y%m%d_%H%M%S")}.xlsx')
shutil.copy2(PATH, backup)

wb = load_workbook(PATH)
ws = wb['theme']

keep = ConditionalFormattingList()
removed = kept = 0
for cf in ws.conditional_formatting:
    for rule in cf.rules:
        if any('found' in (f or '') for f in (rule.formula or [])):
            keep.add(str(cf.sqref), rule)
            kept += 1
        else:
            removed += 1
ws.conditional_formatting = keep

for addr in ['P77', 'R77', 'P78', 'R78', 'P79', 'R79', 'S77', 'T78']:
    ws[addr].value = None
for addr in ['D74', 'N74', 'W74']:
    if str(ws[addr].value or '').startswith('ResCl2 ='):
        ws[addr].value = 'ResCl2 ='
count_cells = [f'T{r}' for r in range(3, 12)] + [f'{c}{r}' for r in (52, 55) for c in
               ['AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ']]
for addr in count_cells:
    if isinstance(ws[addr].value, str) and ws[addr].value.startswith('=COUNTIF'):
        ws[addr].value = None

# สีแดง/น้ำเงินที่ทาตายตัวในช่องข้อมูล (ใช้ปิดช่องที่ CF เดิมครอบไม่ถึง) → สีอัตโนมัติ
from copy import copy
import json
cell_map = json.load(open(os.path.join(BASE, 'config', 'excel_cell_map.json'), encoding='utf-8'))
recolored = 0
for addr in {a for m in cell_map.values() if isinstance(m, dict) for a in m.values()}:
    c = ws[addr].font.color
    if c is not None and isinstance(c.rgb, str) and c.rgb in ('FFFF0000', 'FF0000FF'):
        f = copy(ws[addr].font); f.color = None; ws[addr].font = f; recolored += 1

wb.save(PATH)
print(f'conditional formatting: ลบ {removed} กฎ, คง {kept} กฎ ("found") · ล้างสีตายตัว {recolored} ช่อง · backup: {os.path.basename(backup)}')
