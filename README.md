# naukri-refresh

Small scheduled script that keeps a Naukri profile looking recently updated and emails a short report after each run.

## What it actually does

1. Opens a saved Chromium profile (already logged into Naukri).
2. Reads the current **Profile Summary** text.
3. Toggles its final character — appends `.` if absent, removes it if present — and saves.
4. Re-reads the `Last updated` label from the homepage.
5. Opens the **Activity insights** tab and looks for `Search appearances` and `Recruiter actions` counts. If Naukri shows "No activities yet", the email says so.
6. Saves a screenshot + JSON line in `logs/`, then emails the report.

Nothing else on the profile is edited. The toggle alternates on every run.

## Why this exists

The `Last updated` date on a Naukri profile is visible to recruiters and can be used in recency sorts. This automates the refresh and reports whatever metrics Naukri exposes. It does **not** and cannot verify any resulting rank change — the report is what the jobseeker account can see, nothing more.

## Setup

Requires Node 20+.

```sh
npm install
npx playwright install chromium
cp .env.example .env
```

Fill `.env` (never commit it):

| Variable | Meaning |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Gmail address that created the App Password (sender) |
| `SMTP_PASS` | 16-character Gmail App Password |
| `MAIL_TO` | Inbox receiving the report |
| `NAUKRI_USER` | Naukri login email |
| `NAUKRI_PASS` | Naukri password (only used by login) |

To get a Gmail App Password: Google Account → Security → 2-Step Verification → App passwords (`myaccount.google.com/apppasswords`). Google Cloud Console OAuth is a different mechanism and is not used here.

Create the persistent login session once:

```sh
npm run login
```

A Chromium window opens; log in if needed. The session is stored in `profile/` and reused by later runs. If Naukri asks for OTP or shows a login page, the script emails a failure notice and stops — re-run `npm run login`.

## Run manually

```sh
npm run refresh
```

You should see the report printed, an email arrive, and a screenshot in `logs/`.

## Scheduling (Windows)

The repo does not include a scheduler file; use Windows Task Scheduler. Two daily tasks at 09:00 and 14:00 IST:

```powershell
$action = '"C:\path\to\node.exe" "C:\path\to\naukri-refresh\refresh.ts"'
schtasks /create /tn NaukriRefresh0900 /tr $action /sc daily /st 09:00 /it /f
schtasks /create /tn NaukriRefresh1400 /tr $action /sc daily /st 14:00 /it /f
```

`/it` runs only while the user is logged in (a locked desktop is fine). Keep power settings at "sleep: Never" and the machine awake. A missed run is not retried.

On Linux/macOS, use cron with the full path to `node`.

## Notes and limitations

- Headless Chromium gets an "Access Denied" page from Naukri's Akamai layer here, so the browser is launched **headed**. A desktop session is required.
- `Last updated` is day-granular on the jobseeker side ("today"/"yesterday"), so two daily runs may look identical there. The script still runs twice because the underlying modified timestamp may matter to recruiter-side sorts.
- If Naukri starts showing the Activity metrics, they are parsed by label text. If the labels change, the email falls back to "not found on page" and includes raw text — it never guesses a number.
- No CAPTCHA bypass, no credential storage in code, no retry loops. A failure emails once and stops.
- Check Spam for the first email from a new sender.

## License

MIT — use at your own risk; automated access may violate a site's terms.
