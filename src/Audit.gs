/**
 * MasterSheet – Audit.gs
 * Audit history (edits/deletes), activity log, automation log, backup log writers
 * and the admin Audit Log viewer.
 */
function logJson_(o) {
  if (!o) return '';
  let s = JSON.stringify(snap_(o));
  if (s.length > 40000) s = s.slice(0, 40000) + '…[truncated]';
  return s;
}

function audit_(module, action, id, before, after) {
  appendRows_('AUDIT_LOG', [{
    'Log ID': newId_('AUD'), 'Timestamp': now_(), 'User': currentUser_(), 'Module': module, 'Action': action,
    'Record ID': id || '', 'Before': logJson_(before), 'After': logJson_(after)
  }]);
}

function auditMany_(module, action, befores) {
  appendRows_('AUDIT_LOG', befores.map(function (b) {
    return {
      'Log ID': newId_('AUD'), 'Timestamp': now_(), 'User': currentUser_(), 'Module': module, 'Action': action,
      'Record ID': b[ID_COL_FOR_[module]] || '', 'Before': logJson_(b), 'After': ''
    };
  }));
}
const ID_COL_FOR_ = { Sheets: 'Sheet ID', Data: 'Record ID', Tasks: 'Task ID', Notes: 'Note ID', Reminders: 'Reminder ID' };

function activity_(module, action) {
  appendRows_('ACTIVITY_LOG', [{
    'Log ID': newId_('ACT'), 'Timestamp': now_(), 'User': currentUser_(), 'Module': module,
    'Action': String(action).slice(0, 300), 'Details': ''
  }]);
}

function logAutomation_(job, result, ms, message) {
  appendRows_('AUTOMATION_LOG', [{
    'Log ID': newId_('JOB'), 'Timestamp': now_(), 'Job': job, 'Result': result,
    'Duration (ms)': ms, 'Message': String(message || '').slice(0, 1000)
  }]);
}

function logBackup_(entry) {
  entry['Backup ID'] = entry['Backup ID'] || newId_('BKP');
  entry['Timestamp'] = now_();
  appendRows_('BACKUP_LOG', [entry]);
  return entry;
}

/** admin.audit – newest first, latest 1500 entries scanned */
function adminAudit_(p) {
  const q = String(p.q || '').toLowerCase().trim(), mod = String(p.module || '');
  let rows = tail_('AUDIT_LOG', 1500).reverse();
  if (mod) rows = rows.filter(function (r) { return r.Module === mod; });
  if (q) rows = rows.filter(function (r) {
    return (r.Action + ' ' + r['Record ID'] + ' ' + r.User + ' ' + r.Before + ' ' + r.After).toLowerCase().indexOf(q) >= 0;
  });
  const size = 25, total = rows.length, pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Number(p.page) || 1), pages);
  return { rows: rows.slice((page - 1) * size, page * size).map(function (r) { return out_('AUDIT_LOG', r); }), total: total, page: page, pages: pages };
}
