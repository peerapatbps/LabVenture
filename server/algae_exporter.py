"""
Export algae records สำหรับวันที่กำหนด ลง Algae2569.xlsx

Input (sys.argv[1]): JSON string
  {
    "date": "2026-07-04",
    "records": [
      { "species_name": "Achnanthes sp.", "station": "RW", "count": 200 },
      ...
    ],
    "wq": {
      "RW.turb": "25.3", "RW.pH": "7.2", "RW.OC": "2.1", "RW.Conduct": "180",
      ...
    }
  }

Flow:
  1. เปิด Algae2569.xlsx จาก algae_excel_path ใน paths.json
  2. Copy sheet ต้นฉบับ (sheet สุดท้าย) แล้วตั้งชื่อ DDMMM เช่น 04Jul
     - ถ้า sheet ชื่อนี้มีอยู่แล้ว ให้ overwrite ข้อมูล
  3. เติมค่า F3 = " DD MMMM YYYY" (ภาษาไทย, ปี พ.ศ.)
  4. เติมข้อมูล station rows (9-15): B=9.00, D=turb, E=pH, F=OC, G=Cond
     - Hide rows สถานที่ที่ไม่มีข้อมูลสาหร่าย
  5. เติมค่า count ลงใน matrix ชนิด-สถานที่ (col D-J, row 19-93)
  6. Hide rows species ที่ทุก station เป็น null
  7. บันทึก
"""
import sys, json, os
sys.stdout.reconfigure(encoding='utf-8')

from openpyxl import load_workbook

BASE = os.path.dirname(os.path.abspath(__file__))

def load_config():
    with open(os.path.join(BASE, 'config', 'paths.json'), encoding='utf-8') as f:
        return json.load(f)

# Station → matrix column (species count matrix, row 19-93)
STATION_COL = {
    'RW':  'D',
    'TW1': 'E',
    'TW2': 'F',
    'CW1': 'G',
    'CW2': 'H',
    'CW3': 'I',
    'CW4': 'J',
}
STATION_COLS = list(STATION_COL.values())  # D-J

# Station → row in the station summary section (rows 9-15)
STATION_ROW = {
    'RW':  9,
    'TW1': 10,
    'TW2': 11,
    'CW1': 12,
    'CW2': 13,
    'CW3': 14,
    'CW4': 15,
}

# Water quality param_keys per station (None = not tracked at station level)
STATION_WQ = {
    'RW':  {'turb': 'RW.turb',  'pH': 'RW.pH',  'OC': 'RW.OC',  'cond': 'RW.Conduct'},
    'TW1': {'turb': 'TW1.turb', 'pH': 'TW1.pH', 'OC': 'TW1.OC', 'cond': 'TW1.Conduct'},
    'TW2': {'turb': 'TW2.turb', 'pH': 'TW2.pH', 'OC': 'TW2.OC', 'cond': 'TW2.Conduct'},
    'CW1': {'turb': 'CW1.turb', 'pH': None,      'OC': 'CW1.OC', 'cond': None},
    'CW2': {'turb': 'CW2.turb', 'pH': None,      'OC': 'CW2.OC', 'cond': None},
    'CW3': {'turb': 'CW3.turb', 'pH': None,      'OC': 'CW3.OC', 'cond': None},
    'CW4': {'turb': 'CW4.turb', 'pH': None,      'OC': 'CW4.OC', 'cond': None},
}
# D=turb, E=pH, F=OC, G=Cond
WQ_COL = {'turb': 'D', 'pH': 'E', 'OC': 'F', 'cond': 'G'}

SPECIES_ROW_MIN = 19
SPECIES_ROW_MAX = 93

_MONTH_ABBR_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
_MONTH_FULL_TH = [
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน',
    'พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม',
    'กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
]

def sheet_tab_name(date_str):
    """2026-07-04 → '04Jul'"""
    y, m, d = date_str.split('-')
    return f'{int(d):02d}{_MONTH_ABBR_EN[int(m)-1]}'

def thai_date_label(date_str):
    """2026-07-04 → '   04 กรกฎาคม 2569'"""
    y, m, d = date_str.split('-')
    buddhist_year = int(y) + 543
    month_th = _MONTH_FULL_TH[int(m) - 1]
    return f'   {int(d)} {month_th} {buddhist_year}'

