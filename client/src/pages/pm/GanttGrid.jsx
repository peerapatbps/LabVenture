import React, { useMemo } from 'react';
import { STATUS, thMonth, thMonthYear, beYear, recText } from './util.js';

// Plan table in the shape of the Excel plan: ลำดับ | รายละเอียด | 12 months of the FY | forecast years.
// Rows come pre-expanded from GET /api/pm/plans/:id/gantt; this component only draws.

function Chip({ occ, onClick }) {
  if (occ.ghost) {
    return (
      <button type="button" onClick={onClick} title={`เลื่อนไป ${thMonthYear(occ.planned_month)}`}
        className="w-full rounded border border-dashed border-sky-500 text-sky-700 text-[11px] leading-5 hover:bg-sky-50">
        → {thMonthYear(occ.planned_month)}
      </button>
    );
  }
  const st = STATUS[occ.derived] || STATUS.planned;
  const tip = [`${occ.label} · ${st.label}`, occ.moved && `เดิม ${thMonthYear(occ.due_month)}`,
    occ.actual_end && `ทำจริง ${occ.actual_end}`, occ.files && `ไฟล์หลักฐาน ${occ.files}`, occ.done_by && `โดย ${occ.done_by}`, occ.remark].filter(Boolean).join('\n');
  return (
    <button type="button" onClick={onClick} title={tip}
      className={`w-full rounded text-xs font-semibold leading-5 shadow-sm hover:brightness-110 ${st.chip}`}>
      {occ.derived === 'done' && '✓ '}{occ.label}{occ.moved && ' ↺'}{occ.files > 0 && ' 📎'}{occ.remark && ' •'}
    </button>
  );
}

function ForecastChip({ occ, onClick }) {
  return (
    <button type="button" onClick={onClick} title={`${occ.label} · ${thMonthYear(occ.planned_month)}`}
      className={`w-full rounded text-xs font-semibold leading-5 ${occ.status === 'planned' ? 'bg-sky-200 text-sky-900' : (STATUS[occ.derived]?.chip || '')}`}>
      {occ.label}
    </button>
  );
}

