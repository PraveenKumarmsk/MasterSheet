/**
 * MasterSheet – Automation.gs
 * Time-driven triggers, scheduled jobs, backups/restore and the admin panel endpoints.
 * Trigger timing is approximate (Google may delay a run by a few minutes).
 */
const TRIGGER_HANDLERS_ = ['triggerReminders', 'triggerHourly', 'triggerDaily'];

/* ---------------- trigger install / handlers ---------------- */
function installTriggers() { assertOwner_({}); return installTriggersCore_(); }
function removeTriggers() { assertOwner_({}); return removeTriggersCore_(); }

function removeTriggersCore_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_HANDLERS_.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Removed ' + n + ' trigger(s).';
}
function installTriggersCore_() {
  removeTriggersCore_();
  ScriptApp.newTrigger('triggerReminders').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('triggerHourly').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('triggerDaily').timeBased().atHour(2).everyDays(1).create();
  try { activity_('Automation', 'Installed automation triggers'); } catch (e) { /* ignore */ }
  return 'Installed 3 triggers: reminders (~5 min), hourly jobs, daily jobs (~2 AM).';
}

function triggerReminders() { assertOwner_({}); runJob_('Reminders', 'JOB_REMINDERS', processReminders_, false); }
function triggerHourly() {
  assertOwner_({});
  runJob_('Overdue Detection', 'JOB_OVERDUE', detectOverdue_, false);
  runJob_('Dashboard Summary', 'JOB_SUMMARY', refreshSummary_, false);
}
function triggerDaily() {
  assertOwner_({});
  runJob_('Scheduled Backup', 'JOB_BACKUP', scheduledBackup_, false);
  runJob_('Log Cleanup', 'JOB_LOG_CLEANUP', cleanupLogs_, false);
}

/** Runs one job, logs result/time/errors. A job returning null had nothing to do and is not logged. */
function runJob_(job, settingKey, fn, force) {
  if (!force && settingKey && !boolSetting_(settingKey)) return { skipped: true, message: 'Job is disabled in Automation Settings.' };
  const t0 = Date.now();
  try {
    const msg = fn();
    if (msg === null || msg === undefined) return { ok: true, message: 'Nothing to do.' };
    logAutomation_(job, 'Success', Date.now() - t0, msg);
    return { ok: true, message: msg };
  } catch (e) {
    try { logAutomation_(job, 'Error', Date.now() - t0, e.message || e); } catch (e2) { /* ignore */ }
    return { ok: false, message: String(e.message || e) };
  }
}

/* ---------------- jobs ---------------- */
function detectOverdue_() {
  const today = today_();
  const over = readTable_('TASKS').rows.filter(function (t) { return t.Status !== 'Completed' && t['Due Date'] && t['Due Date'] < today; });
  PropertiesService.getScriptProperties().setProperty('OVERDUE_COUNT', String(over.length));
  let extra = '';
  const props = PropertiesService.getScriptProperties();
  if (over.length && boolSetting_('OVERDUE_DIGEST_EMAIL') && props.getProperty('DIGEST_DATE') !== today) {
    const items = over.slice(0, 25).map(function (t) { return '<li>' + escHtml_(t['Task Name']) + ' - due ' + escHtml_(t['Due Date']) + '</li>'; }).join('');
    MailApp.sendEmail({ to: reminderRecipient_(), subject: 'MasterSheet: ' + over.length + ' overdue task(s)', htmlBody: '<p>Overdue tasks:</p><ul>' + items + '</ul>', name: 'MasterSheet' });
    props.setProperty('DIGEST_DATE', today);
    extra = ' Digest e-mail sent.';
  }
  return over.length + ' overdue task(s) found.' + extra;
}

function refreshSummary_() {
  bump_();
  cput_('dash:30', buildDashboard_(30), 3300);
  return null;
}

