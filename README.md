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

## Security (v3.4)

**Secrets stay on the server**
- The Telegram bot token, SMTP password and alert-link key are read from environment variables when set (`TELEGRAM_BOT_TOKEN`, `SMTP_PASSWORD`, `CRON_KEY`). Otherwise they come from the values saved in Settings, which are encrypted with ASP.NET Data Protection.
- The browser only ever receives "set / not set". The alert link is shown masked. The full link is returned only by `/api/secret/cron`, to Telegram or Settings admins, and each view is written to the audit log.
- `appsettings.json` has no connection string. Put it in Azure App Service > Connection strings (`ChequeDb`).
- `.env`, `.env.*`, certificates and publish profiles are git-ignored. `.env.example` lists the variable names only.

**Input validation on every API call** (`Security.cs`)
- Only GET, HEAD and POST are accepted.
- POSTs must be JSON and must carry the `X-Requested-With: ChequeTrack` header (CSRF).
- Body size limits: 64 KB per call, 1 MB for settings, 72 MB for a request with attachments.
- JSON shape checks:
  - depth ≤ 10 and ≤ 5,000 fields;
  - field names must be plain identifiers;
  - strings up to 4,000 characters (file data and logo excepted);
  - no control or bidi-override characters;
  - numbers up to 30 digits.
- `/api/act` accepts only the known action names. Before any action code runs, every action checks:
  - cheque reference format;
  - real calendar dates;
  - month format;
  - number ranges;
  - non-negative whole ids.
- Query strings are limited to 2,048 characters, and each value to 300 printable characters.
- Sign-in, setup, two-step code and reset fields have length and format limits.

**Rate limiting** (built into ASP.NET Core, per signed-in user, or per IP when signed out)

| What | Limit |
|---|---|
| Sign-in, two-step code, setup, reset link | 10 a minute per IP (plus the account lock after failed attempts) |
| Forgot password | 5 per 15 minutes per IP |
| Saving (`/api/act`) | 60 a minute per user |
| Reading lists and pages | 180 a minute per user |
| Attachments | 60 a minute per user |
| Notification polling | 20 a minute per user |
| Daily alert link | 12 an hour |
| Every API call from one IP | 400 a minute |

A refused call gets `429` and a `Retry-After` header.

**Robots and heavy attacks**
- Known scanner tools (sqlmap, nikto, nuclei, …) get `403`.
- Probe paths (`/.env`, `/.git`, `/wp-admin`, `*.php`, path traversal, `<script>`, `union select`, …) get `404`.
- Repeated probes or rate-limit hits ban the IP for an hour. So does a flood of more than 300 requests in 10 seconds.
- API calls without a user agent are refused.
- `robots.txt` disallows everything, and API answers carry `X-Robots-Tag: noindex`.
- Kestrel limits protect against slow-client (slowloris) and oversize attacks:
  - header size and count;
  - minimum data rates;
  - 15-second header timeout;
  - maximum connections.