export default function GanttGrid({ data, editing, collapsed, onToggle, search, showAllForecast, onCell, onEditTask, onAddChild, onMove, onDelete }) {
  const { months, forecastYears, rows, today } = data;

  // visible rows: skip descendants of collapsed rows; with a search, keep matches + their ancestors
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = new Set();
    if (q) {
      const stack = [];
      rows.forEach((r, i) => {
        stack.length = r.depth;
        stack.push(i);
        if (`${r.task.wbs || ''} ${r.task.title}`.toLowerCase().includes(q)) stack.forEach(j => match.add(j));
      });
    }
    const out = [];
    let hideBelow = Infinity;
    rows.forEach((r, i) => {
      if (r.depth > hideBelow) return;
      hideBelow = Infinity;
      if (q && !match.has(i)) return;
      out.push({ ...r, hasKids: rows[i + 1]?.depth > r.depth });
      if (!q && collapsed.has(r.task.id)) hideBelow = r.depth;
    });
    return out;
  }, [rows, collapsed, search]);

  // header row 1: calendar-year (พ.ศ.) spans over the months, like the Excel sheet
  const yearSpans = [];
  for (const ym of months) {
    const y = beYear(ym);
    if (yearSpans.at(-1)?.y === y) yearSpans.at(-1).n++;
    else yearSpans.push({ y, n: 1 });
  }

  const th = 'border border-earth-border px-1 py-1.5 font-semibold text-earth-ink text-center';
  const td = 'border border-earth-border px-1 py-1 align-middle';
  const sticky0 = 'sticky left-0 z-10';
  const sticky1 = 'sticky left-[56px] z-10';

  return (
    <div className="overflow-auto max-h-[calc(100vh-260px)] rounded-xl border border-earth-border bg-white/40">
      <table className="border-collapse text-sm min-w-max">
        <thead className="sticky top-0 z-20 bg-earth-card">
          <tr>
            <th rowSpan={2} className={`${th} ${sticky0} bg-earth-card w-[56px] min-w-[56px]`}>ลำดับ</th>
            <th rowSpan={2} className={`${th} ${sticky1} bg-earth-card min-w-[170px] sm:min-w-[400px]`}>รายละเอียด</th>
            {yearSpans.map(s => <th key={s.y} colSpan={s.n} className={th}>ปี พ.ศ. {s.y}</th>)}
            {forecastYears.length > 0 && (
              <th colSpan={forecastYears.length} className={`${th} bg-sky-50`}>คาดการณ์ {showAllForecast ? '' : 'แผน >1Y'}</th>
            )}
          </tr>
          <tr>
            {months.map(ym => (
              <th key={ym} className={`${th} min-w-[56px] text-xs ${ym === today ? 'bg-amber-200' : ''}`}>{thMonth(ym)}</th>
            ))}
            {forecastYears.map(y => <th key={y} className={`${th} min-w-[48px] text-xs bg-sky-50`}>ปี{String(y).slice(2)}</th>)}
          </tr>
        </thead>
        <tbody>
          {visible.map(({ task, depth, cells, forecast, hasKids }) => {
            const group = task.kind === 'group';
            const rowBg = group ? 'bg-earth-card' : 'bg-earth';
            return (
              <tr key={task.id} className={`${rowBg} hover:bg-amber-50/70 group`}>
                <td className={`${td} ${sticky0} ${rowBg} text-center text-xs text-earth-ink2`}>{task.wbs || ''}</td>
                <td className={`${td} ${sticky1} ${rowBg}`}>
                  <div className="flex items-center gap-1 w-[170px] sm:w-[400px]" style={{ paddingLeft: depth * 16 }}>
                    {hasKids ? (
                      <button type="button" onClick={() => onToggle(task.id)} className="w-4 text-earth-ink3 hover:text-earth-ink shrink-0"
                        aria-label={collapsed.has(task.id) ? 'ขยาย' : 'ยุบ'}>{collapsed.has(task.id) ? '▸' : '▾'}</button>
                    ) : <span className="w-4 shrink-0" />}
                    <span className={`flex-1 min-w-0 truncate ${group ? 'font-bold text-earth-ink' : 'text-earth-ink'}`}
                      title={[task.title, task.recurrence && recText(task.recurrence), task.owner && `ผู้รับผิดชอบ: ${task.owner}`, task.note].filter(Boolean).join('\n')}>
                      {!group && depth > 0 && !task.wbs ? '- ' : ''}{task.title}
                      {task.qty ? <span className="text-earth-ink2"> จำนวน {task.qty} {task.unit || 'รายการ'}</span> : null}
                    </span>
                    {editing && (
                      <span className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100">
                        <IconBtn title="ขึ้น" wide onClick={() => onMove(task, 'up')}>↑</IconBtn>
                        <IconBtn title="ลง" wide onClick={() => onMove(task, 'down')}>↓</IconBtn>
                        <IconBtn title="แก้ไข" onClick={() => onEditTask(task)}>✎</IconBtn>
                        <IconBtn title="เพิ่มรายการย่อย" wide onClick={() => onAddChild(task)}>＋</IconBtn>
                        <IconBtn title="ลบ" danger wide onClick={() => onDelete(task)}>🗑</IconBtn>
                      </span>
                    )}
                  </div>
                </td>
                {months.map(ym => (
                  <td key={ym} className={`${td} ${ym === today ? 'bg-amber-100/60' : ''}`}>
                    <div className="flex flex-col gap-0.5">
                      {(cells[ym] || []).map((o, i) => (
                        <Chip key={i} occ={o} onClick={() => onCell(task, o.ghost ? findReal(cells, o) || o : o)} />
                      ))}
                    </div>
                  </td>
                ))}
                {forecastYears.map(y => {
                  const list = (forecast[y] || []).filter(() => showAllForecast || (task.recurrence?.every ?? 0) > 12 || task.recurrence?.every === 0);
                  return (
                    <td key={y} className={`${td} bg-sky-50/40`}>
                      <div className="flex flex-col gap-0.5">
                        {list.map((o, i) => <ForecastChip key={i} occ={o} onClick={() => onCell(task, o)} />)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// a ghost points at the moved occurrence; open that one (it may sit in another visible month)
function findReal(cells, ghost) {
  return (cells[ghost.planned_month] || []).find(o => !o.ghost && o.due_month === ghost.due_month);
}

// wide-only actions hide on phones so the title keeps some room; ✎ stays
function IconBtn({ children, title, onClick, danger, wide }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={`${wide ? 'hidden sm:inline-block' : ''} w-6 h-6 rounded text-xs leading-6 ${danger ? 'hover:bg-red-100' : 'hover:bg-earth-border'} text-earth-ink2`}>
      {children}
    </button>
  );
}