function cleanupLogs_() {
  const cutoff = Utilities.formatDate(new Date(Date.now() - numSetting_('LOG_RETENTION_DAYS', 180) * 86400000), tz_(), 'yyyy-MM-dd HH:mm:ss');
  let removed = 0;
  ['ACTIVITY_LOG', 'AUTOMATION_LOG'].forEach(function (name) {
    withLock_(function () {
      const sh = sheet_(name), lr = sh.getLastRow();
      if (lr < 2) return;
      const idx = headersOf_(sh).indexOf('Timestamp') + 1;
      const ts = sh.getRange(2, idx, lr - 1, 1).getValues();
      let k = 0;
      while (k < ts.length && String(norm_(ts[k][0], 'datetime')) < cutoff) k++;
      if (k > 0) {
        if (sh.getMaxRows() - lr < 2) sh.insertRowsAfter(sh.getMaxRows(), 5);
        sh.deleteRows(2, k); removed += k;
      }
    });
  });
  return removed ? 'Removed ' + removed + ' old log row(s).' : null;
}

function scheduledBackup_() {
  const last = tail_('BACKUP_LOG', 200).reverse().filter(function (b) { return b.Status === 'OK'; })[0];
  if (last) {
    const days = (Date.now() - new Date(String(last.Timestamp).replace(' ', 'T')).getTime()) / 86400000;
    if (days < numSetting_('BACKUP_EVERY_DAYS', 7) - 0.1) return null;
  }
  const b = withLock_(function () { return createBackup_('Scheduled'); });
  return 'Backup created: ' + b['File Name'];
}

/* ---------------- backups ---------------- */
function backupFolder_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('BACKUP_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  const f2 = DriveApp.createFolder(APP.BACKUP_FOLDER);
  p.setProperty('BACKUP_FOLDER_ID', f2.getId());
  return f2;
}

function createBackup_(type) {
  const stamp = Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmmss');
  const name = 'MasterSheet_Backup_' + stamp;
  let entry;
  try {
    const file = DriveApp.getFileById(ss_().getId()).makeCopy(name, backupFolder_());
    entry = logBackup_({ 'Type': type, 'File Name': name, 'File ID': file.getId(), 'File URL': file.getUrl(), 'Status': 'OK', 'Message': 'Full copy of the database spreadsheet' });
  } catch (e) {
    logBackup_({ 'Type': type, 'File Name': name, 'File ID': '', 'File URL': '', 'Status': 'Failed', 'Message': String(e.message || e).slice(0, 500) });
    throw new Error('Backup failed: ' + (e.message || e));
  }
  pruneBackups_();
  activity_('Backup', type + ' backup created');
  return entry;
}

function pruneBackups_() {
  const keep = numSetting_('BACKUP_RETENTION', 10);
  const rows = readTable_('BACKUP_LOG').rows.filter(function (b) { return b.Status === 'OK'; })
    .sort(function (a, b) { return cmp_(b.Timestamp, a.Timestamp); });
  rows.slice(keep).forEach(function (b) {
    try { DriveApp.getFileById(b['File ID']).setTrashed(true); } catch (e) { /* already gone */ }
    updateRow_('BACKUP_LOG', b._row, { 'Status': 'Pruned', 'Message': 'Moved to Drive trash (retention limit)' });
  });
}

