"""สร้าง templates/algae_master.xlsx จากชีท 'master' ใน Algae2569.xlsx (รันครั้งเดียว / เมื่อฟอร์มเปลี่ยน)
  python scripts/build_algae_master.py [source.xlsx]
"""
import sys, os
from openpyxl import load_workbook

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'data', 'Algae2569.xlsx')
OUT = os.path.join(BASE, 'templates', 'algae_master.xlsx')

wb = load_workbook(SRC)
for name in wb.sheetnames:
    if name != 'master':
        del wb[name]
ws = wb['master']

# ล้างค่ารอบเก่า — exporter เติมใหม่ทุกครั้ง
ws['F3'] = None
for r in range(9, 16):
    for c in 'DEFG':
        ws[f'{c}{r}'] = None
for r in range(19, 94):
    for c in 'DEFGHIJ':
        ws[f'{c}{r}'] = None
ws['C107'] = '(                                        )'
ws['C108'] = 'ตำแหน่ง  '

# ป้ายสถานีผิดในต้นฉบับ (A13 = "5) CW3")
for i, st in enumerate(['RW', 'TW1', 'TW2', 'CW1', 'CW2', 'CW3', 'CW4']):
    ws[f'A{9 + i}'] = f'{i + 1}) {st}'

ws.print_area = 'A1:K109'
ws.page_setup.paperSize = ws.PAPERSIZE_A4
ws.page_setup.orientation = 'portrait'
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 0
ws.sheet_properties.pageSetUpPr.fitToPage = True

os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print('saved', OUT)
