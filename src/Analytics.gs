/**
 * MasterSheet – Analytics.gs
 * Server-side aggregation for the six charts. Data is read once, aggregated here,
 * and only small result sets are sent to the browser. Cached 60 s per filter set.
 */
function rangeDates_(key, from, to) {
  const t = today_();
  if (key === 'today') return [t, t];
  if (key === '7d') return [addDays_(t, -6), t];
  if (key === 'month') return [t.slice(0, 8) + '01', t];
  if (key === 'custom') {
    if (!isDate_(String(from)) || !isDate_(String(to))) throw bad_('Choose a valid custom start and end date.');
    if (from > to) throw bad_('Start date must be on or before the end date.');
    if (dayList_(from, to).length > 366) throw bad_('Custom range is limited to 366 days.');
    return [from, to];
  }
  return [addDays_(t, -29), t];
}

function analyticsGet_(p) {
  const rk = ['today', '7d', '30d', 'month', 'custom'].indexOf(p.range) >= 0 ? p.range : '30d';
  const r = rangeDates_(rk, p.from, p.to), from = r[0], to = r[1];
  const f = { range: rk, from: from, to: to, category: String(p.category || ''), status: String(p.status || '') };
  const key = 'an:' + md5_(JSON.stringify(f));
  if (!p.force) { const c = cget_(key); if (c) return c; }

  const all = readTable_('MASTER_DATA').rows.filter(function (x) {
    return (!f.category || x.Category === f.category) && (!f.status || x.Status === f.status);
  });
  const tasks = readTable_('TASKS').rows.filter(function (t) { return !f.category || t.Category === f.category; });
  const day = function (s) { return String(s).slice(0, 10); };
  const inRange = all.filter(function (x) { const d = day(x['Created At']); return d >= from && d <= to; });

  const labels = dayList_(from, to), dayCount = {};
  inRange.forEach(function (x) { const d = day(x['Created At']); dayCount[d] = (dayCount[d] || 0) + 1; });

  // last 12 months ending at the end of the selected range
  const months = [];
  let m = to.slice(0, 7) + '-01';
  for (let i = 0; i < 12; i++) { months.unshift(m.slice(0, 7)); m = addMonths_(m, -1); }
  const monthCount = {};
  all.forEach(function (x) { const k = String(x['Created At']).slice(0, 7); monthCount[k] = (monthCount[k] || 0) + 1; });

  const tally = function (rows, field, order) {
    const c = {};
    (order || []).forEach(function (o) { c[o] = 0; });
    rows.forEach(function (x) { const v = x[field] || '(none)'; c[v] = (c[v] || 0) + 1; });
    let ks = Object.keys(c);
    if (!order) ks = ks.sort(function (a, b) { return c[b] - c[a]; });
    return { labels: ks, values: ks.map(function (k) { return c[k]; }) };
  };

  const created = {}, done = {};
  tasks.forEach(function (t) {
    const c = day(t['Created At']); created[c] = (created[c] || 0) + 1;
    if (t['Completed At']) { const d = day(t['Completed At']); done[d] = (done[d] || 0) + 1; }
  });

  let sum = 0, n = 0;
  inRange.forEach(function (x) { if (typeof x['Value / Amount'] === 'number') { sum += x['Value / Amount']; n++; } });
  const tasksDoneAll = tasks.filter(function (t) { return t.Status === 'Completed'; }).length;
  const rangeSum = function (obj) { return labels.reduce(function (a, d) { return a + (obj[d] || 0); }, 0); };

  const res = {
    filters: f, generatedAt: now_(),
    daily: { labels: labels, values: labels.map(function (d) { return dayCount[d] || 0; }) },
    monthly: { labels: months, values: months.map(function (k) { return monthCount[k] || 0; }) },
    category: tally(inRange, 'Category'),
    status: tally(inRange, 'Status', LISTS.DATA_STATUS),
    priority: tally(inRange, 'Priority', LISTS.PRIORITY),
    taskTrend: { labels: labels, created: labels.map(function (d) { return created[d] || 0; }), completed: labels.map(function (d) { return done[d] || 0; }) },
    summary: {
      recordsInRange: inRange.length, totalRecords: all.length, totalValue: Math.round(sum * 100) / 100,
      avgValue: n ? Math.round(sum / n * 100) / 100 : 0, tasksCreated: rangeSum(created), tasksCompleted: rangeSum(done),
      completionRate: tasks.length ? Math.round(tasksDoneAll / tasks.length * 100) : 0
    }
  };
  cput_(key, res, 60);
  return res;
}
