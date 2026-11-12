/**
 * MasterSheet – Dashboard.gs
 * All figures are computed from the real sheet tabs (never fake data).
 * Result is cached for 60 s and the cache is invalidated by every website write.
 */
function dashboardGet_(p) {
  const days = [7, 30, 90].indexOf(Number(p.days)) >= 0 ? Number(p.days) : 30;
  const key = 'dash:' + days;
  if (!p.force) { const c = cget_(key); if (c) return c; }
  const res = buildDashboard_(days);
  cput_(key, res, 60);
  return res;
}

function buildDashboard_(days) {
  const today = today_(), nm = nowMin_();
  const lib = readTable_('SHEET_LIBRARY').rows;
  const data = readTable_('MASTER_DATA').rows;
  const tasks = readTable_('TASKS').rows;
  const notes = readTable_('NOTES').rows;
  const rems = readTable_('REMINDERS').rows;

  const overdue = tasks.filter(function (t) { return t.Status !== 'Completed' && t['Due Date'] && t['Due Date'] < today; });
  const activeRems = rems.filter(function (r) { return r.Status === 'Active'; });
  const kpis = {
    totalSheets: lib.length,
    favoriteSheets: lib.filter(function (r) { return r.Favorite; }).length,
    totalRecords: data.length,
    recordsToday: data.filter(function (r) { return String(r['Created At']).slice(0, 10) === today; }).length,
    pendingTasks: tasks.filter(function (t) { return t.Status !== 'Completed'; }).length,
    completedTasks: tasks.filter(function (t) { return t.Status === 'Completed'; }).length,
    overdueTasks: overdue.length,
    activeReminders: activeRems.length
  };

  const favorites = lib.filter(function (r) { return r.Favorite; }).sort(function (a, b) {
    return (b.Pinned - a.Pinned) || cmp_(b['Last Opened'], a['Last Opened']) || cmp_(a.Name, b.Name);
  }).slice(0, 8).map(function (r) { return out_('SHEET_LIBRARY', r); });

  const recentEntries = data.slice().sort(function (a, b) { return cmp_(b['Created At'], a['Created At']); })
    .slice(0, 6).map(function (r) { return out_('MASTER_DATA', r); });

  const todayTasks = tasks.filter(function (t) {
    if (t.Status === 'Completed') return false;
    const s = t['Start Date'], d = t['Due Date'];
    return d === today || (s && s <= today && (!d || d >= today));
  }).sort(function (a, b) { return (PRIORITY_RANK[a.Priority] || 0) - (PRIORITY_RANK[b.Priority] || 0); })
    .slice(0, 8).map(function (r) { return out_('TASKS', r); });

  const overdueTasks = overdue.sort(function (a, b) { return cmp_(a['Due Date'], b['Due Date']); })
    .slice(0, 5).map(function (r) { return out_('TASKS', r); });

  const upcomingReminders = activeRems.sort(function (a, b) {
    return cmp_(a['Reminder Date'] + ' ' + a['Reminder Time'], b['Reminder Date'] + ' ' + b['Reminder Time']);
  }).slice(0, 6).map(function (r) {
    const o = out_('REMINDERS', r);
    o.overdue = (r['Reminder Date'] + ' ' + (r['Reminder Time'] || '00:00')) <= nm;
    return o;
  });

  const recentNotes = notes.filter(function (n) { return !n.Archived; }).sort(function (a, b) {
    return cmp_(b['Updated At'], a['Updated At']);
  }).slice(0, 6).map(function (r) {
    const o = out_('NOTES', r); o.content = String(o.content).slice(0, 160); return o;
  });

  const activity = tail_('ACTIVITY_LOG', 10).reverse().map(function (r) { return out_('ACTIVITY_LOG', r); });

  const from = addDays_(today, -(days - 1)), labels = dayList_(from, today), counts = {};
  data.forEach(function (r) { const d = String(r['Created At']).slice(0, 10); counts[d] = (counts[d] || 0) + 1; });
  const statusCounts = {};
  LISTS.DATA_STATUS.forEach(function (s) { statusCounts[s] = 0; });
  data.forEach(function (r) { statusCounts[r.Status] = (statusCounts[r.Status] || 0) + 1; });

  return {
    days: days, today: today, generatedAt: now_(), kpis: kpis, favorites: favorites, recentEntries: recentEntries,
    todayTasks: todayTasks, overdueTasks: overdueTasks, upcomingReminders: upcomingReminders,
    recentNotes: recentNotes, activity: activity,
    daily: { labels: labels, values: labels.map(function (d) { return counts[d] || 0; }) },
    status: { labels: Object.keys(statusCounts), values: Object.keys(statusCounts).map(function (k) { return statusCounts[k]; }) }
  };
}
