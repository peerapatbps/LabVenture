"""
ทดสอบการเขียน Excel แบบ standalone สำหรับวันที่ 2026-07-01
flow:
  1. ดึง records จาก labventure.db
  2. เรียก write_records() โดยตรง (ไม่ผ่าน server)
  3. แสดงสรุปจำนวน cell ที่เขียนได้

วิธีใช้:  python test_excel_write.py [--date YYYY-MM-DD]
"""
import sys, sqlite3, json, argparse

# ให้ import excel_writer จาก directory เดียวกัน
sys.path.insert(0, '.')
import excel_writer as ew

DB_PATH = './labventure.db'

def load_records(date_str):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        'SELECT param_key, trans_time, trans_value FROM node_records WHERE trans_dtm = ? ORDER BY trans_time, param_key',
        (date_str,)
    ).fetchall()
    conn.close()
    return [{'param_key': r[0], 'trans_dtm': date_str, 'trans_time': r[1], 'trans_value': r[2]} for r in rows]

def load_recorders(date_str):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        'SELECT shift_range, recorder_name, position_label FROM slot_recorders WHERE trans_dtm = ?',
        (date_str,)
    ).fetchall()
    conn.close()
    result = {}
    for shift, name, pos in rows:
        result[shift] = {'name': name, 'position_label': pos}
    return {date_str: result}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', default='2026-07-01')
    args = parser.parse_args()

    date_str = args.date
    print(f'[test] date = {date_str}')

    records = load_records(date_str)
    print(f'[test] loaded {len(records)} records from DB')

    # แสดง breakdown ตาม slot
    from collections import Counter
    slots = Counter(r['trans_time'] for r in records)
    for slot, cnt in sorted(slots.items()):
        print(f'  slot {slot:8s}: {cnt} records')

    recorders = load_recorders(date_str)
    if recorders.get(date_str):
        print(f'[test] recorders: {list(recorders[date_str].keys())}')
    else:
        print('[test] no recorder info found')

    print()
    print('[test] running excel_writer.write_records()...')
    written = ew.write_records(records, recorders)
    print(f'[test] DONE — written {written} cells to Excel')

    # แสดง path ที่เขียน
    local_path = ew.local_monthly_path(date_str)
    push_path  = ew.push_monthly_path(date_str)
    print(f'[test] local  : {local_path}')
    if push_path:
        import os
        exists = os.path.exists(push_path)
        print(f'[test] push   : {push_path}  (exists={exists})')

if __name__ == '__main__':
    main()
