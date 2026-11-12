/**
 * MasterSheet – Tasks.gs
 * Task manager: CRUD, status changes, Today / Upcoming / Overdue / Completed views.
 */
function taskNormalize_(p) {
  const start = clean_(p.startDate, 10, 'Start date'), due = clean_(p.dueDate, 10, 'Due date');
  if (start && !isDate_(start)) throw bad_('Start date is not a valid date.');
  if (due && !isDate_(due)) throw bad_('Due date is not a valid date.');
  if (start && due && due < start) throw bad_('Due date cannot be before the start date.');
  return {
    'Task Name': clean_(p.taskName, 200, 'Task name', true),
    'Description': clean_(p.description, 2000, 'Description'),
    'Category': clean_(p.category, 60, 'Category') || 'Other',
    'Priority': canon_(p.priority || 'Medium', LISTS.PRIORITY, 'priority'),
    'Start Date': start, 'Due Date': due,
    'Status': canon_(p.status || 'To Do', LISTS.TASK_STATUS, 'status')
  };
}

function taskOut_(r, today) {
  const o = out_('TASKS', r);
  o.overdue = r.Status !== 'Completed' && !!r['Due Date'] && r['Due Date'] < today;
  return o;
}

function tasksList_(p) {
  const today = today_(), all = readTable_('TASKS').rows;
  const open = function (t) { return t.Status !== 'Completed'; };
  const isToday = function (t) { const s = t['Start Date'], d = t['Due Date']; return open(t) && (d === today || (s && s <= today && (!d || d >= today))); };
  const isUpcoming = function (t) { return open(t) && ((t['Due Date'] && t['Due Date'] > today) || (!t['Due Date'] && t['Start Date'] > today)) && !isToday(t); };
  const isOverdue = function (t) { return open(t) && t['Due Date'] && t['Due Date'] < today; };
  const counts = {
    all: all.length, today: all.filter(isToday).length, upcoming: all.filter(isUpcoming).length,
    overdue: all.filter(isOverdue).length, completed: all.filter(function (t) { return t.Status === 'Completed'; }).length
  };
  let rows = all;
  const v = p.view || 'all';
  if (v === 'today') rows = rows.filter(isToday);
  else if (v === 'upcoming') rows = rows.filter(isUpcoming);
  else if (v === 'overdue') rows = rows.filter(isOverdue);
  else if (v === 'completed') rows = rows.filter(function (t) { return t.Status === 'Completed'; });
  const q = String(p.q || '').toLowerCase().trim();
  if (q) rows = rows.filter(function (t) { return (t['Task Name'] + ' ' + t.Description + ' ' + t.Category).toLowerCase().indexOf(q) >= 0; });
  if (p.priority) rows = rows.filter(function (t) { return t.Priority === p.priority; });
  if (p.category) rows = rows.filter(function (t) { return t.Category === p.category; });
  if (p.status) rows = rows.filter(function (t) { return t.Status === p.status; });
  rows.sort(function (a, b) {
    const ca = a.Status === 'Completed', cb = b.Status === 'Completed';
    if (ca !== cb) return ca ? 1 : -1;
    if (ca) return cmp_(b['Completed At'], a['Completed At']);
    return cmp_(a['Due Date'], b['Due Date']) || ((PRIORITY_RANK[a.Priority] || 0) - (PRIORITY_RANK[b.Priority] || 0));
  });
  return { tasks: rows.map(function (t) { return taskOut_(t, today); }), counts: counts, today: today };
}

function tasksAdd_(p) {
  const rec = taskNormalize_(p);
  return withLock_(function () {
    const keys = onceGuard_(p.requestId, [rec['Task Name'], rec['Due Date'], rec.Category].join('|'));
    try {
      ensureCategory_(rec.Category);
      const ts = now_();
      rec['Task ID'] = newId_('TSK'); rec['Created At'] = ts; rec['Updated At'] = ts;
      rec['Completed At'] = rec.Status === 'Completed' ? ts : '';
      appendRows_('TASKS', [rec]);
      audit_('Tasks', 'Create', rec['Task ID'], null, rec);
      activity_('Tasks', 'Created task "' + rec['Task Name'] + '"');
      bump_();
      return taskOut_(rec, today_());
    } catch (e) { onceRelease_(keys); throw e; }
  });
}

function tasksUpdate_(p) {
  const rec = taskNormalize_(p);
  return withLock_(function () {
    const row = findRow_('TASKS', p.id);
    if (!row) throw bad_('Task not found - it may have been deleted.');
    const before = readRow_('TASKS', row);
    ensureCategory_(rec.Category);
    const ts = now_();
    rec['Updated At'] = ts;
    rec['Completed At'] = rec.Status === 'Completed' ? (before['Completed At'] || ts) : '';
    updateRow_('TASKS', row, rec);
    const after = readRow_('TASKS', row);
    audit_('Tasks', 'Update', p.id, before, after);
    activity_('Tasks', 'Edited task "' + rec['Task Name'] + '"');
    bump_();
    return taskOut_(after, today_());
  });
}

function tasksStatus_(p) {
  const status = canon_(p.status, LISTS.TASK_STATUS, 'status');
  return withLock_(function () {
    const row = findRow_('TASKS', p.id);
    if (!row) throw bad_('Task not found - it may have been deleted.');
    const before = readRow_('TASKS', row), ts = now_();
    updateRow_('TASKS', row, { 'Status': status, 'Completed At': status === 'Completed' ? (before['Completed At'] || ts) : '', 'Updated At': ts });
    const after = readRow_('TASKS', row);
    audit_('Tasks', status === 'Completed' ? 'Complete' : 'Status', p.id, before, after);
    activity_('Tasks', (status === 'Completed' ? 'Completed' : 'Moved to ' + status + ':') + ' "' + after['Task Name'] + '"');
    bump_();
    return taskOut_(after, today_());
  });
}

function tasksDelete_(p) {
  if (p.confirm !== true) throw bad_('Deletion must be confirmed.');
  return withLock_(function () {
    const gone = deleteByIds_('TASKS', [p.id]);
    if (!gone.length) throw bad_('Task not found - it may already be deleted.');
    auditMany_('Tasks', 'Delete', gone);
    activity_('Tasks', 'Deleted task "' + gone[0]['Task Name'] + '"');
    bump_();
    return { deleted: 1 };
  });
}
