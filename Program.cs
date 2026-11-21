using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using ChequeTrack;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var cs = builder.Configuration.GetConnectionString("ChequeDb");
if (string.IsNullOrWhiteSpace(cs)) throw new InvalidOperationException("Connection string 'ChequeDb' is missing. Add it in Azure App Service > Environment variables > Connection strings.");

builder.Services.AddDbContext<AppDb>(o => o.UseSqlServer(cs, sql => sql.EnableRetryOnFailure(8, TimeSpan.FromSeconds(10), null)));
builder.Services.AddDataProtection().PersistKeysToDbContext<AppDb>().SetApplicationName("ChequeTrack");
builder.Services.AddSingleton<SettingsStore>();
builder.Services.AddHttpClient("tg", c => c.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddSingleton<Telegram>();
builder.Services.AddSingleton<Notifier>();
builder.Services.AddHostedService<DailyWorker>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "chq.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromHours(10);
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    var strategy = db.Database.CreateExecutionStrategy();
    await strategy.ExecuteAsync(async () => { await db.Database.EnsureCreatedAsync(); });

    // One-time CFO reset: set the app setting CFO_RESET to a new value in Azure.
    // Clears only the CFO's sign-in and reopens the setup screen; all other data is kept.
    var rsId = (app.Configuration["CFO_RESET"] ?? "").Trim();
    if (rsId.Length > 0)
    {
        var rsStore = scope.ServiceProvider.GetRequiredService<SettingsStore>();
        var rsSet = await rsStore.Get(db);
        if (rsSet.CfoResetDone != rsId && await db.Users.AnyAsync())
        {
            var rsCfo = await db.Users.Where(x => x.Role == Roles.CFO).OrderBy(x => x.Id).FirstOrDefaultAsync();
            if (rsCfo != null) { rsCfo.PwdHash = ""; rsCfo.Failed = 0; rsCfo.LockedUntilUtc = null; }
            rsSet.CfoResetDone = rsId;
            rsSet.CfoResetUser = rsCfo?.Id ?? 0;
            Log(db, rsSet, "Azure admin", "CFO reset requested", "SETUP", rsCfo == null ? "No CFO account found" : "CFO sign-in cleared for USR-" + rsCfo.Id);
            await rsStore.Save(db, rsSet);
        }
    }
}

app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["X-Frame-Options"] = "DENY";
    ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
    if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.Headers["Cache-Control"] = "no-store";
    // simple CSRF guard: API writes must come from our own page
    if (HttpMethods.IsPost(ctx.Request.Method) && ctx.Request.Path.StartsWithSegments("/api") && ctx.Request.Headers["X-Requested-With"] != "ChequeTrack")
    { ctx.Response.StatusCode = 400; await ctx.Response.WriteAsync("Bad request"); return; }
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

var J = new JsonSerializerOptions { PropertyNamingPolicy = null };
IResult Ok(object o) => Results.Json(o, J);
IResult Err(string m, int code = 400) => Results.Json(new { ok = false, error = m }, J, statusCode: code);

async Task<AppUser> CurrentUser(HttpContext ctx, AppDb db)
{
    var id = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!int.TryParse(id, out var uid)) return null;
    var u = await db.Users.FirstOrDefaultAsync(x => x.Id == uid);
    if (u == null || !u.Active) return null;
    var stamp = ctx.User.FindFirstValue("pwd");
    if (stamp == null || stamp != Stamp(u)) return null; // password changed → old sessions end
    return u;
}
string Stamp(AppUser u) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(u.PwdHash ?? ""))).Substring(0, 16);

string Forced(AppUser u, AppSettings s)
{
    if (u.MustChange) return "first";
    if (s.Policy.ExpiryDays > 0 && !string.IsNullOrEmpty(u.PwdChangedAt) && Clock.DaysUntil(s, u.PwdChangedAt) <= -s.Policy.ExpiryDays) return "expired";
    return null;
}

async Task SignIn(HttpContext ctx, AppUser u)
{
    var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, u.Id.ToString(CultureInfo.InvariantCulture)), new(ClaimTypes.Name, u.Username), new("pwd", Stamp(u)) };
    await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
}

void Log(AppDb db, AppSettings s, string user, string action, string entity, string details)
    => db.Audit.Add(new AuditEntry { At = Clock.Stamp(s), User = user ?? "", Action = action ?? "", Entity = entity ?? "", Details = Trunc(details, 1000) });
string Trunc(string v, int n) => v == null ? "" : (v.Length > n ? v.Substring(0, n) : v);

object PolicyView(Policy p) => new { minLen = p.MinLen, upper = p.Upper, digit = p.Digit, special = p.Special, expiryDays = p.ExpiryDays, maxAttempts = p.MaxAttempts, lockMinutes = p.LockMinutes, firstChange = p.FirstChange, sessionMin = p.SessionMin };
object UserView(AppUser u) => new { id = u.Id, username = u.Username, fullName = u.FullName, role = u.Role, deptId = u.DeptId };

