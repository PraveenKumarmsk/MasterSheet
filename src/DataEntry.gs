/**
 * MasterSheet – DataEntry.gs
 * Master data records: validated CRUD, server-side filtering/sorting/pagination,
 * bulk delete, CSV import/export, duplicate-submission protection, audit history.
 */
const DATA_SORT_ = { created: 'Created At', date: 'Entry Date', title: 'Title', category: 'Category', status: 'Status', priority: 'Priority', value: 'Value / Amount', updated: 'Updated At' };

function dataNormalize_(p) {
  const entryDate = clean_(p.entryDate, 10, 'Entry date') || today_();
  if (!isDate_(entryDate)) throw bad_('Entry date must be a valid date.');
  let value = '';
  const vs = clean_(p.valueAmount, 30, 'Value / Amount').replace(/,/g, '');
  if (vs !== '') { value = Number(vs); if (!isFinite(value)) throw bad_('Value / Amount must be a number.'); }
  return {
    'Entry Date': entryDate,
    'Category': clean_(p.category, 60, 'Category', true),
    'Title': clean_(p.title, 200, 'Title', true),
    'Description': clean_(p.description, 2000, 'Description'),
    'Value / Amount': value,
    'Status': canon_(p.status || 'Active', LISTS.DATA_STATUS, 'status'),
    'Priority': canon_(p.priority || 'Medium', LISTS.PRIORITY, 'priority'),
    'Remarks': clean_(p.remarks, 1000, 'Remarks')
  };
}

function dataAdd_(p) {
  const rec = dataNormalize_(p);
  return withLock_(function () {
    const keys = onceGuard_(p.requestId, [rec['Entry Date'], rec.Category, rec.Title, rec['Value / Amount']].join('|'));
    try {
      ensureCategory_(rec.Category);
      const ts = now_();
      rec['Record ID'] = newId_('REC'); rec['Created At'] = ts; rec['Updated At'] = ts;
      appendRows_('MASTER_DATA', [rec]);
      audit_('Data', 'Create', rec['Record ID'], null, rec);
      activity_('Data', 'Added record "' + rec.Title + '"');
      bump_();
      return out_('MASTER_DATA', rec);
    } catch (e) { onceRelease_(keys); throw e; }
  });
}

function dataUpdate_(p) {
  const rec = dataNormalize_(p);
  return withLock_(function () {
    const row = findRow_('MASTER_DATA', p.id);
    if (!row) throw bad_('Record not found - it may have been deleted.');
    const before = readRow_('MASTER_DATA', row);
    ensureCategory_(rec.Category);
    rec['Updated At'] = now_();
    updateRow_('MASTER_DATA', row, rec);
    const after = readRow_('MASTER_DATA', row);
    audit_('Data', 'Update', p.id, before, after);
    activity_('Data', 'Edited record "' + rec.Title + '"');
    bump_();
    return out_('MASTER_DATA', after);
  });
}

function dataDelete_(p) {
  if (p.confirm !== true) throw bad_('Deletion must be confirmed.');
  const ids = (Array.isArray(p.ids) ? p.ids : [p.id]).filter(Boolean).slice(0, 500);
  if (!ids.length) throw bad_('Nothing selected.');
  return withLock_(function () {
    const gone = deleteByIds_('MASTER_DATA', ids);
    if (!gone.length) throw bad_('Nothing was deleted - the records may already be gone.');
    auditMany_('Data', ids.length > 1 ? 'Bulk Delete' : 'Delete', gone);
    activity_('Data', 'Deleted ' + gone.length + ' record(s)');
    bump_();
    return { deleted: gone.length };
  });
}

function dataFilter_(p) {
  const q = String(p.q || '').toLowerCase().trim();
  let rows = readTable_('MASTER_DATA').rows;
  if (q) rows = rows.filter(function (r) {
    return (r.Title + ' ' + r.Description + ' ' + r.Remarks + ' ' + r.Category + ' ' + r['Record ID']).toLowerCase().indexOf(q) >= 0;
  });
  if (p.category) rows = rows.filter(function (r) { return r.Category === p.category; });
  if (p.status) rows = rows.filter(function (r) { return r.Status === p.status; });
  if (p.from) rows = rows.filter(function (r) { return r['Entry Date'] >= p.from; });
  if (p.to) rows = rows.filter(function (r) { return r['Entry Date'] <= p.to; });
  const parts = String(p.sort || 'created:desc').split(':');
  const col = DATA_SORT_[parts[0]] || 'Created At', dir = parts[1] === 'asc' ? 1 : -1;
  rows.sort(function (a, b) {
    let c;
    if (col === 'Priority') c = (PRIORITY_RANK[a.Priority] === undefined ? 9 : PRIORITY_RANK[a.Priority]) - (PRIORITY_RANK[b.Priority] === undefined ? 9 : PRIORITY_RANK[b.Priority]);
    else c = cmp_(a[col], b[col]);
    return c ? c * dir : cmp_(b['Created At'], a['Created At']);
  });
  return rows;
}

function dataList_(p) {
  const rows = dataFilter_(p);
  const size = Math.min(Math.max(Number(p.pageSize) || numSetting_('PAGE_SIZE', 25), 5), 100);
  const total = rows.length, pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Number(p.page) || 1), pages);
  return {
    rows: rows.slice((page - 1) * size, page * size).map(function (r) { return out_('MASTER_DATA', r); }),
    total: total, page: page, pages: pages, pageSize: size
  };
}

function dataImport_(p) {
  const input = Array.isArray(p.rows) ? p.rows.slice(0, 500) : [];
  if (!input.length) throw bad_('No rows to import.');
  const good = [], errors = [];
  input.forEach(function (r, i) {
    try { good.push(dataNormalize_(r)); } catch (e) { errors.push({ row: Number(r._line) || i + 1, error: e.message }); }
  });
  let imported = 0;
  if (good.length) {
    withLock_(function () {
      const ts = now_(), cats = {};
      good.forEach(function (g) { g['Record ID'] = newId_('REC'); g['Created At'] = ts; g['Updated At'] = ts; cats[g.Category] = 1; });
      Object.keys(cats).forEach(ensureCategory_);
      appendRows_('MASTER_DATA', good);
      audit_('Data', 'CSV Import', good.length + ' rows', null, { imported: good.length });
      activity_('Data', 'Imported ' + good.length + ' record(s) from CSV');
      bump_();
      imported = good.length;
    });
  }
  return { imported: imported, failed: errors.length, errors: errors.slice(0, 20) };
}

function csvCell_(v, isText) {
  let s = v == null ? '' : String(v);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;  // neutralise formulas in Excel/Sheets
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function dataExport_(p) {
  const rows = dataFilter_(p);
  const cols = ['Record ID', 'Entry Date', 'Category', 'Title', 'Description', 'Value / Amount', 'Status', 'Priority', 'Remarks', 'Created At', 'Updated At'];
  const lines = [cols.map(function (c) { return csvCell_(c, false); }).join(',')];
  rows.forEach(function (r) {
    lines.push(cols.map(function (c) { return csvCell_(r[c], c !== 'Value / Amount'); }).join(','));
  });
  activity_('Data', 'Exported ' + rows.length + ' record(s) to CSV');
  return { csv: lines.join('\r\n'), count: rows.length, filename: 'mastersheet-records-' + today_() + '.csv' };
}