def build_species_row_map(ws):
    """Scan column C rows 19-93, return {species_name: row_number}."""
    mapping = {}
    for row in ws.iter_rows(min_row=SPECIES_ROW_MIN, max_row=SPECIES_ROW_MAX, min_col=3, max_col=3):
        cell = row[0]
        if cell.value and isinstance(cell.value, str):
            mapping[cell.value.strip()] = cell.row
    return mapping

def to_num(val):
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return val

def export(date_str, records, wq, signer=None):
    cfg = load_config()
    xlsx_path = cfg.get('algae_excel_path', '')
    if not xlsx_path or not os.path.exists(xlsx_path):
        raise FileNotFoundError(f'algae_excel_path not found: {xlsx_path}')

    wb = load_workbook(xlsx_path)
    master_name = wb.sheetnames[-1]  # ต้นฉบับ is always last
    tab_name = sheet_tab_name(date_str)

    if tab_name in wb.sheetnames:
        ws = wb[tab_name]
        # Clear species matrix
        for row in range(SPECIES_ROW_MIN, SPECIES_ROW_MAX + 1):
            for col_letter in STATION_COLS:
                ws[f'{col_letter}{row}'] = None
        # Clear station WQ cells
        for row in range(9, 16):
            for col_letter in ['D', 'E', 'F', 'G']:
                ws[f'{col_letter}{row}'] = None
    else:
        master_ws = wb[master_name]
        ws = wb.copy_worksheet(master_ws)
        ws.title = tab_name
        master_idx = wb.sheetnames.index(master_name)
        wb.move_sheet(ws, offset=master_idx - wb.sheetnames.index(tab_name))

    # 1. F3: date label in Thai/Buddhist
    ws['F3'] = thai_date_label(date_str)

    # 2. Species matrix: track which stations have data
    species_row = build_species_row_map(ws)
    stations_with_data = set()
    written = 0

    for rec in records:
        species = (rec.get('species_name') or '').strip()
        station = (rec.get('station') or '').strip()
        count = rec.get('count')

        row_num = species_row.get(species)
        col_letter = STATION_COL.get(station)
        if row_num is None or col_letter is None or count is None:
            continue

        try:
            ws[f'{col_letter}{row_num}'] = float(count)
        except (ValueError, TypeError):
            ws[f'{col_letter}{row_num}'] = count
        stations_with_data.add(station)
        written += 1

    # 3. Station rows (9-15): B=9.00, D=turb, E=pH, F=OC, G=Cond; hide if no data
    #    Renumber col A sequentially for visible stations only (1, 2, 3, ...)
    station_order = ['RW', 'TW1', 'TW2', 'CW1', 'CW2', 'CW3', 'CW4']
    counter = 1
    for station in station_order:
        row_num = STATION_ROW[station]
        has_data = station in stations_with_data
        ws[f'B{row_num}'] = 9.00
        wq_keys = STATION_WQ.get(station, {})
        for field, col_letter in WQ_COL.items():
            param_key = wq_keys.get(field)
            if param_key and param_key in wq:
                ws[f'{col_letter}{row_num}'] = to_num(wq[param_key])
        ws.row_dimensions[row_num].hidden = not has_data
        if has_data:
            ws[f'A{row_num}'] = f'{counter}) {station}'
            counter += 1

    # 4. Hide species rows with no data across all stations
    for row in ws.iter_rows(min_row=SPECIES_ROW_MIN, max_row=SPECIES_ROW_MAX):
        row_num = row[0].row
        vals = [ws[f'{col}{row_num}'].value for col in STATION_COLS]
        all_empty = all(v in (None, 0, '') for v in vals)
        ws.row_dimensions[row_num].hidden = all_empty

    # 5. Signer: C107 = "(name)", C108 = "ตำแหน่ง  " + position_label + " " + dept_label
    if signer:
        name = (signer.get('name') or '').strip()
        position = (signer.get('position_label') or '').strip()
        dept = (signer.get('dept_label') or '').strip()
        if name:
            ws['C107'] = f'({name})'
        pos_full = f'{position} {dept}'.strip() if dept else position
        if pos_full:
            ws['C108'] = f'ตำแหน่ง  {pos_full}'

    wb.save(xlsx_path)
    return {'written': written, 'sheet': tab_name, 'path': xlsx_path,
            'stations': sorted(stations_with_data)}

if __name__ == '__main__':
    data = json.loads(sys.argv[1])
    result = export(data['date'], data.get('records', []), data.get('wq', {}), data.get('signer'))
    print(json.dumps(result))
