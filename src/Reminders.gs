/**
 * MasterSheet – Reminders.gs
 * Reminders + scheduled processing.
 * - Time-driven triggers run APPROXIMATELY (typically within a few minutes), not on the exact second.
 * - E-mail uses MailApp (daily quota applies). No browser push notifications are provided.
 * - Duplicate delivery is prevented with a per-occurrence key (id|date|time) claimed BEFORE sending.
 */
function remDue_(r) { return r['Reminder Date'] + ' ' + (r['Reminder Time'] || '00:00'); }

function reminderNormalize_(p) {
  const date = clean_(p.reminderDate, 10, 'Reminder date', true);
  if (!isDate_(date)) throw bad_('Reminder date is not a valid date.');
  const time = clean_(p.reminderTime, 5, 'Reminder time') || '09:00';
  if (!isTime_(time)) throw bad_('Reminder time must look like 14:30.');
  return {
    'Reminder Title': clean_(p.reminderTitle, 200, 'Reminder title', true),
    'Description': clean_(p.description, 2000, 'Description'),
    'Reminder Date': date, 'Reminder Time': time,
    'Repeat Rule': canon_(p.repeatRule || 'None', LISTS.REPEAT, 'repeat rule'),
    'Notification Channel': canon_(p.notificationChannel || 'Email', LISTS.CHANNEL, 'notification channel')
  };
}

function remOut_(r, nm) {
  const o = out_('REMINDERS', r);
  o.overdue = r.Status === 'Active' && remDue_(r) <= nm;
  return o;
}

function remindersList_(p) {
  const nm = nowMin_(), all = readTable_('REMINDERS').rows;
  const isOver = function (r) { return r.Status === 'Active' && remDue_(r) <= nm; };
  const counts = {
    upcoming: all.filter(function (r) { return r.Status === 'Active' && !isOver(r); }).length,
    overdue: all.filter(isOver).length,
    done: all.filter(function (r) { return r.Status !== 'Active'; }).length,
    all: all.length
  };
  let rows = all;
  const v = p.view || 'upcoming';
  if (v === 'upcoming') rows = rows.filter(function (r) { return r.Status === 'Active' && !isOver(r); });
  else if (v === 'overdue') rows = rows.filter(isOver);
  else if (v === 'done') rows = rows.filter(function (r) { return r.Status !== 'Active'; });
  const q = String(p.q || '').toLowerCase().trim();
  if (q) rows = rows.filter(function (r) { return (r['Reminder Title'] + ' ' + r.Description).toLowerCase().indexOf(q) >= 0; });
  rows.sort(function (a, b) { return v === 'done' ? cmp_(remDue_(b), remDue_(a)) : cmp_(remDue_(a), remDue_(b)); });
  return { reminders: rows.map(function (r) { return remOut_(r, nm); }), counts: counts };
}

function remindersAdd_(p) {
  const rec = reminderNormalize_(p);
  return withLock_(function () {
    const keys = onceGuard_(p.requestId, [rec['Reminder Title'], rec['Reminder Date'], rec['Reminder Time']].join('|'));
    try {
      const ts = now_();
      rec['Reminder ID'] = newId_('RMD'); rec['Status'] = 'Active'; rec['Last Sent At'] = ''; rec['Last Occurrence Key'] = '';
      rec['Created At'] = ts; rec['Updated At'] = ts;
      appendRows_('REMINDERS', [rec]);
      audit_('Reminders', 'Create', rec['Reminder ID'], null, rec);
      activity_('Reminders', 'Created reminder "' + rec['Reminder Title'] + '"');
      bump_();
      return remOut_(rec, nowMin_());
    } catch (e) { onceRelease_(keys); throw e; }
  });
}

function remindersUpdate_(p) {
  const rec = reminderNormalize_(p);
  return withLock_(function () {
    const row = findRow_('REMINDERS', p.id);
    if (!row) throw bad_('Reminder not found - it may have been deleted.');
    const before = readRow_('REMINDERS', row);
    rec['Status'] = 'Active'; rec['Last Occurrence Key'] = ''; rec['Updated At'] = now_();   // editing re-arms the reminder
    updateRow_('REMINDERS', row, rec);
    const after = readRow_('REMINDERS', row);
    audit_('Reminders', 'Update', p.id, before, after);
    activity_('Reminders', 'Edited reminder "' + rec['Reminder Title'] + '"');
    bump_();
    return remOut_(after, nowMin_());
  });
}

