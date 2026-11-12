# MasterSheet

Private, Google Sheets-powered personal dashboard (sheet library, data entry, analytics, tasks, notes & reminders, admin panel, automation, backups) with an installable phone/PC app launcher.

```
src/    Google Apps Script project (backend .gs + HTML UI)  -> runs on Google
docs/   PWA launcher (GitHub Pages)                         -> install button + opens your app
```

**How it fits together:** the real app and your data live in Google (Apps Script + your Google Sheet). GitHub Pages only hosts a tiny, public, data-free launcher page that makes MasterSheet installable on phone and PC and opens your private Apps Script URL. Nothing private is stored in this repo.

> Full feature list: `FEATURES.md` · Apps Script setup details: `src/README.md`

## 1. Put the backend on Google (once)
Follow `src/README.md`, or with clasp:
```bash
npm i -g @google/clasp && clasp login
cp .clasp.json.example .clasp.json     # put your scriptId (Apps Script > Project Settings)
clasp push                              # uploads src/ to Apps Script
```
Then in Apps Script: run `setupMasterSheet` once → Deploy → Web app (Execute as *User accessing the web app*, access *Anyone with a Google account*) → copy the `/exec` URL.

## 2. Publish the launcher on GitHub Pages
1. Create a GitHub repo (private or public) and push this folder to `main`.
2. Repo **Settings → Pages → Source: GitHub Actions** (the included workflow deploys `docs/`). Alternative: Source = *Deploy from a branch*, branch `main`, folder `/docs`.
3. Open `https://<your-username>.github.io/<repo>/`.
4. Paste your Apps Script `/exec` URL once (or put it in `docs/config.js` and commit so every device gets it).

## 3. Install on phone / PC
| Device | How |
|---|---|
| Android Chrome | open the Pages URL → **Install app** button (or ⋮ → Install app) |
| Windows / Mac / Linux Chrome or Edge | open the Pages URL → **Install app** button (or the install icon in the address bar) |
| iPhone / iPad | Safari → Share → **Add to Home Screen** |

The installed app opens straight into your dashboard. Sign in with the owner Google account.

## Honest limits
- Google blocks its sign-in page inside frames, so the launcher **navigates** to your Apps Script URL instead of embedding it. On some phones/desktops the installed window shows a small browser bar for the Google page; the dashboard itself works fully.
- The launcher works offline (it only shows the open/install screen); the dashboard needs internet.
- The app link is not secret, but the app is protected: anyone other than the owner gets "Access denied".
- Pages on a free private repo needs a paid GitHub plan; use a public repo (it contains no data or secrets) or deploy from a public repo.
