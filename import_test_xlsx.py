"""
อ่าน test.xlsx sheet "28" แล้ว POST ค่าไปที่ platform API
"""
import sys, json, http.cookiejar, urllib.request, urllib.parse
sys.stdout.reconfigure(encoding='utf-8')
from openpyxl import load_workbook

BASE_URL = 'http://localhost:8889'
DATE     = '2026-06-24'
SOURCE   = r'C:\Users\peera\OneDrive\Desktop\test.xlsx'

wb = load_workbook(SOURCE, data_only=True)
ws = wb['28']

def cell(addr):
    v = ws[addr].value
    return None if v is None or str(v).strip() in ('-', '', '#DIV/0!', '#VALUE!') else v

def num(addr):
    v = cell(addr)
    try:    return float(v) if v is not None else None
    except: return None

records = []

def add(param_key, slot, value):
    if value is not None:
        records.append({
            'param_key':   param_key,
            'trans_dtm':   DATE,
            'trans_time':  slot,
            'trans_value': str(value),
        })

# ── RW (rows 5-16, cols C-J) ──────────────────────────────────────────
RW_ROWS = {'01:00':5,'03:00':6,'05:00':7,'07:00':8,'09:00':9,'11:00':10,
           '13:00':11,'15:00':12,'17:00':13,'19:00':14,'21:00':15,'23:00':16}
for slot, row in RW_ROWS.items():
    add('RW.Turb',     slot, num(f'C{row}'))
    add('RW.pH',       slot, num(f'D{row}'))
    add('RW.Alk',      slot, num(f'E{row}'))
    add('RW.Conduct',  slot, num(f'F{row}'))
    add('RW.DO',       slot, num(f'G{row}'))
    add('RW.Hardness', slot, num(f'H{row}'))
    add('RW.OC',       slot, num(f'I{row}'))
    add('RW.Temp',     slot, num(f'J{row}'))

# ── Incoming (daily) ─────────────────────────────────────────────────
add('Incoming.Thamuang.Turb',    'daily', num('L6'))
add('Incoming.Thamuang.Conduct', 'daily', num('M6'))
add('Incoming.Thamuang.DO',      'daily', num('N6'))
add('Incoming.Banglen.Turb',     'daily', num('L13'))
add('Incoming.Banglen.Conduct',  'daily', num('M13'))
add('Incoming.Banglen.DO',       'daily', num('N13'))

# ── JarTest (daily) ──────────────────────────────────────────────────
ALUM_COLS = ['D','E','F','G','H','I']
PACL_COLS = ['K','L','M','N','O','P']
for i, col in enumerate(ALUM_COLS, 1):
    d = f'D{i}'
    add(f'JarTest.Alum.{d}.Dose', 'daily', num(f'{col}23'))
    add(f'JarTest.Alum.{d}.Turb', 'daily', num(f'{col}25'))
    add(f'JarTest.Alum.{d}.pH',   'daily', num(f'{col}26'))
    add(f'JarTest.Alum.{d}.Alk',  'daily', num(f'{col}27'))
for i, col in enumerate(PACL_COLS, 1):
    d = f'D{i}'
    add(f'JarTest.PACl.{d}.Dose', 'daily', num(f'{col}23'))
    add(f'JarTest.PACl.{d}.Turb', 'daily', num(f'{col}25'))
    add(f'JarTest.PACl.{d}.pH',   'daily', num(f'{col}26'))
    add(f'JarTest.PACl.{d}.Alk',  'daily', num(f'{col}27'))