function restoreBackup_(backupId, confirm) {
  if (confirm !== 'RESTORE') throw bad_('Type RESTORE to confirm.');
  const row = findRow_('BACKUP_LOG', backupId);
  if (!row) throw bad_('Backup record not found.');
  const b = readRow_('BACKUP_LOG', row);
  if (b.Status !== 'OK' || !b['File ID']) throw bad_('This backup is not available (status: ' + b.Status + ').');
  let src;
  try { src = SpreadsheetApp.openById(b['File ID']); } catch (e) { throw bad_('The backup file cannot be opened (it may have been deleted from Drive).'); }
  createBackup_('Pre-restore');                       // safety copy of the current state
  const summary = [];
  RESTORE_TABS.forEach(function (name) {
    const s = src.getSheetByName(name);
    if (!s) return;
    const dest = sheet_(name), dh = headersOf_(dest), sh = headersOf_(s);
    if (dest.getLastRow() > 1) dest.getRange(2, 1, dest.getLastRow() - 1, dh.length).clearContent();
    const sl = s.getLastRow();
    if (sl < 2) { summary.push(name + ': 0'); return; }
    const vals = s.getRange(2, 1, sl - 1, sh.length).getValues();
    const map = dh.map(function (h) { return sh.indexOf(h); });
    const rows = vals.map(function (v) { return map.map(function (i) { return i < 0 ? '' : v[i]; }); })
      .filter(function (r) { return String(r[dh.indexOf(ID_COL[name])]) !== ''; });
    if (rows.length) {
      if (rows.length + 1 > dest.getMaxRows()) dest.insertRowsAfter(dest.getMaxRows(), rows.length + 200);
      dest.getRange(2, 1, rows.length, dh.length).setValues(rows);
    }
    summary.push(name + ': ' + rows.length);
  });
  audit_('Backup', 'Restore', backupId, null, { from: b['File Name'], tabs: summary });
  activity_('Backup', 'Restored from ' + b['File Name']);
  bump_();
  return 'Restored ' + b['File Name'] + ' (' + summary.join(', ') + ').';
}

/* ---------------- admin endpoints ---------------- */
const ADMIN_TABS_ = {
  sheets: { tab: 'SHEET_LIBRARY', cols: ['name', 'category', 'priority', 'favorite', 'lastUpdated'] },
  records: { tab: 'MASTER_DATA', cols: ['entryDate', 'title', 'category', 'status', 'valueAmount', 'createdAt'] },
  tasks: { tab: 'TASKS', cols: ['taskName', 'category', 'priority', 'status', 'dueDate'] },
  notes: { tab: 'NOTES', cols: ['title', 'category', 'pinned', 'archived', 'updatedAt'] },
  reminders: { tab: 'REMINDERS', cols: ['reminderTitle', 'reminderDate', 'reminderTime', 'repeatRule', 'status'] }
};

function adminOverview_() {
  const counts = {};
  Object.keys(SCHEMA).forEach(function (n) { counts[n] = Math.max(0, sheet_(n).getLastRow() - 1); });
  const handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  const lastBackup = tail_('BACKUP_LOG', 100).reverse().filter(function (b) { return b.Status === 'OK'; })[0];
  const day = Utilities.formatDate(new Date(Date.now() - 86400000), tz_(), 'yyyy-MM-dd HH:mm:ss');
  const errors24h = tail_('AUTOMATION_LOG', 300).filter(function (r) { return r.Result === 'Error' && r.Timestamp >= day; }).length;
  let mailQuota = null; try { mailQuota = MailApp.getRemainingDailyQuota(); } catch (e) { /* ignore */ }
  return {
    owner: PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL'), spreadsheetUrl: ss_().getUrl(), tz: tz_(),
    counts: counts, triggersInstalled: TRIGGER_HANDLERS_.every(function (h) { return handlers.indexOf(h) >= 0; }),
    lastBackup: lastBackup ? out_('BACKUP_LOG', lastBackup) : null, errors24h: errors24h, mailQuota: mailQuota,
    overdueCount: Number(PropertiesService.getScriptProperties().getProperty('OVERDUE_COUNT') || 0),
    recentAutomation: tail_('AUTOMATION_LOG', 6).reverse().map(function (r) { return out_('AUTOMATION_LOG', r); })
  };
}

function adminList_(p) {
  const cfg = ADMIN_TABS_[p.tab];
  if (!cfg) throw bad_('Unknown admin section.');
  const km = keyMap_(cfg.tab), rev = {};
  Object.keys(km).forEach(function (h) { rev[km[h]] = h; });
  let rows = readTable_(cfg.tab).rows.reverse();
  const q = String(p.q || '').toLowerCase().trim();
  if (q) rows = rows.filter(function (r) { return Object.keys(r).some(function (k) { return k.charAt(0) !== '_' && String(r[k]).toLowerCase().indexOf(q) >= 0; }); });
  const size = 20, total = rows.length, pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Number(p.page) || 1), pages);
  return {
    columns: cfg.cols.map(function (k) { return { key: k, label: rev[k] }; }),
    rows: rows.slice((page - 1) * size, page * size).map(function (r) { return out_(cfg.tab, r); }),
    total: total, page: page, pages: pages
  };
}

