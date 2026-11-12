# MasterSheet

Google Sheets-powered personal dashboard: My Sheets library, Data Entry, Analytics, Tasks, Notes & Reminders, Admin Panel, Settings.
Google Sheets = database · Apps Script = backend · HTML Service = website.

## Files (create all of these in one Apps Script project)

| Script files (.gs) | HTML files | Manifest |
|---|---|---|
| Code, Config, Auth, Database, Dashboard, SheetLibrary, DataEntry, Analytics, Tasks, Notes, Reminders, Automation, Audit, Tests | Index, Styles, Scripts | appsscript.json |

In the editor, name HTML files exactly `Index`, `Styles`, `Scripts` (the editor adds `.html`).

---

## Quick start (Hinglish)

1. Nayi Google Sheet banao → **Extensions → Apps Script**.
2. Saari `.gs` files aur 3 HTML files banao, code paste karo. `appsscript.json` dikhane ke liye: Project Settings → "Show appsscript.json manifest file" ON, phir uska content replace karo.
3. Editor mein function **`setupMasterSheet`** select karke **Run** dabao → permissions Allow karo. **Yehi run aapko owner banata hai** aur sheet mein saare 10 tabs + headers + formatting apne aap ban jaate hain. Dubara run karne par data kabhi delete nahi hota.
4. **Deploy → New deployment → Web app**: Execute as = **User accessing the web app**, Who has access = **Anyone with a Google account**. Deploy karke URL kholo.
5. Website mein **Admin Panel → Automation Settings → Install / reinstall triggers** dabao (reminders, overdue check, backups ke liye).

---

## Detailed deployment

1. **Create the database sheet.** Open https://sheets.google.com, create a blank spreadsheet, name it e.g. "MasterSheet Database". Set **File → Settings → Time zone** to yours; the whole app uses this time zone.
2. **Open Apps Script** (Extensions → Apps Script). Delete the default `Code.gs` contents and paste the provided `Code.gs`. Add the other `.gs` files (+ → Script) and the three HTML files (+ → HTML).
3. **Manifest.** Replace `appsscript.json` with the provided one (scopes: Sheets, Drive, mail, triggers, user e-mail; web app executes as the accessing user).
4. **Run `setupMasterSheet`.** Approve the permission prompt. This (a) stores your Google account as the owner in Script Properties (`OWNER_EMAIL`), (b) creates tabs `SETTINGS, SHEET_LIBRARY, MASTER_DATA, TASKS, NOTES, REMINDERS, AUDIT_LOG, ACTIVITY_LOG, AUTOMATION_LOG, BACKUP_LOG` with headers, frozen header row and styling, (c) seeds default settings. Re-running only adds anything missing.
5. **Deploy as web app** (settings above). Open the URL while signed in with the owner account.
6. **Install triggers** from Admin Panel → Automation Settings, or from the sheet menu **MasterSheet → Install automation triggers** (reload the sheet once to see the menu).
7. **Check** by running `runSelfTests` in the editor and reading View → Logs / Execution log. Every line should say PASS.

### Updating later
After changing code: **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.** The URL stays the same.

### Changing the owner
Delete the `OWNER_EMAIL` property (Project Settings → Script properties), then run `setupMasterSheet` signed in as the new owner.

---

## Security model

- Deployment is **Execute as: User accessing the web app**, so Google verifies who is visiting. The server compares that verified e-mail with `OWNER_EMAIL` (stored in Script Properties, never in frontend code).
- The browser can call exactly one server function, `api()`. Every call re-checks the owner **before** any read or write. Hidden buttons are not relied on.
- Anyone else who opens the URL sees "Access denied" and cannot read or write anything.
- If Google cannot supply the visitor's e-mail, the request is rejected (`IDENTITY`), not allowed.
- Writes are protected with `LockService`; double submits are blocked with a per-form request id plus a 45-second fingerprint; values starting with `= + - @` are stored as text (formula-injection guard, also applied to CSV export); notes are rendered as escaped plain text.
- Deleting and editing keep full before/after copies in `AUDIT_LOG`. The audit log is never auto-deleted.
- Saving a Google Sheet link only stores the URL and metadata. **The linked spreadsheet's content is never read or imported.**

## Synchronisation (what is and isn't live)

The website reads the sheet periodically (default every 60 s, configurable in Settings, minimum 15 s, 0 = off), when you return to the tab, and immediately after each change you make on the site. **Edits made directly in Google Sheets appear on the next refresh – this is not instant.** Dashboard and analytics results are cached for ~60 s and the cache is cleared on every website write.

## Reminders & automation

