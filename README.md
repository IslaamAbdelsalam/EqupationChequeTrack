# ChequeTrack — Equpation Cheque Management System

ChequeTrack follows every company cheque from the request to bank clearance. It covers CFO approval with a locked exchange rate, Finance issuing, the requester confirming receipt and delivery, clearing or returns, reports and Telegram alerts.

## Features

- **Cheque workflow:** Pending CFO → Approved → Issued to requester → Received by requester → With beneficiary → Cleared / Returned → Solved. A request can also be Rejected or Cancelled.
- **Roles:** Department User, Finance Team, CFO, Top Management.
- **Exchange rates:** USD base with QAR and SDG. The rate is locked when the CFO approves and is used in every report.
- **Follow-up:** Due Payments, Smart Reports, CSV export, plus search, filters and paging on every list.
- **Beneficiaries:** English and Arabic names. A beneficiary can only be deleted if no cheque uses it.
- **Administration:** users, departments and a sign-in policy (length, complexity, expiry, lockout, idle timeout), plus an audit log.
- **Telegram:** a daily digest grouped by stage and instant stage messages. The CFO connects the bot in the app, and the token is stored encrypted.
- **Safe concurrent editing:** row versions stop two users from silently overwriting each other.
- **CFO reset:** a one-time reset of the CFO sign-in, triggered from Azure (see below).

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
| `Logic.cs` | Settings, roles, password policy, time zone, and the Telegram notifier and daily worker |
| `wwwroot/index.html` | The whole user interface |
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

On the free plan the app sleeps when idle. To make sure the daily Telegram digest is sent, add the private **Daily alert wake-up link** (CFO → Settings → General) to an external scheduler such as cron-job.org, set to run every 30 minutes.

## Security notes

- Never commit connection strings, bot tokens or passwords.
- Passwords are stored as BCrypt hashes, and changing a password signs out that user's existing sessions.
- POST requests to `/api` must include the `X-Requested-With: ChequeTrack` header (CSRF guard).