# ── CW Phase 1 & 2 (rows 32-37) ──────────────────────────────────────
CW12_ROWS = {'01:00':32,'05:00':33,'09:00':34,'13:00':35,'17:00':36,'21:00':37}
for slot, row in CW12_ROWS.items():
    add('CW1_A.Turb',  slot, num(f'C{row}'))
    add('CW1_A.pH',    slot, num(f'D{row}'))
    add('CW1_A.Alk',   slot, num(f'E{row}'))
    add('CW1_B.Turb',  slot, num(f'F{row}'))
    add('CW1_B.pH',    slot, num(f'G{row}'))
    add('CW1_B.Alk',   slot, num(f'H{row}'))
    add('CW1.Turb',    slot, num(f'I{row}'))
    add('CW1.OC',      slot, num(f'J{row}'))
    add('CW1.ResCl2',  slot, num(f'K{row}'))
    add('FW1.Turb',    slot, num(f'L{row}'))
    add('FW1.OC',      slot, num(f'M{row}'))
    add('FW1.ResCl2',  slot, num(f'N{row}'))
    add('CW2_A.Turb',  slot, num(f'P{row}'))
    add('CW2_A.pH',    slot, num(f'Q{row}'))
    add('CW2_A.Alk',   slot, num(f'R{row}'))
    add('CW2_B.Turb',  slot, num(f'S{row}'))
    add('CW2_B.pH',    slot, num(f'T{row}'))
    add('CW2_B.Alk',   slot, num(f'U{row}'))
    add('CW2.Turb',    slot, num(f'V{row}'))
    add('CW2.OC',      slot, num(f'W{row}'))
    add('CW2.ResCl2',  slot, num(f'X{row}'))
    add('FW2.Turb',    slot, num(f'Y{row}'))
    add('FW2.OC',      slot, num(f'Z{row}'))
    add('FW2.ResCl2',  slot, num(f'AA{row}'))

# ── CW Phase 3 & 4 (rows 44-49) ──────────────────────────────────────
CW34_ROWS = {'01:00':44,'05:00':45,'09:00':46,'13:00':47,'17:00':48,'21:00':49}
for slot, row in CW34_ROWS.items():
    add('CW3_A.Turb',  slot, num(f'C{row}'))
    add('CW3_A.pH',    slot, num(f'D{row}'))
    add('CW3_A.Alk',   slot, num(f'E{row}'))
    add('CW3_B.Turb',  slot, num(f'F{row}'))
    add('CW3_B.pH',    slot, num(f'G{row}'))
    add('CW3_B.Alk',   slot, num(f'H{row}'))
    add('CW3.Turb',    slot, num(f'I{row}'))
    add('CW3.OC',      slot, num(f'J{row}'))
    add('CW3.ResCl2',  slot, num(f'K{row}'))
    add('FW3.Turb',    slot, num(f'L{row}'))
    add('FW3.OC',      slot, num(f'M{row}'))
    add('FW3.ResCl2',  slot, num(f'N{row}'))
    add('CW4_A.Turb',  slot, num(f'P{row}'))
    add('CW4_A.pH',    slot, num(f'Q{row}'))
    add('CW4_A.Alk',   slot, num(f'R{row}'))
    add('CW4_B.Turb',  slot, num(f'S{row}'))
    add('CW4_B.pH',    slot, num(f'T{row}'))
    add('CW4_B.Alk',   slot, num(f'U{row}'))
    add('CW4.Turb',    slot, num(f'V{row}'))
    add('CW4.OC',      slot, num(f'W{row}'))
    add('CW4.ResCl2',  slot, num(f'X{row}'))
    add('FW4.Turb',    slot, num(f'Y{row}'))
    add('FW4.OC',      slot, num(f'Z{row}'))
    add('FW4.ResCl2',  slot, num(f'AA{row}'))

# ── TW1/2/3/4 (rows 58-69) ──────────────────────────────────────────
TW_ROWS = {'01:00':58,'03:00':59,'05:00':60,'07:00':61,'09:00':62,'11:00':63,
           '13:00':64,'15:00':65,'17:00':66,'19:00':67,'21:00':68,'23:00':69}