// ---------- public / session endpoints ----------
app.MapGet("/api/me", async (HttpContext ctx, AppDb db, SettingsStore ss) =>
{
    var s = await ss.Get(db);
    var any = await db.Users.AnyAsync();
    var brand = new { company = s.Company, logo = s.Logo };
    if (!any || s.CfoResetUser >= 0) return Ok(new { setup = true, reset = any, brand });
    var u = await CurrentUser(ctx, db);
    if (u == null) return Ok(new { setup = false, user = (object)null, brand });
    return Ok(new { setup = false, user = UserView(u), forced = Forced(u, s), sessionMin = s.Policy.SessionMin, policy = PolicyView(s.Policy), brand });
});

app.MapPost("/api/setup", async (HttpContext ctx, AppDb db, SettingsStore ss, JsonElement b) =>
{
    var any = await db.Users.AnyAsync();
    var cur = await ss.Get(db);
    var reset = any && cur.CfoResetUser >= 0;
    if (any && !reset) return Err("Setup is already done.");
    var s = reset ? cur : new AppSettings();
    var company = Str(b, "company"); var full = Str(b, "fullName"); var un = Str(b, "username").ToLowerInvariant(); var pw = Str(b, "password", false);
    if ((!reset && company.Length < 2) || full.Length < 2) return Err("Company and full name are required.");
    if (!System.Text.RegularExpressions.Regex.IsMatch(un, "^[a-z0-9._-]{3,}$")) return Err("Username: at least 3 characters — letters, numbers, dot, dash or underscore.");
    var pe = Pwd.Check(pw, s.Policy); if (pe != null) return Err(pe);
    if (reset)
    {
        // Re-create the CFO sign-in only; departments, users, cheques and settings stay as they are
        var rid = s.CfoResetUser;
        if (await db.Users.AnyAsync(x => x.Username == un && x.Id != rid)) return Err("That username is already used by another account.");
        var cu = rid > 0 ? await db.Users.FirstOrDefaultAsync(x => x.Id == rid) : null;
        if (cu == null)
        {
            var dept = await db.Departments.OrderBy(d => d.Id).FirstOrDefaultAsync();
            if (dept == null) { dept = new Department { NameEn = "Finance", NameAr = "المالية" }; db.Departments.Add(dept); await db.SaveChangesAsync(); }
            cu = new AppUser { DeptId = dept.Id };
            db.Users.Add(cu);
        }
        cu.Username = un; cu.FullName = full; cu.Role = Roles.CFO; cu.Active = true; cu.MustChange = false; cu.Failed = 0; cu.LockedUntilUtc = null;
        cu.PwdHash = Pwd.Hash(pw); cu.PwdChangedAt = Clock.Today(s);
        s.CfoResetUser = -1;
        Log(db, s, full, "CFO account reset", "SETUP", "CFO sign-in re-created after a reset from Azure");
        await ss.Save(db, s);
        await SignIn(ctx, cu);
        return Ok(new { ok = true });
    }
    s.Company = company;
    s.CronKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    var tz = Str(b, "timeZone"); if (!string.IsNullOrEmpty(tz)) s.TimeZone = tz;
    await ss.Save(db, s);
    var mg = new Department { NameEn = "Management", NameAr = "الإدارة" };
    var fin = new Department { NameEn = "Finance", NameAr = "المالية" };
    db.Departments.AddRange(mg, fin);
    await db.SaveChangesAsync();
    var u = new AppUser { Username = un, FullName = full, Role = Roles.CFO, DeptId = fin.Id, PwdHash = Pwd.Hash(pw), PwdChangedAt = Clock.Today(s), Active = true };
    db.Users.Add(u);
    Log(db, s, full, "System set up", "SETUP", "First CFO account created");
    await db.SaveChangesAsync();
    await SignIn(ctx, u);
    return Ok(new { ok = true });
});

app.MapPost("/api/login", async (HttpContext ctx, AppDb db, SettingsStore ss, JsonElement b) =>
{
    var s = await ss.Get(db); var P = s.Policy;
    var un = Str(b, "username").ToLowerInvariant(); var pw = Str(b, "password", false);
    var u = await db.Users.FirstOrDefaultAsync(x => x.Username == un);
    if (u == null) { await Task.Delay(400); return Err("Invalid username or password."); }
    if (!u.Active) return Err("This account is disabled. Contact Top Management or the CFO.");
    if (u.LockedUntilUtc.HasValue && u.LockedUntilUtc > DateTime.UtcNow)
        return Err($"Account locked after {P.MaxAttempts} failed attempts. Try again in {Math.Ceiling((u.LockedUntilUtc.Value - DateTime.UtcNow).TotalMinutes)} min, or ask an admin to unlock it.");
    if (!Pwd.Verify(pw, u.PwdHash))
    {
        u.Failed++;
        if (u.Failed >= P.MaxAttempts)
        {
            u.LockedUntilUtc = DateTime.UtcNow.AddMinutes(P.LockMinutes); u.Failed = 0;
            Log(db, s, u.FullName, "Account locked", "USR-" + u.Id, P.MaxAttempts + " failed sign-in attempts");
            await db.SaveChangesAsync();
            return Err($"Too many failed attempts — account locked for {P.LockMinutes} minutes.");
        }
        await db.SaveChangesAsync();
        return Err($"Invalid username or password. {P.MaxAttempts - u.Failed} attempt(s) left before lock.");
    }
    u.Failed = 0; u.LockedUntilUtc = null; u.LastLogin = Clock.Stamp(s);
    Log(db, s, u.FullName, "Signed in", "USR-" + u.Id, "");
    await db.SaveChangesAsync();
    await SignIn(ctx, u);
    return Ok(new { ok = true, user = UserView(u), forced = Forced(u, s), sessionMin = P.SessionMin, policy = PolicyView(P) });
});

