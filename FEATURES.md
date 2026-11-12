# MasterSheet – Features

## Core
- Google Sheets is the database, Apps Script the backend, HTML Service the UI; works on mobile, tablet, desktop
- `setupMasterSheet()` creates 10 tabs with headers/formatting, never erases data, safe to re-run
- Dark / light theme, collapsible sidebar, global search, sync status pill, notification bell, toasts, loading skeletons, empty states, mobile bottom navigation + floating Quick Add

## Dashboard
- 8 KPI cards from real data: sheets, favorites, records, added today, pending / completed / overdue tasks, active reminders
- Quick-access favorites, recent entries, today's tasks, upcoming reminders, recent notes, latest activity, charts
- Date range filter (7/30/90 days), show/hide widgets, manual refresh, overdue banner

## My Sheets
- Add/edit/delete sheet links with category, description, tags, priority; URL validation and duplicate prevention
- Favorite, pin, open in new tab, copy URL, recently opened, search, category filter, sort (name/date/priority/recent), grid & list view, custom categories
- Link only – contents are never imported

## Data Entry
- Add/edit/delete records (date, category, title, description, value, status, priority, remarks, timestamps, unique IDs)
- Search, sort, filter by date/category/status, server-side pagination, bulk delete with confirmation
- CSV import (validated, row errors reported) and CSV export; duplicate-submission protection; formula-injection protection; responsive cards on mobile

## Analytics
- Daily line, monthly bar, category doughnut, status pie, task-completion area, priority bar
- Filters: today / 7 days / 30 days / this month / custom range, category, status
- Summary stats, PNG export per chart, auto + manual refresh, last-updated time, server-side aggregation with caching

## Tasks
- Add/edit/delete, complete/reopen, priority, start/due dates, statuses To Do / In Progress / Completed / On Hold
- Views: All, Today, Upcoming, Overdue, Completed; search and filters; list view and drag-and-drop Kanban

## Notes & Reminders
- Notes: card UI, pin, archive, copy, tags, category, search, safe plain text
- Reminders: one-time / daily / weekly / monthly, date + time, e-mail or in-app, upcoming and overdue lists, complete/reopen
- Scheduled e-mail via Apps Script triggers (approximate timing), no duplicate delivery

## Admin Panel
- Overview, manage sheets/records/tasks/notes/reminders (search, bulk delete), automation settings, audit logs, backup management, system settings
- Owner-only Google-account authentication enforced on every server call

## Automation, audit & backups
- Jobs: reminders, overdue detection (+ optional digest e-mail), dashboard summary refresh, scheduled backup, log cleanup; on/off switches; run-now buttons; install/remove triggers
- Automation log (time, result, duration, error), activity log, audit log with before/after copies of every edit and delete
- Manual and scheduled Drive backups with retention, restore (typed confirmation + automatic pre-restore backup)

## Reliability & security
- LockService for concurrent writes, batched sheet operations, CacheService with invalidation, quota-aware polling, consistent time zone, retry guidance on errors
- No public data endpoints, no hard-coded passwords, owner stored in Script Properties
- Built-in `runSelfTests()` (21 checks) and a manual testing checklist

## Install as an app
- PWA launcher (GitHub Pages): install button for Android, Windows/Mac/Linux Chrome & Edge, iPhone/iPad "Add to Home Screen"; installed app opens straight into the dashboard
