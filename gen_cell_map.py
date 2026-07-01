import sys, json
sys.stdout.reconfigure(encoding='utf-8')

RW_SLOTS   = {'01:00':5,'03:00':6,'05:00':7,'07:00':8,'09:00':9,'11:00':10,'13:00':11,'15:00':12,'17:00':13,'19:00':14,'21:00':15,'23:00':16}
CW12_SLOTS = {'01:00':32,'05:00':33,'09:00':34,'13:00':35,'17:00':36,'21:00':37}
CW34_SLOTS = {'01:00':44,'05:00':45,'09:00':46,'13:00':47,'17:00':48,'21:00':49}
TW_SLOTS   = {'01:00':58,'03:00':59,'05:00':60,'07:00':61,'09:00':62,'11:00':63,'13:00':64,'15:00':65,'17:00':66,'19:00':67,'21:00':68,'23:00':69}
SLOTS_4H   = ['01:00','05:00','09:00','13:00','17:00','21:00']

def mk(col, slots):
    return {slot: f'{col}{row}' for slot, row in slots.items()}

def mk4(col, base_slots):
    return mk(col, {s: r for s, r in base_slots.items() if s in SLOTS_4H})

def daily(cell):
    return {'daily': cell}

cell_map = {
    # RW
    'RW.Turb':     mk('C', RW_SLOTS),
    'RW.pH':       mk4('D', RW_SLOTS),
    'RW.Alk':      mk4('E', RW_SLOTS),
    'RW.Temp':     mk4('J', RW_SLOTS),
    'RW.Conduct':  mk('F', {'09:00':9,'21:00':15}),
    'RW.DO':       mk('G', {'09:00':9,'21:00':15}),
    'RW.Hardness': mk('H', {'09:00':9,'21:00':15}),
    'RW.OC':       mk('I', {'09:00':9,'21:00':15}),

    # Incoming
    'Incoming.Thamuang.Turb':    daily('L6'),
    'Incoming.Thamuang.Conduct': daily('M6'),
    'Incoming.Thamuang.DO':      daily('N6'),
    'Incoming.Banglen.Turb':     daily('L13'),
    'Incoming.Banglen.Conduct':  daily('M13'),
    'Incoming.Banglen.DO':       daily('N13'),

    # JarTest
    'JarTest.Alum.Turb': daily('C25'),
    'JarTest.Alum.pH':   daily('C26'),
    'JarTest.Alum.Alk':  daily('C27'),
    'JarTest.Alum.Dose': daily('AA23'),
    'JarTest.PACl.Turb': daily('J25'),
    'JarTest.PACl.pH':   daily('J26'),
    'JarTest.PACl.Alk':  daily('J27'),
    'JarTest.PACl.Dose': daily('AA25'),

    # CW Phase 1
    'CW1_A.Turb':  mk('C', CW12_SLOTS),
    'CW1_A.pH':    mk('D', CW12_SLOTS),
    'CW1_A.Alk':   mk('E', CW12_SLOTS),
    'CW1_B.Turb':  mk('F', CW12_SLOTS),
    'CW1_B.pH':    mk('G', CW12_SLOTS),
    'CW1_B.Alk':   mk('H', CW12_SLOTS),
    'CW1.Turb':    mk('I', CW12_SLOTS),
    'CW1.OC':      mk('J', CW12_SLOTS),
    'CW1.ResCl2':  mk('K', CW12_SLOTS),
    'FW1.Turb':    mk('L', CW12_SLOTS),
    'FW1.OC':      mk('M', CW12_SLOTS),
    'FW1.ResCl2':  mk('N', CW12_SLOTS),

    # CW Phase 2
    'CW2_A.Turb':  mk('P', CW12_SLOTS),
    'CW2_A.pH':    mk('Q', CW12_SLOTS),
    'CW2_A.Alk':   mk('R', CW12_SLOTS),
    'CW2_B.Turb':  mk('S', CW12_SLOTS),
    'CW2_B.pH':    mk('T', CW12_SLOTS),
    'CW2_B.Alk':   mk('U', CW12_SLOTS),
    'CW2.Turb':    mk('V', CW12_SLOTS),
    'CW2.OC':      mk('W', CW12_SLOTS),
    'CW2.ResCl2':  mk('X', CW12_SLOTS),
    'FW2.Turb':    mk('Y', CW12_SLOTS),
    'FW2.OC':      mk('Z', CW12_SLOTS),
    'FW2.ResCl2':  mk('AA', CW12_SLOTS),

    # CW Phase 3
    'CW3_A.Turb':  mk('C', CW34_SLOTS),
    'CW3_A.pH':    mk('D', CW34_SLOTS),
    'CW3_A.Alk':   mk('E', CW34_SLOTS),
    'CW3_B.Turb':  mk('F', CW34_SLOTS),
    'CW3_B.pH':    mk('G', CW34_SLOTS),
    'CW3_B.Alk':   mk('H', CW34_SLOTS),
    'CW3.Turb':    mk('I', CW34_SLOTS),
    'CW3.OC':      mk('J', CW34_SLOTS),
    'CW3.ResCl2':  mk('K', CW34_SLOTS),
    'FW3.Turb':    mk('L', CW34_SLOTS),
    'FW3.OC':      mk('M', CW34_SLOTS),
    'FW3.ResCl2':  mk('N', CW34_SLOTS),

    # CW Phase 4
    'CW4_A.Turb':  mk('P', CW34_SLOTS),
    'CW4_A.pH':    mk('Q', CW34_SLOTS),
    'CW4_A.Alk':   mk('R', CW34_SLOTS),
    'CW4_B.Turb':  mk('S', CW34_SLOTS),
    'CW4_B.pH':    mk('T', CW34_SLOTS),
    'CW4_B.Alk':   mk('U', CW34_SLOTS),
    'CW4.Turb':    mk('V', CW34_SLOTS),
    'CW4.OC':      mk('W', CW34_SLOTS),
    'CW4.ResCl2':  mk('X', CW34_SLOTS),
    'FW4.Turb':    mk('Y', CW34_SLOTS),
    'FW4.OC':      mk('Z', CW34_SLOTS),
    'FW4.ResCl2':  mk('AA', CW34_SLOTS),

    # TW1
    'TW1.Turb':     mk('C', TW_SLOTS),
    'TW1.pH':       mk('D', TW_SLOTS),
    'TW1.ResCl2':   mk('E', TW_SLOTS),
    'TW1.Conduct':  mk4('F', TW_SLOTS),
    'TW1.OC':       mk4('G', TW_SLOTS),
    'TW1.Alk':      mk4('H', TW_SLOTS),
    'TW1.Hardness': mk4('I', TW_SLOTS),
    'TW1.Langelier':mk4('J', TW_SLOTS),
    'TW1.Color':    mk4('K', TW_SLOTS),

    # TW2
    'TW2.Turb':     mk('L', TW_SLOTS),
    'TW2.pH':       mk('M', TW_SLOTS),
    'TW2.ResCl2':   mk('N', TW_SLOTS),
    'TW2.Conduct':  mk4('O', TW_SLOTS),
    'TW2.OC':       mk4('P', TW_SLOTS),
    'TW2.Alk':      mk4('Q', TW_SLOTS),
    'TW2.Hardness': mk4('R', TW_SLOTS),
    'TW2.Langelier':mk4('S', TW_SLOTS),
    'TW2.Color':    mk4('T', TW_SLOTS),

    # TW3
    'TW3.Turb':   mk('V', TW_SLOTS),
    'TW3.pH':     mk('W', TW_SLOTS),
    'TW3.ResCl2': mk('X', TW_SLOTS),

    # TW4
    'TW4.Turb':   mk('Y', TW_SLOTS),
    'TW4.pH':     mk('Z', TW_SLOTS),
    'TW4.ResCl2': mk('AA', TW_SLOTS),

    # Chemical (daily)
    'Chem.RW.Al':  daily('H77'),
    'Chem.RW.Fe':  daily('I77'),
    'Chem.RW.Mn':  daily('J77'),
    'Chem.RW.Cl':  daily('K77'),
    'Chem.TW1.Al': daily('H78'),
    'Chem.TW1.Fe': daily('I78'),
    'Chem.TW1.Mn': daily('J78'),
    'Chem.TW1.Cl': daily('K78'),
    'Chem.TW2.Al': daily('H79'),
    'Chem.TW2.Fe': daily('I79'),
    'Chem.TW2.Mn': daily('J79'),
    'Chem.TW2.Cl': daily('K79'),

    # Algae (daily)
    'Algae.RW.Total':       daily('Q19'),
    'Algae.CW1.Total':      daily('R19'),
    'Algae.CW2.Total':      daily('S19'),
    'Algae.CW3.Total':      daily('T19'),
    'Algae.CW4.Total':      daily('U19'),
    'Algae.TW1.Total':      daily('V19'),
    'Algae.TW2.Total':      daily('W19'),
    'Algae.RW.ClogFilter':  daily('Q20'),
    'Algae.CW1.ClogFilter': daily('R20'),
    'Algae.CW2.ClogFilter': daily('S20'),
    'Algae.CW3.ClogFilter': daily('T20'),
    'Algae.CW4.ClogFilter': daily('U20'),
    'Algae.TW1.ClogFilter': daily('V20'),
    'Algae.TW2.ClogFilter': daily('W20'),

    # Bacteria (daily)
    'Bacteria.TW1.Coliform': daily('Z19'),
    'Bacteria.TW2.Coliform': daily('AA19'),
    'Bacteria.TW1.EColi':    daily('Z20'),
    'Bacteria.TW2.EColi':    daily('AA20'),
}

with open('server/config/excel_cell_map.json', 'w', encoding='utf-8') as f:
    json.dump(cell_map, f, ensure_ascii=False, indent=2)

total = sum(len(v) for v in cell_map.values())
print(f'Done: {len(cell_map)} params, {total} cell mappings')