app.MapPost("/api/logout", async (HttpContext ctx, AppDb db, SettingsStore ss, JsonElement b) =>
{
    var u = await CurrentUser(ctx, db);
    if (u != null)
    {
        var s = await ss.Get(db);
        Log(db, s, u.FullName, Str(b, "reason") == "idle" ? "Session timed out" : "Signed out", "USR-" + u.Id, "");
        await db.SaveChangesAsync();
    }
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Ok(new { ok = true });
});

app.MapPost("/api/password", async (HttpContext ctx, AppDb db, SettingsStore ss, JsonElement b) =>
{
    var u = await CurrentUser(ctx, db); if (u == null) return Err("Please sign in again.", 401);
    var s = await ss.Get(db);
    var old = Str(b, "old", false); var nw = Str(b, "new", false);
    if (!Pwd.Verify(old, u.PwdHash)) return Err("Current password is not correct.");
    var pe = Pwd.Check(nw, s.Policy); if (pe != null) return Err(pe);
    if (Pwd.Verify(nw, u.PwdHash)) return Err("New password must be different from the current one.");
    u.PwdHash = Pwd.Hash(nw); u.MustChange = false; u.PwdChangedAt = Clock.Today(s);
    Log(db, s, u.FullName, "Password changed", "USR-" + u.Id, "");
    await db.SaveChangesAsync();
    await SignIn(ctx, u);
    return Ok(new { ok = true });
});

// ---------- state ----------
app.MapGet("/api/state", async (HttpContext ctx, AppDb db, SettingsStore ss) =>
{
    var u = await CurrentUser(ctx, db); if (u == null) return Err("Please sign in again.", 401);
    var s = await ss.Get(db);
    if (Forced(u, s) != null) return Err("Password change required.", 403);
    var admin = Roles.Admin(u.Role); var seeAll = Roles.SeeAll(u.Role);

    var cq = db.Cheques.AsNoTracking();
    if (!seeAll) cq = cq.Where(c => c.RequesterId == u.Id);
    var cheques = (await cq.OrderByDescending(c => c.Seq).ToListAsync()).Select(ChequeView).ToList();

    var users = await db.Users.AsNoTracking().OrderBy(x => x.FullName).ToListAsync();
    var uv = users.Select(x => admin
        ? (object)new { id = x.Id, username = x.Username, fullName = x.FullName, role = x.Role, deptId = x.DeptId, active = x.Active, mustChange = x.MustChange,
            lockedUntil = x.LockedUntilUtc.HasValue && x.LockedUntilUtc > DateTime.UtcNow ? x.LockedUntilUtc.Value.ToString("o") : null, pwdChangedAt = x.PwdChangedAt, lastLogin = x.LastLogin }
        : new { id = x.Id, fullName = x.FullName, role = x.Role, deptId = x.DeptId, active = x.Active }).ToList();

    var rates = (await db.Rates.AsNoTracking().OrderByDescending(r => r.Date).ToListAsync())
        .Select(r => new { id = r.Id, date = r.Date, QAR = r.QAR, SDG = r.SDG, setBy = r.SetBy, setAt = r.SetAt }).ToList();

    var tokenSet = !string.IsNullOrEmpty(ss.Token(s));
    var settings = new
    {
        alertDays = s.AlertDays, alertTime = s.AlertTime, telegramChannel = s.TelegramChannel, tokenSet,
        tgEvents = s.TgEvents, reportCurrency = s.ReportCurrency, company = s.Company, timeZone = s.TimeZone, logo = s.Logo, banks = s.Banks,
        cronUrl = u.Role == Roles.CFO ? $"https://{ctx.Request.Host}/api/cron/{s.CronKey}" : null,
        policy = new { minLen = s.Policy.MinLen, upper = s.Policy.Upper, digit = s.Policy.Digit, special = s.Policy.Special, expiryDays = s.Policy.ExpiryDays,
            maxAttempts = s.Policy.MaxAttempts, lockMinutes = s.Policy.LockMinutes, firstChange = s.Policy.FirstChange, sessionMin = s.Policy.SessionMin }
    };

    object audit = Array.Empty<object>();
    if (admin) audit = await db.Audit.AsNoTracking().OrderByDescending(a => a.Id).Take(3000)
        .Select(a => new { at = a.At, user = a.User, action = a.Action, entity = a.Entity, details = a.Details }).ToListAsync();

    object tgFeed = Array.Empty<object>(), alerts = Array.Empty<object>();
    if (seeAll)
    {
        tgFeed = await db.TgMessages.AsNoTracking().Where(m => m.Kind == "event").OrderByDescending(m => m.Id).Take(30)
            .Select(m => new { at = m.At, text = m.Text, sent = m.Sent, error = m.Error }).ToListAsync();
        alerts = await db.TgMessages.AsNoTracking().Where(m => m.Kind == "digest" && m.Count > 0).OrderByDescending(m => m.Id).Take(10)
            .Select(m => new { at = m.At, count = m.Count, ch = s.TelegramChannel, by = m.By, sent = m.Sent, error = m.Error }).ToListAsync();
    }

    return Ok(new
    {
        me = UserView(u), today = Clock.Today(s),
        departments = await db.Departments.AsNoTracking().OrderBy(d => d.Id).Select(d => new { id = d.Id, nameEn = d.NameEn, nameAr = d.NameAr }).ToListAsync(),
        users = uv,
        beneficiaries = await db.Beneficiaries.AsNoTracking().OrderBy(x => x.NameEn)
            .Select(x => new { id = x.Id, type = x.Type, nameEn = x.NameEn, nameAr = x.NameAr, contact = x.Contact, phone = x.Phone, email = x.Email }).ToListAsync(),
        benUse = await db.Cheques.AsNoTracking().GroupBy(c => c.BenId).Select(g => new { id = g.Key, n = g.Count() }).ToListAsync(),
        rates, settings, cheques, audit, tgFeed, alerts
    });
});

