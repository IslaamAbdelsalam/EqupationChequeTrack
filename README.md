# ChequeTrack — Equpation Cheque Management System

ChequeTrack follows every company cheque from the request to bank clearance. It covers CFO approval with a locked exchange rate, Finance issuing, the requester confirming receipt and delivery, clearing or returns, reports and Telegram alerts.

## Features (v2)

- **Design:** Materio-style look (primary #8C57FF, light #F4F5FA background), a side menu with groups and sub-menus, English and Arabic (right-to-left). All dates show as dd/MM/yyyy, including chart labels and Telegram messages. In every list, the whole row is clickable: it highlights on hover and opens the cheque or the edit window.
- **Cheque workflow:** Pending CFO → Second approval (when needed) → Approved → Issued to requester → Received → With beneficiary → Cleared / Returned → Settled. Requests can be Rejected or Cancelled.
- **Roles:** Department User, Finance, CFO, Top Management, System Admin, Auditor (read-only). Duty rules: no one approves, issues or clears their own request or cheque.
- **Requests:** entity, operation type (supplier payment, financing instalment, final settlement, institutional instalment, payment on account), payment or guarantee, related party, line items with principal/profit, supporting document upload, partial payments, payment made before the request, urgent priority, duplicate warning.
- **Second approval:** above a USD limit (default 10,000), related parties, or payments made before the request.
- **Exchange rates (IAS 21):** the document-date rate is saved and locked at approval; the issue-day rate is saved when the payment currency differs; the clearing rate is saved with the realised FX difference. Rate alert when a new rate moves more than a set %.
- **Financing:** contracts register with remaining principal, extensions and history.
- **Banking:** banks, accounts per entity and currency, chequebooks with next free number, voided numbers.
- **Accounting:** journal entries built from each cheque (issue, revaluation and reversal, clearing, return, payment on account), with a "posted" mark and Excel export.
- **Dashboard and reports with charts:** open cheques by stage, approved vs cleared per month, due in the next 4 weeks, commitments by entity; reports for overview and cycle times, outstanding and revaluation, realised FX, due and ageing, by entity and currency, contracts, payments on account, payments before request.
- **Accounts:** email is required for every user; forgot password by email link (30 minutes, single use); optional two-step sign-in code by email; sign-in policy, lockout and idle sign-out; audit log.
- **Telegram:** daily digest and stage alerts (optional, can be hidden).
- **Upgrade:** an existing v1 database is upgraded in place on start-up (`Schema.cs`); old cheques are kept.

## Tech stack

- ASP.NET Core minimal APIs (.NET 9, rolls forward to newer runtimes)
- Entity Framework Core with Azure SQL / SQL Server (tables are created automatically)
- Cookie authentication, BCrypt password hashing, and ASP.NET Core Data Protection with keys stored in the database
- A single-page front end in `wwwroot/index.html`, with no build step

## Project structure

| File | Purpose |
|---|---|
| `Program.cs` | Startup, security headers, CSRF guard and API endpoints (`/api/me`, `/api/setup`, `/api/login`, `/api/state`, `/api/act`, `/api/cron/{key}`) |
| `Data.cs` | Entities and the EF Core context (`AppDb`) |
| `Logic.cs` | Settings, roles, password policy, exchange-rate maths, email sender, Telegram notifier and daily worker |
| `Schema.cs` | Adds the v2 tables and columns to an existing database |
| `wwwroot/index.html` | Page shell and styles |
| `wwwroot/js/` | `app.js` (shell, sign-in, menu), `pages.js` and `pages2.js` (screens), `charts.js` (SVG charts), `i18n.js` (Arabic) |
| `appsettings.json` | Configuration. The connection string comes from the environment. |

## Run locally

You need the .NET 9 SDK and SQL Server (LocalDB, Docker or Azure SQL).

```bash
export ConnectionStrings__ChequeDb="Server=localhost,1433;Database=ChequeDB;User Id=sa;Password=<your-password>;TrustServerCertificate=True"
dotnet run
```

Open the URL that is printed. On the first run, the setup screen creates the CFO account and the Management and Finance departments.

## Deploy to Azure App Service

```bash
dotnet publish -c Release -o out
cd out && zip -r ../app.zip . && cd ..
az webapp deploy -g <resource-group> -n <app-name> --src-path app.zip --type zip
```

App settings:

- `ConnectionStrings:ChequeDb`: use Microsoft Entra authentication with the web app's managed identity, so the connection string holds no password. For example: `Server=tcp:<server>.database.windows.net,1433;Database=ChequeDB;Authentication=Active Directory Default;Encrypt=True;`
- `CFO_RESET` (optional, one time): set a new value to reopen the "Create the CFO sign-in" screen. All other data is kept. Remove the setting afterwards, because each value works only once.

Email (for password reset and sign-in codes) is set by the System Admin in Settings › Email; the SMTP password is stored encrypted.

On the free plan the app sleeps when idle. To make sure the daily Telegram digest is sent, add the private **Daily alert wake-up link** (Setup › Telegram alerts) to an external scheduler such as cron-job.org, set to run every 30 minutes.

## Performance

- **Compressed answers:** server answers and scripts are compressed (Brotli or gzip). In tests, the data loaded after each action dropped from 434 KB to 27 KB.
- **Browser caching:** scripts are cached by the browser for a year. `index.html` raises `?v=` on each release, so a new version is still picked up at once.
- **Audit log on demand:** the audit log (up to 3,000 rows) loads only when the Audit page opens (`/api/audit`). It no longer comes with every page load.
- **Settings read from memory:** settings are kept in memory for 60 seconds and refreshed at once when saved, instead of being read from the database on every request.
- **Reused database connections:** database contexts are pooled.
- **Faster start-up:** the table and column checks run in 2 database round trips instead of about 95.
- **New index:** cheques now have an index on department.
- **Faster lists:** lists look records up by id instead of scanning, and search boxes redraw once typing pauses. Typing in a search box went from 12 full redraws to 1.
- **Keep the app awake:** on the free plan the web app sleeps when idle, and the first visit after that is slow. Add `https://<app>.azurewebsites.net/api/ping` to cron-job.org every 10 minutes. It does not touch the database, so it does not use Azure SQL free time.

## Security notes

- Never commit connection strings, bot tokens or passwords.
- Passwords are stored as BCrypt hashes, and changing a password signs out that user's existing sessions.
- POST requests to `/api` must include the `X-Requested-With: ChequeTrack` header (CSRF guard).