- Time-driven triggers run **approximately**: Google may delay a run by a few minutes. Reminders are checked about every 5 minutes.
- E-mail reminders use `MailApp` (daily quota shown in Admin → Overview). Recipient = owner account, or the address set in System Settings.
- Each reminder occurrence has a unique key (`id|date|time`) saved **before** sending, so it can't be e-mailed twice. Failed sends are retried by the next run.
- **No browser push notifications** are provided (that needs a separate push architecture). The bell icon shows overdue items when the app is open.
- Jobs (toggle in Admin → Automation Settings): scheduled reminders, overdue-task detection (+ optional daily digest e-mail), dashboard summary refresh, scheduled backup, log cleanup. Every run is logged with time, result and error in `AUTOMATION_LOG`.

## Backups

Backup = full copy of the database spreadsheet into a Drive folder **MasterSheet Backups**. Manual (Admin → Backup Management), or scheduled every N days. Oldest beyond the retention count go to Drive trash. **Restore** replaces sheets, records, tasks, notes and reminders from the chosen backup after you type `RESTORE`; a "Pre-restore" safety backup of the current data is made first. Logs and settings are not overwritten.

## Configuration guide (Settings / Admin → System Settings)

| Setting | Meaning | Default |
|---|---|---|
| Default theme / device theme | dark or light (device choice saved in browser) | dark |
| Auto-refresh interval | seconds between page refreshes (0 = off, min 15) | 60 |
| Rows per page | Data Entry pagination | 25 |
| Categories | shared list; new categories typed in forms are added automatically | Personal, Work, Learning, Finance, Projects, Automation, Other |
| Dashboard widgets | Dashboard → Customize | all on |
| Reminder e-mail address | blank = owner | blank |
| Backups to keep / every N days | retention and schedule | 10 / 7 |
| Log retention days | activity + automation logs | 180 |

Time zone comes from the spreadsheet setting. Sheet tabs may be re-ordered or given extra columns to the right; headers are looked up by name. **Do not rename or delete header cells or the ID column.**

## Known limits

- Apps Script quotas apply (6 min/execution, mail quota, trigger runtime). The app reads whole tabs per request and caches results, which suits a personal workload (up to a few thousand rows per tab); test with your own volume, and archive old rows if it slows down.
- CSV import: up to 5 MB per file, sent in batches of 300 rows. Recognised columns: Entry Date, Category, Title, Description, Value/Amount, Status, Priority, Remarks (Title is required).
- Chart.js and Lucide icons load from public CDNs; the app needs internet access in the browser.

## Testing checklist

Automatic (`runSelfTests`, run from the editor – creates and removes its own temporary rows):
- [ ] Tabs and all headers exist
- [ ] Add sheet link · reject duplicate · reject invalid URL · edit link
- [ ] Add record · duplicate submission blocked · formula injection neutralised · update record
- [ ] Analytics and dashboard reflect new data · status filter works · empty date range returns zeros
- [ ] Task added, shows in Overdue, completed with timestamp
- [ ] Note saved and edited
- [ ] Reminder fires exactly once · recurring reminder advances its date
- [ ] Delete needs confirmation · audit copy kept · CSV import rejects bad rows
- [ ] (`runSelfTests(true)`) backup file created in Drive

Manual in the browser:
- [ ] Open the URL with a **different Google account** → "Access denied", no data visible
- [ ] Open in a private window / signed out → Google sign-in required
- [ ] Add, edit, delete a sheet link; open it in a new tab; copy URL; favorite + pin; Grid/List; sort; search
- [ ] Add record; submit twice quickly → second one rejected; edit; bulk delete with confirmation; CSV import/export; pagination
- [ ] Charts change after adding a record; try every range and the category/status filters; export a chart PNG
- [ ] Edit a cell directly in Google Sheets → appears after the next refresh / manual Refresh
- [ ] Task: create, complete, reopen, Kanban drag, Today/Upcoming/Overdue/Completed views
- [ ] Note: add, pin, copy, archive, delete; Reminder: create for 2–3 minutes ahead, wait for e-mail (trigger installed)
- [ ] Admin: Run a job now, view Audit Logs, create backup, restore (use a test copy first), toggle a job
- [ ] Layout at **320 px** width (browser dev-tools device mode): no horizontal scroll, bottom navigation + floating "+" button work, tables become cards
- [ ] Empty sheets: delete test data and confirm friendly empty states, no errors
- [ ] Large data: import ~5,000 rows via CSV in batches, check pagination and dashboard speed
- [ ] Failure recovery: turn off Wi-Fi briefly → sync pill shows "Offline – will retry", recovers on reconnect; error toasts explain how to retry