static object ChequeView(Cheque c) => new
{
    id = c.Id, requesterId = c.RequesterId, deptId = c.DeptId, benId = c.BenId, amount = c.Amount, currency = c.Currency, dueDate = c.DueDate,
    reason = c.Reason, status = c.Status, createdAt = c.CreatedAt,
    approval = c.ApprovedBy == null ? null : new { by = c.ApprovedBy, at = c.ApprovedAt, payCur = c.PayCur, payAmt = c.PayAmt, fx = c.FxId },
    cheque = c.ChequeNo == null ? null : new { no = c.ChequeNo, bank = c.Bank, date = c.ChequeDate, by = c.IssuedBy, at = c.IssuedAt },
    posted = c.IssuedBy == null ? null : new { by = c.IssuedBy, at = c.IssuedAt },
    received = c.ReceivedBy == null ? null : new { by = c.ReceivedBy, at = c.ReceivedAt },
    delivered = c.DeliveredBy == null ? null : new { by = c.DeliveredBy, at = c.DeliveredAt, to = c.DeliveredTo },
    closed = c.ClosedStatus == null ? null : new { status = c.ClosedStatus, by = c.ClosedBy, at = c.ClosedAt, reason = c.ClosedReason },
    solved = c.SolvedBy == null ? null : new { by = c.SolvedBy, at = c.SolvedAt, note = c.SolvedNote },
    rejected = c.RejectedBy == null ? null : new { by = c.RejectedBy, at = c.RejectedAt, reason = c.RejectReason }
};

// ---------- cron (for free-plan wake-up, e.g. cron-job.org) ----------
app.MapGet("/api/cron/{key}", async (string key, AppDb db, SettingsStore ss, Notifier nf) =>
{
    var s = await ss.Get(db);
    if (string.IsNullOrEmpty(s.CronKey) || !CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(key ?? ""), System.Text.Encoding.UTF8.GetBytes(s.CronKey)))
        return Results.NotFound();
    await nf.DailyIfDue(db);
    return Results.Text("ok");
});

