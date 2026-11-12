/**
 * MasterSheet – Config.gs
 * Central configuration: schema (tabs + headers + column types), lists, setting definitions.
 * Column types: text | date | datetime | time | number | bool
 */
const APP = {
  NAME: 'MasterSheet',
  SCHEMA_VERSION: 1,
  BACKUP_FOLDER: 'MasterSheet Backups'
};

const LISTS = {
  DATA_STATUS: ['Active', 'Pending', 'Completed', 'Archived'],
  TASK_STATUS: ['To Do', 'In Progress', 'Completed', 'On Hold'],
  PRIORITY: ['Low', 'Medium', 'High'],
  REPEAT: ['None', 'Daily', 'Weekly', 'Monthly'],
  CHANNEL: ['Email', 'In-App'],
  REMINDER_STATUS: ['Active', 'Sent', 'Completed'],
  CATEGORIES: ['Personal', 'Work', 'Learning', 'Finance', 'Projects', 'Automation', 'Other']
};

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

const SCHEMA = {
  SETTINGS: [['Key', 'text'], ['Value', 'text'], ['Description', 'text'], ['Updated At', 'datetime']],
  SHEET_LIBRARY: [['Sheet ID', 'text'], ['Name', 'text'], ['URL', 'text'], ['File Key', 'text'], ['Category', 'text'],
    ['Description', 'text'], ['Tags', 'text'], ['Priority', 'text'], ['Favorite', 'bool'], ['Pinned', 'bool'],
    ['Date Added', 'datetime'], ['Last Opened', 'datetime'], ['Last Updated', 'datetime']],
  MASTER_DATA: [['Record ID', 'text'], ['Entry Date', 'date'], ['Category', 'text'], ['Title', 'text'], ['Description', 'text'],
    ['Value / Amount', 'number'], ['Status', 'text'], ['Priority', 'text'], ['Remarks', 'text'],
    ['Created At', 'datetime'], ['Updated At', 'datetime']],
  TASKS: [['Task ID', 'text'], ['Task Name', 'text'], ['Description', 'text'], ['Category', 'text'], ['Priority', 'text'],
    ['Start Date', 'date'], ['Due Date', 'date'], ['Status', 'text'], ['Completed At', 'datetime'],
    ['Created At', 'datetime'], ['Updated At', 'datetime']],
  NOTES: [['Note ID', 'text'], ['Title', 'text'], ['Content', 'text'], ['Category', 'text'], ['Tags', 'text'],
    ['Pinned', 'bool'], ['Archived', 'bool'], ['Created At', 'datetime'], ['Updated At', 'datetime']],
  REMINDERS: [['Reminder ID', 'text'], ['Reminder Title', 'text'], ['Description', 'text'], ['Reminder Date', 'date'],
    ['Reminder Time', 'time'], ['Repeat Rule', 'text'], ['Notification Channel', 'text'], ['Status', 'text'],
    ['Last Sent At', 'datetime'], ['Last Occurrence Key', 'text'], ['Created At', 'datetime'], ['Updated At', 'datetime']],
  AUDIT_LOG: [['Log ID', 'text'], ['Timestamp', 'datetime'], ['User', 'text'], ['Module', 'text'], ['Action', 'text'],
    ['Record ID', 'text'], ['Before', 'text'], ['After', 'text']],
  ACTIVITY_LOG: [['Log ID', 'text'], ['Timestamp', 'datetime'], ['User', 'text'], ['Module', 'text'], ['Action', 'text'],
    ['Details', 'text']],
  AUTOMATION_LOG: [['Log ID', 'text'], ['Timestamp', 'datetime'], ['Job', 'text'], ['Result', 'text'],
    ['Duration (ms)', 'number'], ['Message', 'text']],
  BACKUP_LOG: [['Backup ID', 'text'], ['Timestamp', 'datetime'], ['Type', 'text'], ['File Name', 'text'],
    ['File ID', 'text'], ['File URL', 'text'], ['Status', 'text'], ['Message', 'text']]
};

const ID_COL = {
  SETTINGS: 'Key', SHEET_LIBRARY: 'Sheet ID', MASTER_DATA: 'Record ID', TASKS: 'Task ID', NOTES: 'Note ID',
  REMINDERS: 'Reminder ID', AUDIT_LOG: 'Log ID', ACTIVITY_LOG: 'Log ID', AUTOMATION_LOG: 'Log ID', BACKUP_LOG: 'Backup ID'
};

