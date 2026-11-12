/**
 * MasterSheet – Database.gs
 * Sheet access layer: batched reads/writes, type handling, formula-injection guard,
 * locking, cache versioning, settings, setup (setupMasterSheet).
 * Functions ending in "_" are private (not callable from the browser).
 */
let SS_ = null, TZ_ = null, SET_ = null;
const TYPES_ = {}, KEYS_ = {};

function bad_(msg) { const e = new Error(msg); e.expected = true; return e; }

/* ---------------- spreadsheet / time ---------------- */
function ss_() {
  if (SS_) return SS_;
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('SPREADSHEET_ID');
  if (id) { SS_ = SpreadsheetApp.openById(id); return SS_; }
  let s = null;
  try { s = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* standalone project */ }
  if (!s) s = SpreadsheetApp.create('MasterSheet Database');
  p.setProperty('SPREADSHEET_ID', s.getId());
  SS_ = s;
  return s;
}
function tz_() { return TZ_ || (TZ_ = ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone()); }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function nowMin_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function addDays_(s, n) {
  const p = s.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function addMonths_(s, n) {
  const p = s.split('-').map(Number);
  const first = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(p[2], last))).toISOString().slice(0, 10);
}
function dayList_(from, to) {
  const out = []; let d = from, guard = 0;
  while (d <= to && guard++ < 400) { out.push(d); d = addDays_(d, 1); }
  return out;
}
function isDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const p = s.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}
function isTime_(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

/* ---------------- small helpers ---------------- */
function newId_(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(); }
function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function clean_(v, max, label, required) {
  const s = v == null ? '' : String(v).replace(/\u0000/g, '').trim();
  if (required && !s) throw bad_(label + ' is required.');
  if (s.length > max) throw bad_(label + ' is too long (max ' + max + ' characters).');
  return s;
}
function canon_(v, list, label) {
  const f = list.filter(function (x) { return x.toLowerCase() === String(v).trim().toLowerCase(); })[0];
  if (!f) throw bad_('Invalid ' + label + ': "' + v + '". Allowed: ' + list.join(', ') + '.');
  return f;
}
function cmp_(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === '' && b !== '') return 1;
  if (b === '' && a !== '') return -1;
  return String(a).localeCompare(String(b));
}
function tags_(s) {
  const seen = {}, out = [];
  String(s || '').split(',').forEach(function (t) {
    t = t.trim();
    if (t && !seen[t.toLowerCase()] && out.length < 10) { seen[t.toLowerCase()] = 1; out.push(t.slice(0, 30)); }
  });
  return out.join(', ');
}
function camel_(h) {
  return String(h).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map(function (w, i) {
    return i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
  }).join('');
}
function typeMap_(name) {
  if (!TYPES_[name]) { const m = {}; SCHEMA[name].forEach(function (c) { m[c[0]] = c[1]; }); TYPES_[name] = m; }
  return TYPES_[name];
}
function keyMap_(name) {
  if (!KEYS_[name]) {
    const m = {};
    SCHEMA[name].forEach(function (c) { m[c[0]] = c[0] === ID_COL[name] ? 'id' : camel_(c[0]); });
    KEYS_[name] = m;
  }
  return KEYS_[name];
}
/** header-keyed row -> client object with camelCase keys */
function out_(name, row) {
  const km = keyMap_(name), o = {};
  Object.keys(km).forEach(function (h) { o[km[h]] = row[h] === undefined ? '' : row[h]; });
  return o;
}
function snap_(row) {
  const o = {};
  Object.keys(row).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = row[k]; });
  return o;
}