// ---------- actions ----------
app.MapPost("/api/act", async (HttpContext ctx, AppDb db, SettingsStore ss, Notifier nf, Telegram tg, JsonElement b) =>
{
    var u = await CurrentUser(ctx, db); if (u == null) return Err("Please sign in again.", 401);
    var s = await ss.Get(db);
    if (Forced(u, s) != null) return Err("Password change required.", 403);
    var a = Str(b, "action");
    var me = u.FullName;
    try
    {
        switch (a)
        {
            // ----- cheque cycle -----
            case "submitReq":
            {
                var benId = Int(b, "benId"); var amt = Dec(b, "amount"); var cur = Str(b, "currency"); var due = Str(b, "dueDate"); var rsn = Str(b, "reason");
                if (!await db.Beneficiaries.AnyAsync(x => x.Id == benId)) return Err("Choose a beneficiary.");
                if (amt <= 0) return Err("Enter a valid amount.");
                if (!new[] { "USD", "QAR", "SDG" }.Contains(cur)) return Err("Choose a currency.");
                if (!Clock.ValidDate(due) || Clock.DaysUntil(s, due) < 0) return Err("Due date must be today or later.");
                if (rsn.Length < 2) return Err("Enter the reason.");
                for (var attempt = 0; attempt < 5; attempt++)
                {
                    var seq = (await db.Cheques.MaxAsync(c => (int?)c.Seq) ?? 0) + 1;
                    var c = new Cheque { Id = "CHQ-" + seq.ToString("0000", CultureInfo.InvariantCulture), Seq = seq, RequesterId = u.Id, DeptId = u.DeptId, BenId = benId, Amount = Math.Round(amt, 2), Currency = cur, DueDate = due, Reason = Trunc(rsn, 1000), Status = "Pending", CreatedAt = Clock.Stamp(s) };
                    db.Cheques.Add(c);
                    var ben = await db.Beneficiaries.FindAsync(benId);
                    Log(db, s, me, "Request created", c.Id, $"{Fmt.Money(c.Amount, cur)} to {ben?.NameEn}, due {due}");
                    try { await db.SaveChangesAsync(); return Ok(new { ok = true, id = c.Id }); }
                    catch (DbUpdateException) { db.ChangeTracker.Clear(); await Task.Delay(150 * (attempt + 1)); }
                }
                return Err("Could not save — please try again.");
            }
            case "cancelReq":
            {
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.Status != "Pending" || c.RequesterId != u.Id) return Err("Only your own pending requests can be cancelled.");
                c.Status = "Cancelled"; Log(db, s, me, "Cancelled", c.Id, "");
                return await Save(db, c.Id);
            }
            case "approve":
            {
                if (u.Role != Roles.CFO) return Err("Only the CFO can approve.", 403);
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.Status != "Pending") return Err($"{c.Id} was already {c.Status.ToLowerInvariant()} by someone else. The screen will refresh.");
                var r = await db.Rates.OrderByDescending(x => x.Date).FirstOrDefaultAsync();
                if (r == null) return Err("No exchange rate yet. Enter today's rate on the Exchange Rates page first.");
                var to = Str(b, "payCur"); if (!new[] { "USD", "QAR", "SDG" }.Contains(to)) to = c.Currency;
                decimal PerUsd(string k) => k == "USD" ? 1m : k == "QAR" ? r.QAR : r.SDG;
                var v = Math.Round(c.Amount / PerUsd(c.Currency) * PerUsd(to), 2);
                c.Status = "Approved"; c.ApprovedBy = me; c.ApprovedAt = Clock.Stamp(s); c.PayCur = to; c.PayAmt = v; c.FxId = r.Id;
                Log(db, s, me, "Approved", c.Id, $"Pay {Fmt.Money(v, to)} (requested {Fmt.Money(c.Amount, c.Currency)}) · {r.Id} locked");
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "approved", null, me); return res;
            }
            case "reject":
            {
                if (u.Role != Roles.CFO) return Err("Only the CFO can reject.", 403);
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.Status != "Pending") return Err($"{c.Id} is no longer pending.");
                var rs = Str(b, "reason"); if (rs.Length < 2) return Err("Enter a rejection reason.");
                c.Status = "Rejected"; c.RejectedBy = me; c.RejectedAt = Clock.Stamp(s); c.RejectReason = Trunc(rs, 500);
                Log(db, s, me, "Rejected", c.Id, rs);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "rejected", "reason: " + rs, me); return res;
            }
            case "issue":
            {
                if (!Roles.Finance(u.Role)) return Err("Only Finance or the CFO can issue cheques.", 403);
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.Status != "Approved") return Err($"{c.Id} is not waiting to be issued (now: {c.Status}).");
                var no = Str(b, "no"); var bank = Str(b, "bank"); var dt = Str(b, "date");
                if (no.Length < 1 || bank.Length < 2 || !Clock.ValidDate(dt)) return Err("Cheque number, bank and date are required.");
                var t = Clock.Stamp(s);
                c.Status = "Posted"; c.ChequeNo = Trunc(no, 50); c.Bank = Trunc(bank, 150); c.ChequeDate = dt; c.IssuedBy = me; c.IssuedAt = t;
                var req = await db.Users.FindAsync(c.RequesterId);
                Log(db, s, me, "Cheque issued", c.Id, $"#{no}, {bank}, dated {dt} → {req?.FullName}");
                if (!s.Banks.Contains(c.Bank, StringComparer.OrdinalIgnoreCase)) { s.Banks.Add(c.Bank); await ss.Save(db, s); }
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "issued", "to " + req?.FullName, me); return res;
            }
            case "receive":
            {
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.RequesterId != u.Id) return Err("Only the requester can confirm receipt.", 403);
                if (c.Status != "Posted") return Err("This cheque is not waiting for your receipt.");
                c.Status = "Received"; c.ReceivedBy = me; c.ReceivedAt = Clock.Stamp(s);
                Log(db, s, me, "Receipt confirmed", c.Id, "Requester received cheque");
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "received", "⏳ not yet with the beneficiary", me); return res;
            }
            case "deliver":
            {
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.RequesterId != u.Id) return Err("Only the requester can confirm delivery.", 403);
                if (c.Status != "Received") return Err("Confirm receipt first.");
                var to = Str(b, "to"); var dt = Str(b, "date"); if (!Clock.ValidDate(dt) || Clock.DaysUntil(s, dt) > 0) dt = Clock.Today(s);
                c.Status = "Delivered"; c.DeliveredBy = me; c.DeliveredAt = dt + " " + Clock.Now(s).ToString("HH:mm", CultureInfo.InvariantCulture); c.DeliveredTo = Trunc(to, 150);
                var ben = await db.Beneficiaries.FindAsync(c.BenId);
                Log(db, s, me, "Delivered to beneficiary", c.Id, (to.Length > 0 ? "Handed to " + to + " · " : "") + ben?.NameEn);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "delivered", (to.Length > 0 ? "handed to " + to + " · " : "") + "beneficiary will submit to bank", me); return res;
            }
            case "close":
            {
                if (!Roles.Finance(u.Role)) return Err("Only Finance or the CFO can clear or return cheques.", 403);
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.Status != "Delivered") return Err("Only cheques with the beneficiary can be cleared or returned.");
                if (Clock.DaysUntil(s, c.DueDate) > 0) return Err($"Can be cleared or returned from the due date ({c.DueDate}).");
                var st = Str(b, "status"); var rs = Str(b, "reason");
                if (st != "Cleared" && st != "Returned") return Err("Invalid status.");
                if (st == "Returned" && rs.Length < 2) return Err("Enter the return reason.");
                c.Status = st; c.ClosedStatus = st; c.ClosedBy = me; c.ClosedAt = Clock.Stamp(s); c.ClosedReason = Trunc(rs, 500);
                Log(db, s, me, "Marked " + st.ToLowerInvariant(), c.Id, rs);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, st.ToLowerInvariant(), rs.Length > 0 ? "reason: " + rs : null, me); return res;
            }
            case "solve":
            {
                if (!Roles.Finance(u.Role)) return Err("Only Finance or the CFO can mark solved.", 403);
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.Status != "Returned") return Err("Only returned cheques can be solved.");
                var n = Str(b, "note"); if (n.Length < 2) return Err("Describe how it was solved.");
                c.Status = "Solved"; c.SolvedBy = me; c.SolvedAt = Clock.Stamp(s); c.SolvedNote = Trunc(n, 500);
                Log(db, s, me, "Returned cheque solved", c.Id, n);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "solved", n, me); return res;
            }

            // ----- exchange rates -----
            case "saveRate":
            {
                if (!Roles.Finance(u.Role)) return Err("Only Finance or the CFO can set rates.", 403);
                var dt = Str(b, "date"); var q = Dec(b, "QAR"); var sd = Dec(b, "SDG");
                if (!Clock.ValidDate(dt) || Clock.DaysUntil(s, dt) > 0) return Err("Rate date can't be in the future.");
                if (q <= 0 || sd <= 0) return Err("Enter both rates.");
                var id = "FX-" + dt.Replace("-", "");
                if (await db.Cheques.AnyAsync(c => c.FxId == id)) return Err(id + " is already used by approved cheques — it cannot be changed.");
                var r = await db.Rates.FindAsync(id);
                if (r == null) db.Rates.Add(new Rate { Id = id, Date = dt, QAR = q, SDG = sd, SetBy = me, SetAt = Clock.Stamp(s) });
                else { r.QAR = q; r.SDG = sd; r.SetBy = me; r.SetAt = Clock.Stamp(s); }
                Log(db, s, me, "Set exchange rate", id, $"1 USD = {q.ToString(CultureInfo.InvariantCulture)} QAR, {sd.ToString(CultureInfo.InvariantCulture)} SDG");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }

            // ----- beneficiaries -----
            case "saveBen":
            {
                var id = Int(b, "id");
                if (id > 0 && !Roles.Bens(u.Role)) return Err("You can't edit beneficiaries.", 403);
                var en = Str(b, "nameEn"); if (en.Length < 2) return Err("English name is required.");
                var type = Str(b, "type"); if (!new[] { "Supplier", "Customer", "Employee", "Other" }.Contains(type)) type = "Other";
                Beneficiary x;
                if (id > 0) { x = await db.Beneficiaries.FindAsync(id); if (x == null) return Err("Not found."); }
                else { x = new Beneficiary(); db.Beneficiaries.Add(x); }
                x.Type = type; x.NameEn = Trunc(en, 200); x.NameAr = Trunc(Str(b, "nameAr"), 200); x.Contact = Trunc(Str(b, "contact"), 150); x.Phone = Trunc(Str(b, "phone"), 50); x.Email = Trunc(Str(b, "email"), 150);
                await db.SaveChangesAsync();
                Log(db, s, me, id > 0 ? "Beneficiary updated" : "Beneficiary added", "BEN-" + x.Id, en);
                await db.SaveChangesAsync(); return Ok(new { ok = true, id = x.Id });
            }
            case "delBen":
            {
                if (!Roles.Bens(u.Role)) return Err("You can't delete beneficiaries.", 403);
                var id = Int(b, "id");
                if (await db.Cheques.AnyAsync(c => c.BenId == id)) return Err("Linked to cheques — cannot delete.");
                var x = await db.Beneficiaries.FindAsync(id); if (x == null) return Err("Not found.");
                db.Beneficiaries.Remove(x); Log(db, s, me, "Beneficiary deleted", "BEN-" + id, x.NameEn);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }

            // ----- administration -----
            case "saveDept":
            {
                if (!Roles.Admin(u.Role)) return Err("Not allowed.", 403);
                var id = Int(b, "id"); var en = Str(b, "nameEn"); if (en.Length < 2) return Err("English name is required.");
                Department d;
                if (id > 0) { d = await db.Departments.FindAsync(id); if (d == null) return Err("Not found."); }
                else { d = new Department(); db.Departments.Add(d); }
                d.NameEn = Trunc(en, 150); d.NameAr = Trunc(Str(b, "nameAr"), 150);
                await db.SaveChangesAsync();
                Log(db, s, me, id > 0 ? "Department updated" : "Department added", "DEP-" + d.Id, en);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "saveUser":
            {
                if (!Roles.Admin(u.Role)) return Err("Not allowed.", 403);
                var id = Int(b, "id"); var full = Str(b, "fullName"); var un = Str(b, "username").ToLowerInvariant(); var role = Str(b, "role"); var dep = Int(b, "deptId");
                var active = Bool(b, "active"); var must = Bool(b, "mustChange"); var pw = Str(b, "password", false);
                if (full.Length < 2) return Err("Full name is required.");
                if (!System.Text.RegularExpressions.Regex.IsMatch(un, "^[a-z0-9._-]{3,}$")) return Err("Username: at least 3 characters — letters, numbers, dot, dash or underscore, no spaces.");
                if (!Roles.All.Contains(role)) return Err("Choose a role.");
                if (!await db.Departments.AnyAsync(d => d.Id == dep)) return Err("Choose a department.");
                if (await db.Users.AnyAsync(x => x.Id != id && x.Username == un)) return Err("This username is already taken.");
                if (id == u.Id && !active) return Err("You cannot disable your own account.");
                if (id == u.Id && role != u.Role) return Err("You cannot change your own role.");
                if (pw.Length > 0 || id == 0) { var pe = Pwd.Check(pw, s.Policy); if (pe != null) return Err(pe); }
                AppUser x;
                if (id > 0) { x = await db.Users.FindAsync(id); if (x == null) return Err("Not found."); }
                else { x = new AppUser(); db.Users.Add(x); }
                if (id > 0 && x.Role == Roles.CFO && role != Roles.CFO && !await db.Users.AnyAsync(y => y.Id != id && y.Role == Roles.CFO && y.Active))
                    return Err("At least one active CFO is required.");
                x.FullName = Trunc(full, 150); x.Username = un; x.Role = role; x.DeptId = dep; x.Active = active; x.MustChange = must;
                if (pw.Length > 0) { x.PwdHash = Pwd.Hash(pw); x.PwdChangedAt = Clock.Today(s); x.Failed = 0; x.LockedUntilUtc = null; }
                await db.SaveChangesAsync();
                var dn = (await db.Departments.FindAsync(dep))?.NameEn;
                Log(db, s, me, id > 0 ? "User updated" : "User created", "USR-" + x.Id, $"{full} · {role} · {dn}{(pw.Length > 0 && id > 0 ? " · password reset" : "")}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "unlockUser":
            {
                if (!Roles.Admin(u.Role)) return Err("Not allowed.", 403);
                var x = await db.Users.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                x.LockedUntilUtc = null; x.Failed = 0; Log(db, s, me, "Account unlocked", "USR-" + x.Id, x.FullName);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "saveSettings":
            {
                if (!Roles.Admin(u.Role)) return Err("Not allowed.", 403);
                var sec = Str(b, "section");
                if (sec == "alerts")
                {
                    var d = Int(b, "alertDays"); if (d < 1 || d > 90) return Err("Alert period must be 1–90 days.");
                    var t = Str(b, "alertTime"); if (!TimeSpan.TryParse(t, CultureInfo.InvariantCulture, out _)) return Err("Invalid time.");
                    s.AlertDays = d; s.AlertTime = t;
                    if (u.Role == Roles.CFO && b.TryGetProperty("tgEvents", out var ev) && ev.ValueKind == JsonValueKind.Object)
                        foreach (var p in ev.EnumerateObject()) s.TgEvents[p.Name] = p.Value.ValueKind == JsonValueKind.True;
                }
                else if (sec == "policy")
                {
                    var P = s.Policy;
                    P.MinLen = Math.Clamp(Int(b, "minLen"), 6, 32); P.ExpiryDays = Math.Clamp(Int(b, "expiryDays"), 0, 365);
                    P.Upper = Bool(b, "upper"); P.Digit = Bool(b, "digit"); P.Special = Bool(b, "special"); P.FirstChange = Bool(b, "firstChange");
                    P.MaxAttempts = Math.Clamp(Int(b, "maxAttempts"), 3, 10); P.LockMinutes = Math.Clamp(Int(b, "lockMinutes"), 1, 1440); P.SessionMin = Math.Clamp(Int(b, "sessionMin"), 5, 480);
                }
                else if (sec == "general")
                {
                    var c = Str(b, "company"); if (c.Length < 2) return Err("Company name is required.");
                    s.Company = Trunc(c, 150);
                    var rc = Str(b, "reportCurrency"); if (new[] { "USD", "QAR", "SDG" }.Contains(rc)) s.ReportCurrency = rc;
                    var tz = Str(b, "timeZone"); if (!string.IsNullOrEmpty(tz)) { try { TimeZoneInfo.FindSystemTimeZoneById(tz); s.TimeZone = tz; } catch { return Err("Unknown time zone."); } }
                    if (b.TryGetProperty("logo", out var lg) && lg.ValueKind == JsonValueKind.String)
                    {
                        var l = lg.GetString() ?? "";
                        if (l.Length > 400_000) return Err("Logo is too large (max about 250 KB).");
                        if (l.Length > 0 && !l.StartsWith("data:image/", StringComparison.Ordinal)) return Err("Logo must be an image.");
                        s.Logo = l;
                    }
                }
                else return Err("Unknown section.");
                await ss.Save(db, s);
                Log(db, s, me, "Settings changed", "SETTINGS", sec);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "tgConnect":
            {
                if (u.Role != Roles.CFO) return Err("Only the CFO manages Telegram.", 403);
                var ch = Str(b, "channel"); var tk = Str(b, "token");
                if (!System.Text.RegularExpressions.Regex.IsMatch(ch, @"^(@[A-Za-z0-9_]{4,}|-100\d{6,})$")) return Err("Channel must look like @channelname or -100…");
                if (tk.Length == 0) tk = ss.Token(s);
                if (!System.Text.RegularExpressions.Regex.IsMatch(tk ?? "", @"^\d{6,}:[A-Za-z0-9_-]{20,}$")) return Err("That does not look like a bot token (format 123456789:AA…).");
                var err = await tg.Send(tk, ch, $"✅ <b>ChequeTrack connected</b>\nAlerts for {Fmt.H(s.Company)} will be posted here.");
                if (err != null) return Err(err + " — check the token, the channel ID, and that the bot is an admin of the channel.");
                s.TelegramChannel = ch; ss.SetToken(s, tk); await ss.Save(db, s);
                Log(db, s, me, "Telegram connected", "SETTINGS", "Channel " + ch);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "tgDisconnect":
            {
                if (u.Role != Roles.CFO) return Err("Only the CFO manages Telegram.", 403);
                ss.SetToken(s, ""); await ss.Save(db, s); Log(db, s, me, "Telegram disconnected", "SETTINGS", ""); await db.SaveChangesAsync();
                return Ok(new { ok = true });
            }
            case "sendDigest":
            {
                if (!Roles.SeeAll(u.Role)) return Err("Not allowed.", 403);
                var err = await nf.SendDigest(db, s, me);
                if (err != null) return Err(err);
                Log(db, s, me, "Telegram digest sent", "ALERT", ""); await db.SaveChangesAsync();
                return Ok(new { ok = true });
            }
            default: return Err("Unknown action.");
        }
    }
    catch (DbUpdateConcurrencyException)
    {
        return Err("Someone else changed this record at the same moment. The screen will refresh — please check and try again.", 409);
    }
});

app.MapFallbackToFile("index.html");
app.Run();

// ---------- helpers ----------
static async Task<Cheque> Chq(AppDb db, JsonElement b) { var id = Str(b, "id"); return string.IsNullOrEmpty(id) ? null : await db.Cheques.FirstOrDefaultAsync(c => c.Id == id); }
static async Task<IResult> Save(AppDb db, string id)
{
    await db.SaveChangesAsync();
    return Results.Json(new { ok = true, id }, new JsonSerializerOptions { PropertyNamingPolicy = null });
}
static string Str(JsonElement b, string k, bool trim = true)
{
    if (b.ValueKind != JsonValueKind.Object || !b.TryGetProperty(k, out var v)) return "";
    var s = v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : "";
    return trim ? (s ?? "").Trim() : (s ?? "");
}
static int Int(JsonElement b, string k) => int.TryParse(Str(b, k), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : 0;
static decimal Dec(JsonElement b, string k) => decimal.TryParse(Str(b, k), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : 0m;
static bool Bool(JsonElement b, string k) => b.ValueKind == JsonValueKind.Object && b.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
