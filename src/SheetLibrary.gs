/**
 * MasterSheet – SheetLibrary.gs
 * Important Google Sheets Library. Only links + metadata are stored;
 * the linked spreadsheet's contents are never imported.
 */
const LIB_URL_RE_ = /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/;

function libNormalize_(p) {
  const name = clean_(p.name, 120, 'Sheet name', true);
  const url = clean_(p.url, 500, 'Google Sheets URL', true);
  const m = url.match(LIB_URL_RE_);
  if (!m) throw bad_('Enter a valid Google Sheets URL (https://docs.google.com/spreadsheets/d/...).');
  return {
    'Name': name, 'URL': url, 'File Key': m[1],
    'Category': clean_(p.category, 60, 'Category') || 'Other',
    'Description': clean_(p.description, 1000, 'Description'),
    'Tags': tags_(p.tags),
    'Priority': canon_(p.priority || 'Medium', LISTS.PRIORITY, 'priority'),
    'Favorite': p.favorite === true || String(p.favorite).toUpperCase() === 'TRUE',
    'Pinned': p.pinned === true || String(p.pinned).toUpperCase() === 'TRUE'
  };
}

function libraryList_() {
  const rows = readTable_('SHEET_LIBRARY').rows;
  return { sheets: rows.map(function (r) { return out_('SHEET_LIBRARY', r); }), categories: categories_() };
}

function libDuplicate_(rows, key, selfId) {
  return rows.filter(function (r) { return r['File Key'] === key && r['Sheet ID'] !== selfId; })[0];
}

function libraryAdd_(p) {
  const rec = libNormalize_(p);
  return withLock_(function () {
    const dup = libDuplicate_(readTable_('SHEET_LIBRARY').rows, rec['File Key'], '');
    if (dup) throw bad_('This spreadsheet is already registered as "' + dup.Name + '".');
    const keys = onceGuard_(p.requestId, null);
    try {
      ensureCategory_(rec.Category);
      const ts = now_();
      rec['Sheet ID'] = newId_('SHT'); rec['Date Added'] = ts; rec['Last Opened'] = ''; rec['Last Updated'] = ts;
      appendRows_('SHEET_LIBRARY', [rec]);
      audit_('Sheets', 'Create', rec['Sheet ID'], null, rec);
      activity_('Sheets', 'Added sheet link "' + rec.Name + '"');
      bump_();
      return out_('SHEET_LIBRARY', rec);
    } catch (e) { onceRelease_(keys); throw e; }
  });
}

function libraryUpdate_(p) {
  const rec = libNormalize_(p);
  return withLock_(function () {
    const row = findRow_('SHEET_LIBRARY', p.id);
    if (!row) throw bad_('Sheet not found - it may have been deleted.');
    const dup = libDuplicate_(readTable_('SHEET_LIBRARY').rows, rec['File Key'], p.id);
    if (dup) throw bad_('Another entry already uses this spreadsheet: "' + dup.Name + '".');
    const before = readRow_('SHEET_LIBRARY', row);
    ensureCategory_(rec.Category);
    rec['Last Updated'] = now_();
    updateRow_('SHEET_LIBRARY', row, rec);
    const after = readRow_('SHEET_LIBRARY', row);
    audit_('Sheets', 'Update', p.id, before, after);
    activity_('Sheets', 'Edited sheet link "' + rec.Name + '"');
    bump_();
    return out_('SHEET_LIBRARY', after);
  });
}

function libraryDelete_(p) {
  if (p.confirm !== true) throw bad_('Deletion must be confirmed.');
  return withLock_(function () {
    const gone = deleteByIds_('SHEET_LIBRARY', [p.id]);
    if (!gone.length) throw bad_('Sheet not found - it may already be deleted.');
    auditMany_('Sheets', 'Delete', gone);
    activity_('Sheets', 'Deleted sheet link "' + gone[0].Name + '"');
    bump_();
    return { deleted: gone.length };
  });
}

function libFlag_(id, header) {
  return withLock_(function () {
    const row = findRow_('SHEET_LIBRARY', id);
    if (!row) throw bad_('Sheet not found.');
    const cur = readRow_('SHEET_LIBRARY', row);
    const upd = {}; upd[header] = !cur[header]; upd['Last Updated'] = now_();
    updateRow_('SHEET_LIBRARY', row, upd);
    bump_();
    return out_('SHEET_LIBRARY', readRow_('SHEET_LIBRARY', row));
  });
}
function libraryFav_(p) { return libFlag_(p.id, 'Favorite'); }
function libraryPin_(p) { return libFlag_(p.id, 'Pinned'); }

function libraryOpened_(p) {
  return withLock_(function () {
    const row = findRow_('SHEET_LIBRARY', p.id);
    if (!row) return { ok: false };
    updateRow_('SHEET_LIBRARY', row, { 'Last Opened': now_() });
    bump_();
    return { ok: true };
  });
}