function remSetStatus_(id, status, action) {
  return withLock_(function () {
    const row = findRow_('REMINDERS', id);
    if (!row) throw bad_('Reminder not found.');
    const before = readRow_('REMINDERS', row), upd = { 'Status': status, 'Updated At': now_() };
    if (status === 'Active') upd['Last Occurrence Key'] = '';
    updateRow_('REMINDERS', row, upd);
    const after = readRow_('REMINDERS', row);
    audit_('Reminders', action, id, before, after);
    activity_('Reminders', action + ': "' + after['Reminder Title'] + '"');
    bump_();
    return remOut_(after, nowMin_());
  });
}
function remindersComplete_(p) { return remSetStatus_(p.id, 'Completed', 'Completed reminder'); }
function remindersReopen_(p) { return remSetStatus_(p.id, 'Active', 'Reopened reminder'); }

function remindersDelete_(p) {
  if (p.confirm !== true) throw bad_('Deletion must be confirmed.');
  return withLock_(function () {
    const gone = deleteByIds_('REMINDERS', [p.id]);
    if (!gone.length) throw bad_('Reminder not found - it may already be deleted.');
    auditMany_('Reminders', 'Delete', gone);
    activity_('Reminders', 'Deleted reminder "' + gone[0]['Reminder Title'] + '"');
    bump_();
    return { deleted: 1 };
  });
}

function nextDate_(date, rule) {
  if (rule === 'Daily') return addDays_(date, 1);
  if (rule === 'Weekly') return addDays_(date, 7);
  if (rule === 'Monthly') return addMonths_(date, 1);
  return date;
}

function reminderRecipient_() {
  return String(getSetting_('REMINDER_EMAIL') || '').trim() || PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
}

function sendReminderEmail_(r) {
  const title = r['Reminder Title'];
  const body = '<div style="font-family:Arial,sans-serif;max-width:480px">' +
    '<h2 style="color:#4F46E5;margin:0 0 8px">⏰ ' + escHtml_(title) + '</h2>' +
    '<p style="margin:0 0 6px;color:#334155">' + escHtml_(r.Description || 'This is your scheduled reminder.') + '</p>' +
    '<p style="margin:0;color:#64748B;font-size:13px">Scheduled for ' + escHtml_(remDue_(r)) +
    (r['Repeat Rule'] !== 'None' ? ' · repeats ' + escHtml_(String(r['Repeat Rule']).toLowerCase()) : '') + '</p></div>';
  MailApp.sendEmail({ to: reminderRecipient_(), subject: 'Reminder: ' + title, htmlBody: body, name: 'MasterSheet' });
}

/** Processes all due, active reminders. Returns a log message, or null when nothing was due. */
function processReminders_() {
  return withLock_(function () {
    const nm = nowMin_();
    const due = readTable_('REMINDERS').rows.filter(function (r) { return r.Status === 'Active' && remDue_(r) <= nm; });
    if (!due.length) return null;
    let sent = 0; const problems = [];
    due.forEach(function (r) {
      const key = r['Reminder ID'] + '|' + r['Reminder Date'] + '|' + (r['Reminder Time'] || '00:00');
      const alreadySent = r['Last Occurrence Key'] === key;
      if (!alreadySent) {
        updateRow_('REMINDERS', r._row, { 'Last Occurrence Key': key });        // claim this occurrence first
        if (r['Notification Channel'] === 'Email') {
          try { sendReminderEmail_(r); }
          catch (e) {
            updateRow_('REMINDERS', r._row, { 'Last Occurrence Key': '' });      // release so the next run retries
            problems.push(r['Reminder Title'] + ': ' + e.message);
            return;
          }
        }
        sent++;
      }
      const upd = { 'Updated At': now_() };
      if (!alreadySent) upd['Last Sent At'] = now_();
      if (r['Repeat Rule'] === 'None') upd['Status'] = 'Sent';
      else {
        let d = r['Reminder Date'], guard = 0;
        do { d = nextDate_(d, r['Repeat Rule']); guard++; } while ((d + ' ' + (r['Reminder Time'] || '00:00')) <= nm && guard < 1000);
        upd['Reminder Date'] = d;
      }
      updateRow_('REMINDERS', r._row, upd);
    });
    bump_();
    const msg = 'Processed ' + due.length + ' due reminder(s), delivered ' + sent + (problems.length ? '; problems: ' + problems.join(' | ') : '');
    if (problems.length) throw new Error(msg);
    return msg;
  });
}