for slot, row in TW_ROWS.items():
    add('TW1.Turb',     slot, num(f'C{row}'))
    add('TW1.pH',       slot, num(f'D{row}'))
    add('TW1.ResCl2',   slot, num(f'E{row}'))
    add('TW1.Conduct',  slot, num(f'F{row}'))
    add('TW1.OC',       slot, num(f'G{row}'))
    add('TW1.Alk',      slot, num(f'H{row}'))
    add('TW1.Hardness', slot, num(f'I{row}'))
    add('TW1.Langelier',slot, num(f'J{row}'))
    add('TW1.Color',    slot, num(f'K{row}'))
    add('TW2.Turb',     slot, num(f'L{row}'))
    add('TW2.pH',       slot, num(f'M{row}'))
    add('TW2.ResCl2',   slot, num(f'N{row}'))
    add('TW2.Conduct',  slot, num(f'O{row}'))
    add('TW2.OC',       slot, num(f'P{row}'))
    add('TW2.Alk',      slot, num(f'Q{row}'))
    add('TW2.Hardness', slot, num(f'R{row}'))
    add('TW2.Langelier',slot, num(f'S{row}'))
    add('TW2.Color',    slot, num(f'T{row}'))
    add('TW3.Turb',     slot, num(f'V{row}'))
    add('TW3.pH',       slot, num(f'W{row}'))
    add('TW3.ResCl2',   slot, num(f'X{row}'))
    add('TW4.Turb',     slot, num(f'Y{row}'))
    add('TW4.pH',       slot, num(f'Z{row}'))
    add('TW4.ResCl2',   slot, num(f'AA{row}'))

# ── Chemical (rows 77-79) ────────────────────────────────────────────
add('Chem.RW.Al',  'daily', num('H77'))
add('Chem.RW.Fe',  'daily', num('I77'))
add('Chem.RW.Mn',  'daily', num('J77'))
add('Chem.RW.Cl',  'daily', num('K77'))
add('Chem.TW1.Al', 'daily', num('H78'))
add('Chem.TW1.Fe', 'daily', num('I78'))
add('Chem.TW1.Mn', 'daily', num('J78'))
add('Chem.TW1.Cl', 'daily', num('K78'))
add('Chem.TW2.Al', 'daily', num('H79'))
add('Chem.TW2.Fe', 'daily', num('I79'))
add('Chem.TW2.Mn', 'daily', num('J79'))
add('Chem.TW2.Cl', 'daily', num('K79'))

# ── Algae & Bacteria (rows 19-20) ────────────────────────────────────
add('Algae.RW.Total',        'daily', num('Q19'))
add('Algae.CW1.Total',       'daily', num('R19'))
add('Algae.CW2.Total',       'daily', num('S19'))
add('Algae.CW3.Total',       'daily', num('T19'))
add('Algae.CW4.Total',       'daily', num('U19'))
add('Algae.TW1.Total',       'daily', num('V19'))
add('Algae.TW2.Total',       'daily', num('W19'))
add('Algae.RW.ClogFilter',   'daily', num('Q20'))
add('Algae.CW1.ClogFilter',  'daily', num('R20'))
add('Algae.CW2.ClogFilter',  'daily', num('S20'))
add('Algae.CW3.ClogFilter',  'daily', num('T20'))
add('Algae.CW4.ClogFilter',  'daily', num('U20'))
add('Algae.TW1.ClogFilter',  'daily', num('V20'))
add('Algae.TW2.ClogFilter',  'daily', num('W20'))
add('Bacteria.TW1.Coliform', 'daily', num('Z19'))
add('Bacteria.TW2.Coliform', 'daily', num('AA19'))
add('Bacteria.TW1.EColi',    'daily', num('Z20'))
add('Bacteria.TW2.EColi',    'daily', num('AA20'))

print(f'Extracted {len(records)} records from test.xlsx')

# ── Call API ─────────────────────────────────────────────────────────
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

# 1. Bypass login
bypass_req = urllib.request.Request(
    f'{BASE_URL}/api/auth/bypass',
    data=b'{}',
    headers={'Content-Type': 'application/json'},
    method='POST'
)
with opener.open(bypass_req) as r:
    result = json.loads(r.read())
    print(f'Login: {result}')

# 2. Write records
payload = json.dumps({'records': records, 'plant_id': 2}).encode('utf-8')
write_req = urllib.request.Request(
    f'{BASE_URL}/api/write/nodes',
    data=payload,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
with opener.open(write_req) as r:
    result = json.loads(r.read())
    print(f'Write result: saved={result.get("saved")}, excel={result.get("excel")}')
    if result.get('aquadatResult') is None:
        print('(AquaDAT skipped — offline mode OK)')
