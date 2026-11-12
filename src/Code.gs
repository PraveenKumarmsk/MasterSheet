/**
 * MasterSheet – Code.gs
 * Entry points (doGet, onOpen), the single API gateway used by the browser (api),
 * and shared lookups (boot, search, item, notifications, settings).
 *
 * SECURITY: the browser can only call api(); every call re-verifies the owner
 * (Auth.gs) before any read or write. Internal functions end with "_".
 */
function doGet() {
  try { assertOwner_({ web: true }); } catch (err) { return statusPage_(err); }
  try { ensureSetup_(); } catch (err) { return statusPage_(err); }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(String(getSetting_('APP_NAME') || APP.NAME))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('MasterSheet')
      .addItem('1. Setup / repair tabs and headers', 'setupMasterSheet')
      .addItem('2. Install automation triggers', 'installTriggers')
      .addItem('Remove automation triggers', 'removeTriggers')
      .addSeparator()
      .addItem('Create backup now', 'backupNowMenu')
      .addToUi();
  } catch (e) { /* not opened from a spreadsheet */ }
}

function backupNowMenu() {
  assertOwner_({});
  const b = withLock_(function () { return createBackup_('Manual'); });
  try { ss_().toast('Backup created: ' + b['File Name'], 'MasterSheet', 6); } catch (e) { /* no UI */ }
  return b['File Name'];
}

/* ---------------- API gateway ---------------- */
function api(action, payload) {
  const t0 = Date.now();
  try {
    assertOwner_({ web: true });
    const fn = routes_()[action];
    if (!fn) throw bad_('Unknown action: ' + action);
    return { ok: true, data: fn(payload || {}) };
  } catch (err) {
    const m = String(err && err.message ? err.message : err);
    if (m === 'DENIED') return { ok: false, error: 'Access denied.' };
    if (m === 'IDENTITY') return { ok: false, error: 'Your Google identity could not be verified. Re-deploy as "Execute as: User accessing the web app".' };
    if (m === 'NOT_CONFIGURED') return { ok: false, error: 'Setup required: run setupMasterSheet() in the editor.' };
    if (!err.expected) { try { logAutomation_('App Error', 'Error', Date.now() - t0, action + ': ' + m); } catch (e2) { /* ignore */ } }
    return { ok: false, error: err.expected ? m : 'Server error: ' + m + ' - please retry in a few seconds.' };
  }
}

function routes_() {
  return {
    'boot': boot_, 'notifications': notifications_, 'search': search_, 'item': getItem_,
    'categories.add': categoryAdd_, 'settings.save': settingsSave_,
    'dashboard': dashboardGet_,
    'library.list': libraryList_, 'library.add': libraryAdd_, 'library.update': libraryUpdate_,
    'library.delete': libraryDelete_, 'library.fav': libraryFav_, 'library.pin': libraryPin_, 'library.opened': libraryOpened_,
    'data.list': dataList_, 'data.add': dataAdd_, 'data.update': dataUpdate_, 'data.delete': dataDelete_,
    'data.import': dataImport_, 'data.export': dataExport_,
    'analytics': analyticsGet_,
    'tasks.list': tasksList_, 'tasks.add': tasksAdd_, 'tasks.update': tasksUpdate_, 'tasks.delete': tasksDelete_, 'tasks.status': tasksStatus_,
    'notes.list': notesList_, 'notes.add': notesAdd_, 'notes.update': notesUpdate_, 'notes.delete': notesDelete_,
    'notes.pin': notesPin_, 'notes.archive': notesArchive_,
    'reminders.list': remindersList_, 'reminders.add': remindersAdd_, 'reminders.update': remindersUpdate_,
    'reminders.delete': remindersDelete_, 'reminders.complete': remindersComplete_, 'reminders.reopen': remindersReopen_,
    'admin.overview': adminOverview_, 'admin.list': adminList_, 'admin.delete': adminDelete_, 'admin.audit': adminAudit_,
    'admin.automation': adminAutomation_, 'admin.runJob': adminRunJob_,
    'admin.installTriggers': adminInstallTriggers_, 'admin.removeTriggers': adminRemoveTriggers_,
    'admin.backups': adminBackups_, 'admin.backupCreate': adminBackupCreate_,
    'admin.backupRestore': adminBackupRestore_, 'admin.backupDelete': adminBackupDelete_
  };
}

/* ---------------- shared endpoints ---------------- */
function boot_() {
  const s = settings_();
  return {
    user: currentUser_(), appName: s.APP_NAME || APP.NAME, tz: tz_(), today: today_(), now: now_(),
    categories: categories_(),
    lists: { dataStatus: LISTS.DATA_STATUS, taskStatus: LISTS.TASK_STATUS, priority: LISTS.PRIORITY, repeat: LISTS.REPEAT, channel: LISTS.CHANNEL },
    settings: s, settingDefs: SETTING_DEFS, spreadsheetUrl: ss_().getUrl()
  };
}

function categoryAdd_(p) {
  const c = clean_(p.name, 60, 'Category', true);
  withLock_(function () { ensureCategory_(c); bump_(); });
  return categories_();
}

