"""
เปรียบเทียบ sheet '1' (โปรแกรมเติม) กับ '1_F' (ข้อมูลถูกต้อง)
ข้าม cell ที่ว่างทั้งคู่, แสดงเฉพาะที่ต่างหรือขาด

วิธีใช้:  python compare_sheets.py [--file PATH]
"""
import sys, argparse, openpyxl
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PUSH_PATH = r'C:\Users\peera\Downloads\07DailyLab_Jul69.xlsx'

def cell_val(ws, row, col):
    v = ws.cell(row=row, column=col).value
    if v is None:
        return None
    if isinstance(v, float) and v == int(v):
        return int(v)
    return v

import re as _re

def _col_num(addr):
    m = _re.match(r'([A-Z]+)(\d+)', addr)
    letters = m.group(1)
    n = 0
    for c in letters: n = n * 26 + (ord(c) - ord('A') + 1)
    return n

def _row_num(addr):
    return int(_re.match(r'[A-Z]+(\d+)', addr).group(1))

def is_noise(addr, prog_val, ref_val):
    """True = ข้ามได้ (ไม่ใช่ข้อมูลที่เราเขียน)"""
    col = _col_num(addr)
    row = _row_num(addr)

    # formula/calculated cells: MAX/MIN/AVG rows (70-72, 17-19, 38-40, 50-52)
    if row in (17, 18, 19, 38, 39, 40, 50, 51, 52, 70, 71, 72):
        return True
    # formula cells: Langelier/OC calc rows 34, 46, 62, 68 col G,J,M,P,S,W,Z
    # rows 63 and 69 are temperature DATA inputs (TW1.Temp/TW2.Temp) — do NOT exclude
    if row in (34, 46, 62, 68) and col in (7, 10, 13, 16, 19, 23, 26):
        return True
    # V1 = sheet title
    if addr == 'V1':
        return True
    # D1 = formula serial date
    if addr == 'D1':
        return True
    # AI/AJ/AN/AO = admin/count cells
    if col >= 35:   # AI=35+
        return True
    # Static template labels (dash placeholders, "at temp" labels)
    if str(ref_val).strip() in ('-', 'at temp (  ̀C)', '') and prog_val is None:
        return True
    # NONE vs none — ต่างแค่ case
    if prog_val is not None and ref_val is not None:
        if str(prog_val).lower() == str(ref_val).lower():
            return True
    # I66 = empty label cell
    if addr == 'I66':
        return True
    return False


def compare(file_path):
    print(f'[compare] file: {file_path}')
    wb = openpyxl.load_workbook(file_path, data_only=True)

    if '1' not in wb.sheetnames:
        print('[compare] ERROR: sheet "1" not found')
        print('  available:', wb.sheetnames)
        return
    if '1_F' not in wb.sheetnames:
        print('[compare] ERROR: sheet "1_F" not found')
        print('  available:', wb.sheetnames)
        return

    ws_prog = wb['1']
    ws_ref  = wb['1_F']

    max_row = max(ws_prog.max_row, ws_ref.max_row)
    max_col = max(ws_prog.max_column, ws_ref.max_column)

    diffs   = []
    missing = []
    extra   = []
    noise   = 0

    for row in range(1, max_row + 1):
        for col in range(1, max_col + 1):
            pv = cell_val(ws_prog, row, col)
            rv = cell_val(ws_ref,  row, col)
            if pv is None and rv is None:
                continue
            addr = ws_prog.cell(row=row, column=col).coordinate
            if is_noise(addr, pv, rv):
                noise += 1
                continue
            if pv is None and rv is not None:
                missing.append((addr, rv))
            elif pv is not None and rv is None:
                extra.append((addr, pv))
            elif str(pv) != str(rv):
                diffs.append((addr, pv, rv))

    # ---- สรุป ----
    total_issues = len(diffs) + len(missing) + len(extra)

    print(f'\n{"="*60}')
    if total_issues == 0:
        print('  PASS — sheet "1" ตรงกับ "1_F" (ข้าม formula/admin {noise} cells)')
    else:
        print(f'  FAIL — พบความต่าง {total_issues} จุด  (ข้าม formula/admin {noise} cells)')
    print(f'{"="*60}')

    if diffs:
        print(f'\n[ค่าต่างกัน] {len(diffs)} cells:')
        print(f'  {"Cell":<6}  {"โปรแกรม (1)":<22}  {"อ้างอิง (1_F)":<22}')
        print(f'  {"-"*6}  {"-"*22}  {"-"*22}')
        for addr, pv, rv in sorted(diffs):
            print(f'  {addr:<6}  {str(pv):<22}  {str(rv):<22}')

    if missing:
        print(f'\n[ขาดใน sheet "1"] {len(missing)} cells:')
        print(f'  {"Cell":<6}  {"อ้างอิง (1_F)":<22}')
        print(f'  {"-"*6}  {"-"*22}')
        for addr, rv in sorted(missing):
            print(f'  {addr:<6}  {str(rv):<22}')

    if extra:
        print(f'\n[เกินใน sheet "1"] {len(extra)} cells:')
        print(f'  {"Cell":<6}  {"โปรแกรม (1)":<22}')
        print(f'  {"-"*6}  {"-"*22}')
        for addr, pv in sorted(extra):
            print(f'  {addr:<6}  {str(pv):<22}')

    print()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', default=PUSH_PATH)
    args = parser.parse_args()
    compare(args.file)
