/**
 * MasterSheet – Tests.gs
 * Run runSelfTests() from the Apps Script editor (Run > runSelfTests). View results in Execution log.
 * Creates temporary rows, verifies behaviour, and removes them again.
 * runSelfTests(true) also creates (and keeps) one backup in Drive.
 * Browser-only checks (blocked access, 320px layout) are in the README testing checklist.
 */
function runSelfTests(withBackup) {
  assertOwner_({});
  const R = [];
  const T = function (name, fn) {
    try { fn(); R.push('PASS  ' + name); } catch (e) { R.push('FAIL  ' + name + '  ->  ' + (e && e.message ? e.message : e)); }
  };
  const must = function (c, m) { if (!c) throw new Error(m || 'assertion failed'); };
  const mustFail = function (fn, m) { let failed = false; try { fn(); } catch (e) { failed = true; } must(failed, m); };
  const made = { SHEET_LIBRARY: [], MASTER_DATA: [], TASKS: [], NOTES: [], REMINDERS: [] };
  const url = 'https://docs.google.com/spreadsheets/d/SELFTEST' + Utilities.getUuid().replace(/-/g, '') + '/edit';
  const rid = 'selftest-' + Utilities.getUuid();
  let sheet, rec, task, note, rem;

  T('Setup tabs exist with headers', function () {
    Object.keys(SCHEMA).forEach(function (n) {
      const h = headersOf_(sheet_(n));
      SCHEMA[n].forEach(function (c) { must(h.indexOf(c[0]) >= 0, n + ' missing header ' + c[0]); });
    });
  });
  T('Add sheet link', function () { sheet = libraryAdd_({ name: 'SelfTest Sheet', url: url, category: 'Other' }); made.SHEET_LIBRARY.push(sheet.id); must(sheet.id); });
  T('Reject duplicate sheet link', function () { mustFail(function () { libraryAdd_({ name: 'Dup', url: url }); }, 'duplicate accepted'); });
  T('Reject invalid sheet URL', function () { mustFail(function () { libraryAdd_({ name: 'Bad', url: 'https://example.com/x' }); }, 'bad URL accepted'); });
  T('Edit sheet link', function () { const u = libraryUpdate_({ id: sheet.id, name: 'SelfTest Renamed', url: url, category: 'Other', priority: 'High' }); must(u.name === 'SelfTest Renamed' && u.priority === 'High'); });
  T('Add data record', function () { rec = dataAdd_({ title: 'SelfTest record', category: 'Other', valueAmount: 12.5, requestId: rid }); made.MASTER_DATA.push(rec.id); must(rec.id && rec.valueAmount === 12.5); });
  T('Prevent duplicate submission', function () { mustFail(function () { dataAdd_({ title: 'SelfTest record', category: 'Other', valueAmount: 12.5, requestId: rid }); }, 'duplicate accepted'); });
  T('Formula injection is neutralised', function () {
    const x = dataAdd_({ title: '=HYPERLINK("http://x")', category: 'Other', requestId: 'selftest-' + Utilities.getUuid() });
    made.MASTER_DATA.push(x.id);
    must(x.title === '=HYPERLINK("http://x")', 'value not round-tripped');
    must(String(sheet_('MASTER_DATA').getRange(findRow_('MASTER_DATA', x.id), 4).getFormula()) === '', 'cell became a formula');
  });
  T('Update record', function () { const u = dataUpdate_({ id: rec.id, title: 'SelfTest edited', category: 'Other', status: 'Pending' }); must(u.title === 'SelfTest edited' && u.status === 'Pending'); });
  T('Analytics reflects data', function () { const a = analyticsGet_({ range: '7d', force: true }); must(a.summary.recordsInRange >= 1, 'record missing from analytics'); });
  T('Analytics filter by status', function () { const a = analyticsGet_({ range: '7d', status: 'Pending', force: true }); must(a.summary.recordsInRange >= 1); });
  T('Dashboard KPIs from real data', function () { const d = dashboardGet_({ days: 7, force: true }); must(d.kpis.totalRecords >= 1 && d.kpis.totalSheets >= 1); });
  T('Add and complete task', function () {
    task = tasksAdd_({ taskName: 'SelfTest task', category: 'Other', dueDate: addDays_(today_(), -1), requestId: 'selftest-' + Utilities.getUuid() });
    made.TASKS.push(task.id);
    must(tasksList_({ view: 'overdue' }).tasks.some(function (t) { return t.id === task.id; }), 'not in overdue view');
    const c = tasksStatus_({ id: task.id, status: 'Completed' });
    must(c.status === 'Completed' && c.completedAt, 'completedAt missing');
  });
  T('Save and edit note', function () {
    note = notesAdd_({ title: 'SelfTest note', content: 'hello <b>x</b>', category: 'Other', requestId: 'selftest-' + Utilities.getUuid() });
    made.NOTES.push(note.id);
    const u = notesUpdate_({ id: note.id, title: 'SelfTest note 2', content: 'changed', category: 'Other' });
    must(u.title === 'SelfTest note 2');
  });
  T('Reminder fires once (no duplicate delivery)', function () {
    rem = remindersAdd_({ reminderTitle: 'SelfTest reminder', reminderDate: addDays_(today_(), -1), reminderTime: '08:00', repeatRule: 'None', notificationChannel: 'In-App', requestId: 'selftest-' + Utilities.getUuid() });
    made.REMINDERS.push(rem.id);
    processReminders_();
    const a = readRow_('REMINDERS', findRow_('REMINDERS', rem.id));
    must(a.Status === 'Sent' && a['Last Sent At'], 'reminder not marked sent');
    processReminders_();
    const b = readRow_('REMINDERS', findRow_('REMINDERS', rem.id));
    must(b['Last Sent At'] === a['Last Sent At'], 'reminder delivered twice');
  });
  T('Recurring reminder advances date', function () {
    const r = remindersAdd_({ reminderTitle: 'SelfTest daily', reminderDate: addDays_(today_(), -2), reminderTime: '08:00', repeatRule: 'Daily', notificationChannel: 'In-App', requestId: 'selftest-' + Utilities.getUuid() });
    made.REMINDERS.push(r.id);
    processReminders_();
    const a = readRow_('REMINDERS', findRow_('REMINDERS', r.id));
    must(a.Status === 'Active' && (a['Reminder Date'] + ' ' + a['Reminder Time']) > nowMin_(), 'date not advanced');
  });
  T('Delete requires confirmation', function () { mustFail(function () { dataDelete_({ ids: [rec.id] }); }, 'deleted without confirm'); });
  T('Delete record + audit history kept', function () {
    const r = dataDelete_({ ids: [rec.id], confirm: true });
    must(r.deleted === 1);
    must(tail_('AUDIT_LOG', 50).some(function (a) { return a['Record ID'] === rec.id && a.Action === 'Delete'; }), 'no audit row');
  });
  T('CSV import validates rows', function () {
    const r = dataImport_({ rows: [{ title: 'SelfTest csv ok', category: 'Other' }, { title: '', category: 'Other' }] });
    must(r.imported === 1 && r.failed === 1, 'unexpected import result');
    const found = readTable_('MASTER_DATA').rows.filter(function (x) { return x.Title === 'SelfTest csv ok'; });
    found.forEach(function (x) { made.MASTER_DATA.push(x['Record ID']); });
  });
  T('Empty-range analytics does not fail', function () { const a = analyticsGet_({ range: 'custom', from: '2000-01-01', to: '2000-01-07', force: true }); must(a.summary.recordsInRange === 0); });
  if (withBackup) T('Backup created in Drive', function () { const b = withLock_(function () { return createBackup_('Manual'); }); must(b['File ID']); });

  // cleanup
  withLock_(function () { Object.keys(made).forEach(function (tab) { if (made[tab].length) deleteByIds_(tab, made[tab]); }); bump_(); });
  const text = R.join('\n') + '\n\n' + R.filter(function (x) { return x.indexOf('PASS') === 0; }).length + '/' + R.length + ' passed.';
  Logger.log(text);
  return text;
}