function settingsSave_(p) {
  const vals = p.values || {}, saved = {};
  const defs = {}; SETTING_DEFS.forEach(function (d) { defs[d.key] = d; });
  const clean = {};
  Object.keys(vals).forEach(function (k) {
    const d = defs[k];
    if (!d) throw bad_('Unknown setting: ' + k);
    let v = vals[k];
    if (d.type === 'number') {
      let n = Number(v);
      if (!isFinite(n)) throw bad_(d.label + ' must be a number.');
      n = Math.round(Math.min(Math.max(n, d.min), d.max));
      if (k === 'POLL_INTERVAL_SEC' && n > 0 && n < 15) n = 15;
      v = String(n);
    } else if (d.type === 'select') {
      if (d.options.indexOf(String(v)) < 0) throw bad_('Invalid value for ' + d.label + '.');
      v = String(v);
    } else if (d.type === 'bool') {
      v = (v === true || String(v).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
    } else if (d.type === 'list') {
      const seen = {}, list = [];
      String(v || '').split(',').forEach(function (x) {
        x = x.trim().slice(0, 40);
        if (x && !seen[x.toLowerCase()] && list.length < 40) { seen[x.toLowerCase()] = 1; list.push(x); }
      });
      if (k === 'CATEGORIES' && !list.length) throw bad_('Keep at least one category.');
      v = list.join(k === 'DASH_WIDGETS' ? ',' : ', ');
    } else {
      v = clean_(v, 200, d.label);
      if (k === 'REMINDER_EMAIL' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad_('Enter a valid e-mail address.');
      if (k === 'APP_NAME' && !v) throw bad_('Application name cannot be empty.');
    }
    clean[k] = v;
  });
  withLock_(function () {
    Object.keys(clean).forEach(function (k) { setSettingRow_(k, clean[k]); saved[k] = clean[k]; });
    audit_('Settings', 'Update', Object.keys(clean).join(','), null, clean);
    activity_('Settings', 'Updated settings: ' + Object.keys(clean).join(', '));
    bump_();
  });
  return { saved: saved, settings: settings_(), categories: categories_() };
}

function getItem_(p) {
  const map = { sheet: 'SHEET_LIBRARY', data: 'MASTER_DATA', task: 'TASKS', note: 'NOTES', reminder: 'REMINDERS' };
  const tab = map[p.type];
  if (!tab) throw bad_('Unknown item type.');
  const row = getById_(tab, p.id);
  if (!row) throw bad_('That item no longer exists.');
  return out_(tab, row);
}

function search_(p) {
  const q = String(p.q || '').toLowerCase().trim();
  if (q.length < 2) return { results: [] };
  const has = function () { for (let i = 0; i < arguments.length; i++) if (String(arguments[i]).toLowerCase().indexOf(q) >= 0) return true; return false; };
  const res = [];
  readTable_('SHEET_LIBRARY').rows.filter(function (r) { return has(r.Name, r.Description, r.Tags, r.Category, r.URL); }).slice(0, 6)
    .forEach(function (r) { res.push({ type: 'sheet', id: r['Sheet ID'], title: r.Name, sub: 'Sheet · ' + r.Category }); });
  readTable_('MASTER_DATA').rows.filter(function (r) { return has(r.Title, r.Description, r.Remarks, r.Category, r['Record ID']); }).slice(0, 6)
    .forEach(function (r) { res.push({ type: 'data', id: r['Record ID'], title: r.Title, sub: 'Record · ' + r.Category + ' · ' + r['Entry Date'] }); });
  readTable_('TASKS').rows.filter(function (r) { return has(r['Task Name'], r.Description, r.Category); }).slice(0, 6)
    .forEach(function (r) { res.push({ type: 'task', id: r['Task ID'], title: r['Task Name'], sub: 'Task · ' + r.Status }); });
  readTable_('NOTES').rows.filter(function (r) { return has(r.Title, r.Content, r.Tags, r.Category); }).slice(0, 6)
    .forEach(function (r) { res.push({ type: 'note', id: r['Note ID'], title: r.Title, sub: 'Note · ' + r.Category }); });
  return { results: res };
}

function notifications_() {
  const today = today_(), nm = nowMin_();
  const tasks = readTable_('TASKS').rows.filter(function (t) { return t.Status !== 'Completed' && t['Due Date'] && t['Due Date'] < today; })
    .sort(function (a, b) { return cmp_(a['Due Date'], b['Due Date']); });
  const rems = readTable_('REMINDERS').rows.filter(function (r) { return r.Status === 'Active' && (r['Reminder Date'] + ' ' + (r['Reminder Time'] || '00:00')) <= nm; })
    .sort(function (a, b) { return cmp_(a['Reminder Date'], b['Reminder Date']); });
  return {
    today: today, overdueTasks: tasks.length, overdueReminders: rems.length,
    tasks: tasks.slice(0, 8).map(function (t) { return out_('TASKS', t); }),
    reminders: rems.slice(0, 8).map(function (r) { return out_('REMINDERS', r); })
  };
}
