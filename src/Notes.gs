/**
 * MasterSheet – Notes.gs
 * Notes are stored and rendered as safe plain text (the browser escapes everything).
 */
function noteNormalize_(p) {
  return {
    'Title': clean_(p.title, 200, 'Title', true),
    'Content': clean_(p.content, 20000, 'Content'),
    'Category': clean_(p.category, 60, 'Category') || 'Other',
    'Tags': tags_(p.tags),
    'Pinned': p.pinned === true || String(p.pinned).toUpperCase() === 'TRUE'
  };
}

function notesList_(p) {
  let rows = readTable_('NOTES').rows;
  const wantArchived = p.archived === true;
  const counts = { active: rows.filter(function (n) { return !n.Archived; }).length, archived: rows.filter(function (n) { return n.Archived; }).length };
  rows = rows.filter(function (n) { return !!n.Archived === wantArchived; });
  const q = String(p.q || '').toLowerCase().trim();
  if (q) rows = rows.filter(function (n) { return (n.Title + ' ' + n.Content + ' ' + n.Tags + ' ' + n.Category).toLowerCase().indexOf(q) >= 0; });
  if (p.category) rows = rows.filter(function (n) { return n.Category === p.category; });
  rows.sort(function (a, b) { return (b.Pinned - a.Pinned) || cmp_(b['Updated At'], a['Updated At']); });
  return { notes: rows.map(function (n) { return out_('NOTES', n); }), counts: counts };
}

function notesAdd_(p) {
  const rec = noteNormalize_(p);
  return withLock_(function () {
    const keys = onceGuard_(p.requestId, null);
    try {
      ensureCategory_(rec.Category);
      const ts = now_();
      rec['Note ID'] = newId_('NTE'); rec['Archived'] = false; rec['Created At'] = ts; rec['Updated At'] = ts;
      appendRows_('NOTES', [rec]);
      audit_('Notes', 'Create', rec['Note ID'], null, rec);
      activity_('Notes', 'Added note "' + rec.Title + '"');
      bump_();
      return out_('NOTES', rec);
    } catch (e) { onceRelease_(keys); throw e; }
  });
}

function notesUpdate_(p) {
  const rec = noteNormalize_(p);
  return withLock_(function () {
    const row = findRow_('NOTES', p.id);
    if (!row) throw bad_('Note not found - it may have been deleted.');
    const before = readRow_('NOTES', row);
    ensureCategory_(rec.Category);
    rec['Updated At'] = now_();
    updateRow_('NOTES', row, rec);
    const after = readRow_('NOTES', row);
    audit_('Notes', 'Update', p.id, before, after);
    activity_('Notes', 'Edited note "' + rec.Title + '"');
    bump_();
    return out_('NOTES', after);
  });
}

function noteFlag_(id, header, action) {
  return withLock_(function () {
    const row = findRow_('NOTES', id);
    if (!row) throw bad_('Note not found.');
    const before = readRow_('NOTES', row), upd = {};
    upd[header] = !before[header]; upd['Updated At'] = now_();
    updateRow_('NOTES', row, upd);
    const after = readRow_('NOTES', row);
    audit_('Notes', action + (after[header] ? '' : ' (undo)'), id, before, after);
    activity_('Notes', action + ': "' + after.Title + '"');
    bump_();
    return out_('NOTES', after);
  });
}
function notesPin_(p) { return noteFlag_(p.id, 'Pinned', 'Pin'); }
function notesArchive_(p) { return noteFlag_(p.id, 'Archived', 'Archive'); }

function notesDelete_(p) {
  if (p.confirm !== true) throw bad_('Deletion must be confirmed.');
  return withLock_(function () {
    const gone = deleteByIds_('NOTES', [p.id]);
    if (!gone.length) throw bad_('Note not found - it may already be deleted.');
    auditMany_('Notes', 'Delete', gone);
    activity_('Notes', 'Deleted note "' + gone[0].Title + '"');
    bump_();
    return { deleted: 1 };
  });
}
