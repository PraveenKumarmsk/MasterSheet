/**
 * MasterSheet – Auth.gs
 * Owner-only access using Google account identity.
 *
 * Deployment must be: Execute as "User accessing the web app", access "Anyone with a Google account".
 * Google then verifies the visitor's identity; every API call re-checks it against OWNER_EMAIL
 * (stored in Script Properties, never in frontend code).
 */

function assertOwner_(opts) {
  opts = opts || {};
  const props = PropertiesService.getScriptProperties();
  const owner = (props.getProperty('OWNER_EMAIL') || '').toLowerCase();
  const eff = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const act = (Session.getActiveUser().getEmail() || '').toLowerCase();

  if (!owner) {
    // First run only: whoever runs setupMasterSheet() from the editor becomes the owner.
    if (opts.firstRun && eff && (!act || act === eff)) {
      props.setProperty('OWNER_EMAIL', eff);
      return eff;
    }
    throw new Error('NOT_CONFIGURED');
  }
  if (eff !== owner) throw new Error('DENIED');
  if (act && act !== owner) throw new Error('DENIED');
  if (opts.web && !act) throw new Error('IDENTITY');
  return owner;
}

function currentUser_() {
  return (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase();
}

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function statusPage_(err) {
  const code = String(err && err.message ? err.message : err);
  let title = 'Something went wrong';
  let msg = code;
  if (code === 'NOT_CONFIGURED') {
    title = 'Setup required';
    msg = 'Open the Apps Script editor (or the spreadsheet menu "MasterSheet"), run setupMasterSheet() once while signed in as the owner, then reload this page.';
  } else if (code === 'DENIED') {
    title = 'Access denied';
    msg = 'This MasterSheet workspace is private and restricted to its owner account.';
  } else if (code === 'IDENTITY') {
    title = 'Identity could not be verified';
    msg = 'Re-deploy the web app with "Execute as: User accessing the web app" so Google can verify who you are.';
  }
  const html = '<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:12vh auto;padding:28px;' +
    'background:#111C30;color:#F8FAFC;border-radius:16px;border:1px solid #1F2D48">' +
    '<h2 style="margin:0 0 10px;color:#A5B4FC">' + escHtml_(title) + '</h2>' +
    '<p style="margin:0;color:#94A3B8;line-height:1.6">' + escHtml_(msg) + '</p></div>' +
    '<style>body{background:#0B1220;margin:0;padding:12px}</style>';
  return HtmlService.createHtmlOutput(html).setTitle('MasterSheet')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