/* ---------------- value conversion ---------------- */
function norm_(v, t) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz_(), t === 'date' ? 'yyyy-MM-dd' : t === 'time' ? 'HH:mm' : 'yyyy-MM-dd HH:mm:ss');
  }
  if (t === 'number') { if (v === '' || v === null) return ''; const n = Number(v); return isNaN(n) ? '' : n; }
  if (t === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^'[=+\-@\t\r]/.test(s)) s = s.slice(1); // undo formula-injection guard
  return s;
}
function prep_(v, t) {
  if (t === 'number') { if (v === '' || v == null) return ''; const n = Number(v); return isNaN(n) ? '' : n; }
  if (t === 'bool') return (v === true || String(v).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // prevent spreadsheet formula injection
  return s.length > 45000 ? s.slice(0, 45000) : s;
}

/* ---------------- table I/O ---------------- */
function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Tab "' + name + '" is missing. Run setupMasterSheet() again.');
  return s;
}
function headersOf_(sh) {
  const lc = sh.getLastColumn();
  return lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(String) : [];
}
function rowsToObjs_(name, headers, vals, firstRow) {
  const tm = typeMap_(name), idH = ID_COL[name], out = [];
  for (let i = 0; i < vals.length; i++) {
    const o = { _row: firstRow + i };
    for (let c = 0; c < headers.length; c++) o[headers[c]] = norm_(vals[i][c], tm[headers[c]] || 'text');
    if (o[idH] !== '' && o[idH] != null) out.push(o);
  }
  return out;
}
function readTable_(name) {
  const sh = sheet_(name), lr = sh.getLastRow(), headers = headersOf_(sh);
  const rows = (lr >= 2 && headers.length)
    ? rowsToObjs_(name, headers, sh.getRange(2, 1, lr - 1, headers.length).getValues(), 2) : [];
  return { sh: sh, headers: headers, rows: rows };
}
function tail_(name, n) {
  const sh = sheet_(name), lr = sh.getLastRow(), headers = headersOf_(sh);
  if (lr < 2 || !headers.length) return [];
  const start = Math.max(2, lr - n + 1);
  return rowsToObjs_(name, headers, sh.getRange(start, 1, lr - start + 1, headers.length).getValues(), start);
}
function readRow_(name, row) {
  const sh = sheet_(name), headers = headersOf_(sh);
  return rowsToObjs_(name, headers, [sh.getRange(row, 1, 1, headers.length).getValues()[0]], row)[0] || null;
}
function findRow_(name, id) {
  const sh = sheet_(name), lr = sh.getLastRow();
  if (lr < 2) return 0;
  const idx = headersOf_(sh).indexOf(ID_COL[name]);
  if (idx < 0) return 0;
  const ids = sh.getRange(2, idx + 1, lr - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
function getById_(name, id) { const r = findRow_(name, id); return r ? readRow_(name, r) : null; }

function appendRows_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name), headers = headersOf_(sh), tm = typeMap_(name);
  const rows = objs.map(function (o) {
    return headers.map(function (h) { return o[h] === undefined ? '' : prep_(o[h], tm[h] || 'text'); });
  });
  const start = Math.max(sh.getLastRow(), 1) + 1, need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  sh.getRange(start, 1, rows.length, headers.length).setValues(rows);
}
function updateRow_(name, rowNum, obj) {
  const sh = sheet_(name), headers = headersOf_(sh), tm = typeMap_(name);
  const range = sh.getRange(rowNum, 1, 1, headers.length), vals = range.getValues()[0];
  headers.forEach(function (h, i) { if (obj[h] !== undefined) vals[i] = prep_(obj[h], tm[h] || 'text'); });
  range.setValues([vals]);
}
function deleteByIds_(name, ids) {
  const set = {}; ids.forEach(function (i) { set[String(i)] = 1; });
  const t = readTable_(name);
  const hit = t.rows.filter(function (r) { return set[String(r[ID_COL[name]])]; });
  if (!hit.length) return [];
  if (t.sh.getMaxRows() - t.sh.getLastRow() < 2) t.sh.insertRowsAfter(t.sh.getMaxRows(), 5);
  const rows = hit.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    t.sh.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
  return hit;
}

/* ---------------- locking / cache / idempotency ---------------- */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); }
  catch (e) { throw bad_('The system is busy right now. Please retry in a few seconds.'); }
  try { return fn(); } finally { lock.releaseLock(); }
}
function cver_() { return PropertiesService.getScriptProperties().getProperty('CACHE_VER') || '0'; }
function bump_() { PropertiesService.getScriptProperties().setProperty('CACHE_VER', String(Date.now())); }
function cget_(k) {
  try { const s = CacheService.getScriptCache().get('v' + cver_() + ':' + k); return s ? JSON.parse(s) : null; }
  catch (e) { return null; }
}
function cput_(k, v, ttl) {
  try { const s = JSON.stringify(v); if (s.length < 90000) CacheService.getScriptCache().put('v' + cver_() + ':' + k, s, ttl || 60); }
  catch (e) { /* cache is best-effort */ }
}
/** Blocks double submits: same requestId, or identical fingerprint within 45 seconds. */
function onceGuard_(rid, fingerprint) {
  const c = CacheService.getScriptCache(), keys = [];
  if (rid) {
    const k = 'rid:' + String(rid).slice(0, 80);
    if (c.get(k)) throw bad_('Duplicate submission ignored - this entry was already saved.');
    c.put(k, '1', 600); keys.push(k);
  }
  if (fingerprint) {
    const k2 = 'fp:' + md5_(fingerprint);
    if (c.get(k2)) { keys.forEach(function (x) { c.remove(x); }); throw bad_('An identical entry was just submitted. Wait a minute before adding it again.'); }
    c.put(k2, '1', 45); keys.push(k2);
  }
  return keys;
}
function onceRelease_(keys) { const c = CacheService.getScriptCache(); (keys || []).forEach(function (k) { c.remove(k); }); }