function adminDelete_(p) {
  if (p.confirm !== true) throw bad_('Deletion must be confirmed.');
  const cfg = ADMIN_TABS_[p.tab];
  if (!cfg) throw bad_('Unknown admin section.');
  const ids = (p.ids || []).slice(0, 500);
  if (!ids.length) throw bad_('Nothing selected.');
  const modMap = { SHEET_LIBRARY: 'Sheets', MASTER_DATA: 'Data', TASKS: 'Tasks', NOTES: 'Notes', REMINDERS: 'Reminders' };
  return withLock_(function () {
    const gone = deleteByIds_(cfg.tab, ids);
    if (!gone.length) throw bad_('Nothing was deleted.');
    auditMany_(modMap[cfg.tab], 'Admin Delete', gone);
    activity_('Admin', 'Deleted ' + gone.length + ' item(s) from ' + cfg.tab);
    bump_();
    return { deleted: gone.length };
  });
}

function adminAutomation_() {
  const handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  return {
    jobs: SETTING_DEFS.filter(function (d) { return d.group === 'automation'; }).map(function (d) { return { key: d.key, label: d.label, value: String(getSetting_(d.key)).toUpperCase() === 'TRUE' }; }),
    triggers: TRIGGER_HANDLERS_.map(function (h) { return { handler: h, installed: handlers.indexOf(h) >= 0 }; }),
    log: tail_('AUTOMATION_LOG', 40).reverse().map(function (r) { return out_('AUTOMATION_LOG', r); })
  };
}

function adminRunJob_(p) {
  const jobs = {
    reminders: ['Reminders', processReminders_], overdue: ['Overdue Detection', detectOverdue_],
    summary: ['Dashboard Summary', function () { refreshSummary_(); return 'Dashboard cache refreshed.'; }],
    backup: ['Manual Backup', function () { return 'Backup created: ' + withLock_(function () { return createBackup_('Manual'); })['File Name']; }],
    cleanup: ['Log Cleanup', function () { return cleanupLogs_() || 'No old log rows to remove.'; }]
  };
  const j = jobs[p.job];
  if (!j) throw bad_('Unknown job.');
  const r = runJob_(j[0], null, j[1], true);
  if (r.message === 'Nothing to do.') {
    r.message = p.job === 'reminders' ? 'No reminders are due right now.' : r.message;
    try { logAutomation_(j[0], 'Success', 0, 'Manual run: ' + r.message); } catch (e) { /* ignore */ }
  }
  bump_();
  return r;
}

function adminInstallTriggers_() { return { message: installTriggersCore_() }; }
function adminRemoveTriggers_() { return { message: removeTriggersCore_() }; }

function adminBackups_() {
  return { backups: tail_('BACKUP_LOG', 100).reverse().map(function (r) { return out_('BACKUP_LOG', r); }), retention: numSetting_('BACKUP_RETENTION', 10) };
}
function adminBackupCreate_() {
  const b = withLock_(function () { return createBackup_('Manual'); });
  return out_('BACKUP_LOG', b);
}
function adminBackupRestore_(p) {
  return { message: withLock_(function () { return restoreBackup_(p.id, p.confirm); }) };
}
function adminBackupDelete_(p) {
  if (p.confirm !== true) throw bad_('Deletion must be confirmed.');
  return withLock_(function () {
    const row = findRow_('BACKUP_LOG', p.id);
    if (!row) throw bad_('Backup record not found.');
    const b = readRow_('BACKUP_LOG', row);
    if (b['File ID']) { try { DriveApp.getFileById(b['File ID']).setTrashed(true); } catch (e) { /* already gone */ } }
    updateRow_('BACKUP_LOG', row, { 'Status': 'Deleted', 'Message': 'Moved to Drive trash by owner' });
    audit_('Backup', 'Delete', p.id, b, null);
    return { deleted: 1 };
  });
}