- Headers:
  - `Content-Security-Policy` (only this site's own scripts, plus Google Fonts);
  - HSTS and HTTPS redirect in production;
  - `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`;
  - Permissions-Policy and cross-origin isolation headers.
  - Downloads get a sandboxing CSP.
- The session cookie is `__Host-chq.auth`: HTTPS only, HttpOnly, SameSite=Strict. Tests over plain http need `ASPNETCORE_ENVIRONMENT=Development`.
- Client IPs come from Azure's `X-Forwarded-For`, using only the last hop, so a client cannot spoof its address.

**Row-level security (RLS) in SQL Server** (`Rls.cs`)
- Policy `rls.ChequePolicy` filters `Cheques`, `ChequeLines`, `Attachments` and `Comments` by the caller's scope:
  - `all`: every row;
  - `dept`: the user's department plus the user's own requests;
  - `own`: only the user's own requests.
- Every endpoint that returns cheque data runs inside `Rls.As(user, scope)`. An EF Core connection interceptor sets `SESSION_CONTEXT` on each connection it opens. So even a query that forgot its filter cannot return other people's rows.
- Background work and saving checks run as `sys` and see every row. Examples: next cheque number, duplicate checks, contract totals.
- It is installed at start-up. If it can't be installed, the app logs an error and still runs with the code checks. `SECURITY_RLS=off` removes it (rollback only).

**Pagination with cursors: no screen downloads a whole table**
- `/api/state` now sends:
  - the **working set**: open cheques plus those closed in the last 190 days, capped at 3,000;
  - the last 400 days of rates and the last 500 voided numbers;
  - posted-entry marks only for the cheques sent;
  - **server-computed totals** instead of full lists: contract usage (`kUse`), next free cheque number and usage per account and chequebook (`acctUse`, `bookUse`), and requests per department and entity (`deptUse`, `entUse`).
- Paged endpoints use keyset cursors (opaque, validated) and **fixed page sizes of 10, 25, 50 or 100**. Report and export loaders read 500 rows a request.
  - `GET /api/cheques?list=all|mine|appr|iss|fu|report&tab=&q=&ent=&cur=&from=&to=&op=&size=&cursor=`: tabs, search and filters run in SQL, and each tab count is a `COUNT` query.
  - `GET /api/cheque/{id}`: one cheque, for links to cheques outside the working set.
  - `GET /api/audit?q=&user=&from=&to=&size=&cursor=` and `GET /api/rates?from=&to=&size=&cursor=`.
  - `GET /api/voided?account=&size=&cursor=`.
- Every table in the app has paging and a filter.
  - Server-paged: cheque lists, audit log, exchange rates, voided numbers.
  - Paged on screen: reference tables (banks, accounts, chequebooks, beneficiaries, entities, departments, users, roles, contracts) and report tables.
- Reports, journal entries and payments on account load "open cheques plus everything since a date" (default: 1 January of last year, changeable on the page). They read it in pages of 500, capped at 20,000 rows.
- Exports read page by page: up to 10,000 cheques or 20,000 audit lines.

**Tests:** `tests/e2e_security.py` checks headers, validation, CSRF, paging and cursors, scope and RLS, bot blocking and the sign-in rate limit. Run it against a test server.

## What's new in v3.3

- **Notifications bell** in the top bar of every screen, with a red count. It opens a summary panel:
  - **Summary chips:** messages, to approve, to issue, to follow up, to confirm, contracts, missing rate, updates. Each chip opens its page.
  - **Needs your action:** each request reaches only the roles that act on it at its stage: first approval, second approval, issuing, clearing or return, settling, payment on account, the requester's receipt and delivery, contract follow-up and today's rate. Users see only the requests their role can see (own, department or all).
  - **New since you last looked:** what other people did on those requests (raised, approved, second approval, rejected, issued, received, delivered, cleared, returned, settled), newest first. Opening the bell marks them as seen on every device; actions stay until they are done.
- **On-screen alert** when something new arrives while the app is open (a new message, a request to approve, an update), and a short "Since your last visit" summary after signing in. The browser tab shows the count, e.g. "(3) ChequeTrack".
- **Background refresh without using Azure SQL free time:** open screens check `/api/pulse` every 30 seconds. It reads only a change number kept in memory, never the database; the data reloads only when something was saved. A form being typed in is never redrawn.
- New column `Users.NotifSeen`, added automatically at start-up. Test: `tests/e2e_notif.py`.

## What's new in v3.2

- **Messages on each request.** The requester, the CFO / Top Management and Finance can write to each other on the cheque page. Each message has a type (Query, Document change, Modification, Answer, Note) and goes to everyone on the request, the requester, the approvers, Finance or one named person. The **Messages** card shows from, to, when, the stage and the text. Unread messages addressed to you appear on the Home board under "Waiting for you" and in the menu count. Opening the request marks them as read. Stored in the new `dbo.Comments` table, which is created automatically at start-up.
- **Requests are linked to contracts.** Financing lines now pick the contract from the register for every requester, including roles that cannot open the contracts page. Each option shows its expiry date. The cheque page shows a **Linked contract** card.
- **Expired-contract warning that does not block.** If the contract has expired, or the request's due date is after the contract's expiry, the requester sees a warning and can choose **Submit anyway**. The same warning shows as a banner (and a short notice) every time the request is opened while it is still open.
- **iPhone fixes.**
  - The date fields add the slashes as you type (dd/MM/yyyy).
  - Tapping the calendar icon opens the iOS date picker.
  - Input text is 16 px on touch screens, so Safari does not zoom in.
  - The side menu scrolls to the end on phones, and the page behind it stays still.

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