/* ---------------- settings ---------------- */
function settings_() {
  if (SET_) return SET_;
  const o = {};
  SETTING_DEFS.forEach(function (d) { o[d.key] = d.def; });
  try { readTable_('SETTINGS').rows.forEach(function (r) { if (r.Key !== '') o[r.Key] = r.Value; }); } catch (e) { /* before setup */ }
  SET_ = o;
  return o;
}
function getSetting_(k) { return settings_()[k]; }
function boolSetting_(k) { return String(getSetting_(k)).toUpperCase() === 'TRUE'; }
function numSetting_(k, d) { const n = Number(getSetting_(k)); return isFinite(n) ? n : d; }
function setSettingRow_(key, val) {
  const d = SETTING_DEFS.filter(function (x) { return x.key === key; })[0];
  const r = findRow_('SETTINGS', key);
  if (r) updateRow_('SETTINGS', r, { 'Value': val, 'Updated At': now_() });
  else appendRows_('SETTINGS', [{ 'Key': key, 'Value': val, 'Description': d ? d.desc : '', 'Updated At': now_() }]);
  if (SET_) SET_[key] = val;
}
function categories_() {
  const seen = {}, list = [];
  String(getSetting_('CATEGORIES') || '').split(',').forEach(function (c) {
    c = c.trim();
    if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; list.push(c); }
  });
  return list.length ? list : LISTS.CATEGORIES.slice();
}
/** call inside withLock_ */
function ensureCategory_(cat) {
  cat = String(cat || '').trim();
  if (!cat) return;
  const list = categories_();
  if (list.some(function (c) { return c.toLowerCase() === cat.toLowerCase(); })) return;
  list.push(cat);
  setSettingRow_('CATEGORIES', list.join(', '));
}

/* ---------------- setup ---------------- */
/**
 * Run this once from the editor (or spreadsheet menu MasterSheet > Setup).
 * Creates missing tabs + headers + formatting. Never erases existing data. Safe to re-run.
 */
function setupMasterSheet() {
  assertOwner_({ firstRun: true });
  const report = withLock_(setupCore_);
  try { ss_().toast('Setup complete. Tabs and headers are ready.', 'MasterSheet', 6); } catch (e) { /* no UI */ }
  return report;
}

function ensureSetup_() {
  const v = PropertiesService.getScriptProperties().getProperty('SETUP_VERSION');
  if (String(v) !== String(APP.SCHEMA_VERSION)) withLock_(setupCore_);
}

function setupCore_() {
  const ss = ss_(), report = [];
  Object.keys(SCHEMA).forEach(function (name) { report.push(ensureTab_(ss, name)); });
  seedSettings_();
  const d = ss.getSheetByName('Sheet1');
  if (d && d.getLastRow() === 0 && ss.getSheets().length > 1) { try { ss.deleteSheet(d); } catch (e) { /* ignore */ } }
  PropertiesService.getScriptProperties().setProperty('SETUP_VERSION', String(APP.SCHEMA_VERSION));
  bump_();
  try { appendRows_('ACTIVITY_LOG', [{ 'Log ID': newId_('ACT'), 'Timestamp': now_(), 'User': currentUser_(), 'Module': 'System', 'Action': 'Setup', 'Details': 'setupMasterSheet executed' }]); } catch (e) { /* ignore */ }
  return report.join('\n');
}

function ensureTab_(ss, name) {
  let sh = ss.getSheetByName(name), created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }
  const cols = SCHEMA[name];
  let hdr = headersOf_(sh);
  while (hdr.length && hdr[hdr.length - 1] === '') hdr.pop();
  const newIdx = [];
  cols.forEach(function (c) {
    if (hdr.indexOf(c[0]) < 0) { hdr.push(c[0]); newIdx.push(hdr.length - 1); }
  });
  if (newIdx.length) {
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
    const maxR = sh.getMaxRows();
    newIdx.forEach(function (i) {
      const t = typeMap_(name)[hdr[i]];
      sh.getRange(1, i + 1, maxR, 1).setNumberFormat(t === 'number' ? '#,##0.00' : '@');
      sh.setColumnWidth(i + 1, t === 'text' ? 170 : 130);
    });
  }
  sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#4F46E5');
  sh.setFrozenRows(1);
  return (created ? 'Created tab ' : 'Checked tab ') + name + (newIdx.length ? ' (' + newIdx.length + ' header(s) added)' : '');
}

function seedSettings_() {
  const have = {};
  readTable_('SETTINGS').rows.forEach(function (r) { have[r.Key] = 1; });
  const add = [];
  SETTING_DEFS.forEach(function (d) {
    if (!have[d.key]) add.push({ 'Key': d.key, 'Value': d.def, 'Description': d.desc, 'Updated At': now_() });
  });
  appendRows_('SETTINGS', add);
  SET_ = null;
}