const ID_PREFIX = {
  SHEET_LIBRARY: 'SHT', MASTER_DATA: 'REC', TASKS: 'TSK', NOTES: 'NTE', REMINDERS: 'RMD',
  AUDIT_LOG: 'AUD', ACTIVITY_LOG: 'ACT', AUTOMATION_LOG: 'JOB', BACKUP_LOG: 'BKP'
};

/** Tabs that a backup restore overwrites (logs and settings are never overwritten). */
const RESTORE_TABS = ['SHEET_LIBRARY', 'MASTER_DATA', 'TASKS', 'NOTES', 'REMINDERS'];

/**
 * Setting definitions. group: user | system | automation | hidden
 */
const SETTING_DEFS = [
  { key: 'APP_NAME', label: 'Application name', type: 'text', def: 'MasterSheet', group: 'system', desc: 'Shown in the sidebar and browser title' },
  { key: 'DEFAULT_THEME', label: 'Default theme', type: 'select', options: ['dark', 'light'], def: 'dark', group: 'user', desc: 'Theme used when this browser has no saved choice' },
  { key: 'POLL_INTERVAL_SEC', label: 'Auto-refresh interval (seconds, 0 = off, minimum 15)', type: 'number', min: 0, max: 3600, def: '60', group: 'user', desc: 'Periodic refresh of the visible page. Not real-time.' },
  { key: 'PAGE_SIZE', label: 'Rows per page (Data Entry)', type: 'number', min: 10, max: 100, def: '25', group: 'user', desc: 'Pagination size' },
  { key: 'CATEGORIES', label: 'Categories (comma separated)', type: 'list', def: LISTS.CATEGORIES.join(', '), group: 'user', desc: 'Shared by sheets, records, tasks and notes' },
  { key: 'DASH_WIDGETS', label: 'Dashboard widgets', type: 'list', def: 'kpis,quick,favorites,entries,tasks,reminders,notes,activity,charts', group: 'hidden', desc: 'Visible dashboard widgets' },
  { key: 'REMINDER_EMAIL', label: 'Reminder e-mail address (blank = owner account)', type: 'text', def: '', group: 'system', desc: 'Recipient of reminder and digest e-mails' },
  { key: 'BACKUP_RETENTION', label: 'Backups to keep', type: 'number', min: 1, max: 50, def: '10', group: 'system', desc: 'Older backups are moved to Drive trash' },
  { key: 'BACKUP_EVERY_DAYS', label: 'Scheduled backup every N days', type: 'number', min: 1, max: 90, def: '7', group: 'system', desc: 'Used when the scheduled backup job is on' },
  { key: 'LOG_RETENTION_DAYS', label: 'Keep activity / automation logs (days)', type: 'number', min: 30, max: 3650, def: '180', group: 'system', desc: 'Audit log is never auto-deleted' },
  { key: 'JOB_REMINDERS', label: 'Scheduled reminders (checked about every 5 minutes)', type: 'bool', def: 'TRUE', group: 'automation', desc: 'Process due reminders' },
  { key: 'JOB_OVERDUE', label: 'Overdue task detection (hourly)', type: 'bool', def: 'TRUE', group: 'automation', desc: 'Counts overdue tasks and logs the result' },
  { key: 'OVERDUE_DIGEST_EMAIL', label: 'E-mail an overdue-task digest (max once a day)', type: 'bool', def: 'FALSE', group: 'automation', desc: 'Sent by the overdue detection job' },
  { key: 'JOB_SUMMARY', label: 'Dashboard summary refresh (hourly)', type: 'bool', def: 'TRUE', group: 'automation', desc: 'Warms the dashboard cache' },
  { key: 'JOB_BACKUP', label: 'Scheduled spreadsheet backup', type: 'bool', def: 'FALSE', group: 'automation', desc: 'Copies the whole database to Drive' },
  { key: 'JOB_LOG_CLEANUP', label: 'Log cleanup (daily)', type: 'bool', def: 'TRUE', group: 'automation', desc: 'Removes old activity and automation log rows' }
];
