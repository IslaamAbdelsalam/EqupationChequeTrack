using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ChequeTrack;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var cs = builder.Configuration.GetConnectionString("ChequeDb");
if (string.IsNullOrWhiteSpace(cs)) throw new InvalidOperationException("Connection string 'ChequeDb' is missing. Add it in Azure App Service > Environment variables > Connection strings.");

builder.Services.AddDbContextPool<AppDb>(o => o.UseSqlServer(cs, sql => sql.EnableRetryOnFailure(8, TimeSpan.FromSeconds(10), null)));
// Speed: compress API answers and scripts (the state JSON shrinks to about a tenth)
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
    o.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[] { "image/svg+xml" });
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.AddDataProtection().PersistKeysToDbContext<AppDb>().SetApplicationName("ChequeTrack");
builder.Services.AddSingleton<SettingsStore>();
builder.Services.AddHttpClient("tg", c => c.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddSingleton<Telegram>();
builder.Services.AddSingleton<Notifier>();
builder.Services.AddSingleton<Mailer>();
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
app.UseResponseCompression();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    var store = scope.ServiceProvider.GetRequiredService<SettingsStore>();
    var startLog = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    var strategy = db.Database.CreateExecutionStrategy();
    await strategy.ExecuteAsync(async () => { await db.Database.EnsureCreatedAsync(); });
    await strategy.ExecuteAsync(async () => { await Schema.Upgrade(db, store, startLog); });

    // One-time CFO reset: set the app setting CFO_RESET to a new value in Azure.
    // Clears only the CFO's sign-in and reopens the setup screen; all other data is kept.
    var rsId = (app.Configuration["CFO_RESET"] ?? "").Trim();
    if (rsId.Length > 0)
    {
        var rsSet = await store.Get(db);
        if (rsSet.CfoResetDone != rsId && await db.Users.AnyAsync())
        {
            var rsCfo = await db.Users.Where(x => x.Role == Roles.CFO).OrderBy(x => x.Id).FirstOrDefaultAsync();
            if (rsCfo != null) { rsCfo.PwdHash = ""; rsCfo.Failed = 0; rsCfo.LockedUntilUtc = null; }
            rsSet.CfoResetDone = rsId;
            rsSet.CfoResetUser = rsCfo?.Id ?? 0;
            Log(db, rsSet, "Azure admin", "CFO reset requested", "SETUP", rsCfo == null ? "No CFO account found" : "CFO sign-in cleared for USR-" + rsCfo.Id);
            await store.Save(db, rsSet);
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
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = c =>
    {
        var h = c.Context.Response.Headers;
        if (c.File.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) h["Cache-Control"] = "no-cache";
        else if (c.Context.Request.Query.ContainsKey("v")) h["Cache-Control"] = "public,max-age=31536000,immutable"; // versioned: index.html changes ?v= on each release
        else h["Cache-Control"] = "public,max-age=86400";
    }
});
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
string Stamp(AppUser u) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(u.PwdHash ?? ""))).Substring(0, 16);

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

// Access comes from the user's role (Roles & permissions). Until some active user has a role that manages
// users and roles, the CFO keeps that job, as before.
async Task<List<Role>> AllRoles(AppDb db) => await db.Roles.AsNoTracking().ToListAsync();
async Task<bool> AnyAdmin(AppDb db, List<Role> roles)
{
    var keys = roles.Where(r => Perm.IsAdmin(Perm.Parse(r.Perms))).Select(r => r.Key).ToList();
    return keys.Count > 0 && await db.Users.AnyAsync(x => x.Active && keys.Contains(x.Role));
}
async Task<Access> AccessOf(AppDb db, AppUser u) { var roles = await AllRoles(db); return Access.Of(u, roles, await AnyAdmin(db, roles)); }

string BaseUrl(HttpContext ctx)
{
    var host = ctx.Request.Host.Value ?? "";
    var local = host.StartsWith("localhost", StringComparison.OrdinalIgnoreCase) || host.StartsWith("127.0.0.1", StringComparison.Ordinal);
    return (local ? ctx.Request.Scheme : "https") + "://" + host;
}

object PolicyView(Policy p) => new { minLen = p.MinLen, upper = p.Upper, digit = p.Digit, special = p.Special, expiryDays = p.ExpiryDays, maxAttempts = p.MaxAttempts, lockMinutes = p.LockMinutes, firstChange = p.FirstChange, sessionMin = p.SessionMin };
object UserView(AppUser u, Access a) => new { id = u.Id, username = u.Username, fullName = u.FullName, fullNameAr = u.FullNameAr ?? "", role = u.Role, deptId = u.DeptId, email = u.Email ?? "", lang = string.IsNullOrEmpty(u.Lang) ? "en" : u.Lang, isAdmin = Perm.IsAdmin(a.P), perms = Perm.View(a.P), scope = a.Scope };

async Task<string> SendReset(AppDb db, AppSettings s, Mailer mail, AppUser x, string baseUrl)
{
    if (string.IsNullOrWhiteSpace(x.Email)) return "This user has no email.";
    if (!Mailer.Ready(s)) return "Email is not set up yet (Settings › Email).";
    var since = DateTime.UtcNow.AddHours(-1);
    if (await db.PwdResets.CountAsync(r => r.UserId == x.Id && r.CreatedUtc > since) >= 5) return "Too many reset emails in the last hour. Try again later.";
    var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    db.PwdResets.Add(new PwdReset { UserId = x.Id, TokenHash = Sha(token), CreatedUtc = DateTime.UtcNow, ExpUtc = DateTime.UtcNow.AddMinutes(30) });
    await db.SaveChangesAsync();
    var ar = x.Lang == "ar"; var link = baseUrl + "/#reset=" + token;
    var html = ar
        ? Mailer.Layout(true, "إعادة تعيين كلمة المرور", $"<p>مرحباً {Fmt.H(Fmt.First(string.IsNullOrWhiteSpace(x.FullNameAr) ? x.FullName : x.FullNameAr))}،</p><p>وصلنا طلب لإعادة تعيين كلمة مرورك في ChequeTrack.</p><p style=\"color:#666;font-size:13px\">الرابط يعمل مرة واحدة وتنتهي صلاحيته بعد 30 دقيقة. إن لم تطلب ذلك فتجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.</p>", "تعيين كلمة مرور جديدة", link)
        : Mailer.Layout(false, "Reset your password", $"<p>Hello {Fmt.H(Fmt.First(x.FullName))},</p><p>We received a request to reset your ChequeTrack password.</p><p style=\"color:#666;font-size:13px\">This link works once and expires in 30 minutes. If you did not ask for it, ignore this email and your password stays the same.</p>", "Set a new password", link);
    return await mail.Send(s, x.Email, ar ? "إعادة تعيين كلمة مرور ChequeTrack" : "Reset your ChequeTrack password", html);
}

// ---------- public / session endpoints ----------
app.MapGet("/api/me", async (HttpContext ctx, AppDb db, SettingsStore ss) =>
{
    var s = await ss.Get(db);
    var any = await db.Users.AnyAsync();
    var brand = new { company = s.Company, logo = s.Logo, mail = Mailer.Ready(s) };
    if (!any || s.CfoResetUser >= 0) return Ok(new { setup = true, reset = any, brand, policy = PolicyView(s.Policy) });
    var u = await CurrentUser(ctx, db);
    if (u == null) return Ok(new { setup = false, user = (object)null, brand, policy = PolicyView(s.Policy) });
    return Ok(new { setup = false, user = UserView(u, await AccessOf(db, u)), forced = Forced(u, s), sessionMin = s.Policy.SessionMin, policy = PolicyView(s.Policy), brand });
});

app.MapPost("/api/setup", async (HttpContext ctx, AppDb db, SettingsStore ss, JsonElement b) =>
{
    var any = await db.Users.AnyAsync();
    var cur = await ss.Get(db);
    var reset = any && cur.CfoResetUser >= 0;
    if (any && !reset) return Err("Setup is already done.");
    var s = reset ? cur : new AppSettings();
    var company = Str(b, "company"); var full = Str(b, "fullName"); var fullAr = Trunc(Str(b, "fullNameAr"), 150); var un = Str(b, "username").ToLowerInvariant(); var pw = Str(b, "password", false);
    var email = Str(b, "email").ToLowerInvariant(); var lang = Str(b, "lang") == "ar" ? "ar" : "en";
    if ((!reset && company.Length < 2) || full.Length < 2) return Err("Company and full name are required.");
    if (!Regex.IsMatch(un, "^[a-z0-9._-]{3,}$")) return Err("Username: at least 3 characters — letters, numbers, dot, dash or underscore.");
    if (!ValidEmail(email)) return Err("Enter a valid email. It is used to reset the password.");
    var pe = Pwd.Check(pw, s.Policy); if (pe != null) return Err(pe);
    if (reset)
    {
        // Re-create the CFO sign-in only; departments, users, cheques and settings stay as they are
        var rid = s.CfoResetUser;
        if (await db.Users.AnyAsync(x => x.Username == un && x.Id != rid)) return Err("That username is already used by another account.");
        if (await db.Users.AnyAsync(x => x.Email == email && x.Id != rid)) return Err("That email is already used by another account.");
        var cu = rid > 0 ? await db.Users.FirstOrDefaultAsync(x => x.Id == rid) : null;
        if (cu == null)
        {
            var dept = await db.Departments.OrderBy(d => d.Id).FirstOrDefaultAsync();
            if (dept == null) { dept = new Department { NameEn = "Finance", NameAr = "المالية" }; db.Departments.Add(dept); await db.SaveChangesAsync(); }
            cu = new AppUser { DeptId = dept.Id };
            db.Users.Add(cu);
        }
        cu.Username = un; cu.FullName = full; if (fullAr.Length > 0) cu.FullNameAr = fullAr; cu.Email = email; cu.Lang = lang; cu.Role = Roles.CFO; cu.Active = true; cu.MustChange = false; cu.Failed = 0; cu.LockedUntilUtc = null;
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
    var u = new AppUser { Username = un, FullName = full, FullNameAr = fullAr, Email = email, Lang = lang, Role = Roles.CFO, DeptId = fin.Id, PwdHash = Pwd.Hash(pw), PwdChangedAt = Clock.Today(s), Active = true };
    db.Users.Add(u);
    Log(db, s, full, "System set up", "SETUP", "First CFO account created");
    await db.SaveChangesAsync();
    await SignIn(ctx, u);
    return Ok(new { ok = true });
});

app.MapPost("/api/login", async (HttpContext ctx, AppDb db, SettingsStore ss, Mailer mail, IDataProtectionProvider dp, JsonElement b) =>
{
    var s = await ss.Get(db); var P = s.Policy;
    var un = Str(b, "username").ToLowerInvariant(); var pw = Str(b, "password", false);
    var u = await db.Users.FirstOrDefaultAsync(x => x.Username == un);
    if (u == null) { await Task.Delay(400); return Err("Invalid username or password."); }
    if (!u.Active) return Err("This account is disabled. Contact the System Admin.");
    if (u.LockedUntilUtc.HasValue && u.LockedUntilUtc > DateTime.UtcNow)
        return Err($"Account locked after {P.MaxAttempts} failed attempts. Try again in {Math.Ceiling((u.LockedUntilUtc.Value - DateTime.UtcNow).TotalMinutes)} min, or ask the System Admin to unlock it.");
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
    u.Failed = 0; u.LockedUntilUtc = null;
    if (u.TwoFa)
    {
        // two-step verification: a 6-digit code sent to the user's email
        if (string.IsNullOrWhiteSpace(u.Email) || !Mailer.Ready(s)) return Err("Two-step verification needs email, which is not set up. Ask the System Admin.");
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("000000", CultureInfo.InvariantCulture);
        u.TwoFaHash = Sha(u.Id + ":" + code); u.TwoFaExpUtc = DateTime.UtcNow.AddMinutes(10); u.TwoFaTries = 0;
        await db.SaveChangesAsync();
        var ar = u.Lang == "ar";
        var html = ar
            ? Mailer.Layout(true, "رمز الدخول", $"<p>رمز الدخول إلى ChequeTrack:</p><p style=\"font-size:28px;font-weight:700;letter-spacing:6px\">{code}</p><p style=\"color:#666;font-size:13px\">صالح لمدة 10 دقائق. إن لم تحاول الدخول فغيّر كلمة مرورك.</p>")
            : Mailer.Layout(false, "Your sign-in code", $"<p>Your ChequeTrack sign-in code:</p><p style=\"font-size:28px;font-weight:700;letter-spacing:6px\">{code}</p><p style=\"color:#666;font-size:13px\">It is valid for 10 minutes. If you did not try to sign in, change your password.</p>");
        var err = await mail.Send(s, u.Email, ar ? "رمز الدخول إلى ChequeTrack" : "Your ChequeTrack sign-in code", html);
        if (err != null) return Err(err);
        var ticket = dp.CreateProtector("ChequeTrack.2fa.v1").Protect(u.Id + "|" + DateTime.UtcNow.AddMinutes(10).Ticks.ToString(CultureInfo.InvariantCulture));
        return Ok(new { ok = true, twofa = true, ticket, email = Mask(u.Email) });
    }
    u.LastLogin = Clock.Stamp(s);
    Log(db, s, u.FullName, "Signed in", "USR-" + u.Id, "");
    await db.SaveChangesAsync();
    await SignIn(ctx, u);
    return Ok(new { ok = true, user = UserView(u, await AccessOf(db, u)), forced = Forced(u, s), sessionMin = P.SessionMin, policy = PolicyView(P) });
});

app.MapPost("/api/login2", async (HttpContext ctx, AppDb db, SettingsStore ss, IDataProtectionProvider dp, JsonElement b) =>
{
    var s = await ss.Get(db);
    string raw;
    try { raw = dp.CreateProtector("ChequeTrack.2fa.v1").Unprotect(Str(b, "ticket")); } catch { return Err("This sign-in has expired. Sign in again."); }
    var parts = raw.Split('|');
    if (parts.Length != 2 || !int.TryParse(parts[0], out var uid) || !long.TryParse(parts[1], out var ticks) || new DateTime(ticks, DateTimeKind.Utc) < DateTime.UtcNow)
        return Err("This sign-in has expired. Sign in again.");
    var u = await db.Users.FirstOrDefaultAsync(x => x.Id == uid);
    if (u == null || !u.Active || !u.TwoFaExpUtc.HasValue || u.TwoFaExpUtc < DateTime.UtcNow) return Err("The code has expired. Sign in again.");
    if (u.TwoFaTries >= 5) return Err("Too many wrong codes. Sign in again.");
    var code = Regex.Replace(Str(b, "code"), "[^0-9]", "");
    if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(Sha(u.Id + ":" + code)), Encoding.UTF8.GetBytes(u.TwoFaHash ?? "")))
    {
        u.TwoFaTries++; await db.SaveChangesAsync();
        return Err("That code is not correct.");
    }
    u.TwoFaHash = ""; u.TwoFaExpUtc = null; u.TwoFaTries = 0; u.LastLogin = Clock.Stamp(s);
    Log(db, s, u.FullName, "Signed in (two-step)", "USR-" + u.Id, "");
    await db.SaveChangesAsync();
    await SignIn(ctx, u);
    return Ok(new { ok = true });
});

app.MapPost("/api/forgot", async (HttpContext ctx, AppDb db, SettingsStore ss, Mailer mail, JsonElement b) =>
{
    var s = await ss.Get(db);
    var email = Str(b, "email").ToLowerInvariant();
    if (!Mailer.Ready(s)) return Err("Password reset by email is not set up yet. Ask the System Admin.");
    // Same answer whatever the email, so nobody can find out which emails have accounts.
    if (ValidEmail(email))
    {
        var x = await db.Users.FirstOrDefaultAsync(y => y.Email == email && y.Active);
        if (x != null)
        {
            var err = await SendReset(db, s, mail, x, BaseUrl(ctx));
            Log(db, s, x.FullName, "Password reset requested", "USR-" + x.Id, err ?? "email sent");
            await db.SaveChangesAsync();
        }
        else await Task.Delay(300);
    }
    return Ok(new { ok = true });
});

app.MapPost("/api/reset", async (HttpContext ctx, AppDb db, SettingsStore ss, JsonElement b) =>
{
    var s = await ss.Get(db);
    var token = Str(b, "token"); var pw = Str(b, "password", false);
    if (token.Length < 20) return Err("This reset link is not valid.");
    var h = Sha(token);
    var r = await db.PwdResets.FirstOrDefaultAsync(x => x.TokenHash == h);
    if (r == null || r.UsedUtc.HasValue || r.ExpUtc < DateTime.UtcNow) return Err("This reset link has expired or was already used. Ask for a new one.");
    var u = await db.Users.FirstOrDefaultAsync(x => x.Id == r.UserId);
    if (u == null || !u.Active) return Err("This account is disabled.");
    if (Str(b, "check") == "1") return Ok(new { ok = true, name = Fmt.First(u.FullName), nameAr = string.IsNullOrWhiteSpace(u.FullNameAr) ? "" : Fmt.First(u.FullNameAr) });
    var pe = Pwd.Check(pw, s.Policy); if (pe != null) return Err(pe);
    u.PwdHash = Pwd.Hash(pw); u.MustChange = false; u.PwdChangedAt = Clock.Today(s); u.Failed = 0; u.LockedUntilUtc = null;
    r.UsedUtc = DateTime.UtcNow;
    foreach (var o in await db.PwdResets.Where(x => x.UserId == u.Id && x.UsedUtc == null).ToListAsync()) o.UsedUtc = DateTime.UtcNow;
    Log(db, s, u.FullName, "Password reset by email", "USR-" + u.Id, "");
    await db.SaveChangesAsync();
    await SignIn(ctx, u);
    return Ok(new { ok = true });
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
    var roles = await AllRoles(db);
    var anyAdmin = await AnyAdmin(db, roles);
    var A = Access.Of(u, roles, anyAdmin);

    // cheques the role may see: all, the user's department (and own), or only own requests
    var cq = db.Cheques.AsNoTracking();
    var myId = u.Id; var myDept = u.DeptId;
    if (A.Scope == "dept") cq = cq.Where(c => c.DeptId == myDept || c.RequesterId == myId);
    else if (A.Scope != "all") cq = cq.Where(c => c.RequesterId == myId);
    var chq = await cq.OrderByDescending(c => c.Seq).ToListAsync();
    var ids = chq.Select(c => c.Id).ToList();
    var lines = (await db.ChequeLines.AsNoTracking().Where(l => ids.Contains(l.ChequeId)).ToListAsync()).GroupBy(l => l.ChequeId).ToDictionary(g => g.Key, g => g.OrderBy(l => l.Id).ToList());
    var files = (await db.Attachments.AsNoTracking().Where(a => ids.Contains(a.ChequeId))
        .Select(a => new { a.Id, a.ChequeId, a.Kind, a.FileName, a.Size, a.By, a.At }).ToListAsync()).GroupBy(a => a.ChequeId).ToDictionary(g => g.Key, g => g.ToList());
    var msgs = (await db.Comments.AsNoTracking().Where(m => ids.Contains(m.ChequeId)).OrderBy(m => m.Id).ToListAsync())
        .Select(m => new { id = m.Id, chequeId = m.ChequeId, at = m.At, byId = m.ById, by = m.ByName, to = m.ToKind, toUserId = m.ToUserId, stage = m.Stage, kind = m.Kind, text = m.Text,
            read = (m.ReadBy ?? "").Contains("|" + myId + "|") }).ToList();
    var contractRefs = (await db.Contracts.AsNoTracking().OrderBy(c => c.OpNo)
        .Select(x => new { x.Id, x.OpNo, x.FinancierId, x.EntityId, x.Currency, x.EndDate, x.ExpiryDate, x.Status }).ToListAsync())
        .Select(x => new { id = x.Id, opNo = x.OpNo, financierId = x.FinancierId, entityId = x.EntityId, currency = x.Currency,
            expiryDate = string.IsNullOrEmpty(x.ExpiryDate) ? x.EndDate : x.ExpiryDate, status = string.IsNullOrEmpty(x.Status) ? "Active" : x.Status }).ToList();
    var cheques = chq.Select(c => ChequeView(c,
        lines.TryGetValue(c.Id, out var ls) ? ls.Select(l => (object)new { opNo = l.OpNo, instNo = l.InstNo, month = l.Month, due = l.Due, paidBefore = l.PaidBefore, requested = l.Requested, principal = l.Principal }).ToList() : new List<object>(),
        files.TryGetValue(c.Id, out var fs) ? fs.Select(f => (object)new { id = f.Id, kind = f.Kind, name = f.FileName, size = f.Size, by = f.By, at = f.At }).ToList() : new List<object>())).ToList();

    var users = await db.Users.AsNoTracking().OrderBy(x => x.FullName).ToListAsync();
    var uv = users.Select(x => A.Has("users")
        ? (object)new { id = x.Id, username = x.Username, fullName = x.FullName, fullNameAr = x.FullNameAr ?? "", email = x.Email ?? "", role = x.Role, deptId = x.DeptId, active = x.Active, mustChange = x.MustChange,
            lang = x.Lang ?? "en", twoFa = x.TwoFa, lockedUntil = x.LockedUntilUtc.HasValue && x.LockedUntilUtc > DateTime.UtcNow ? x.LockedUntilUtc.Value.ToString("o") : null,
            pwdChangedAt = x.PwdChangedAt, lastLogin = x.LastLogin }
        : new { id = x.Id, fullName = x.FullName, fullNameAr = x.FullNameAr ?? "", role = x.Role, deptId = x.DeptId, active = x.Active }).ToList();

    var all = await db.Cheques.AsNoTracking().Select(c => new { c.FxId, c.IssueRateId, c.ClearRateId }).ToListAsync();
    var used = new HashSet<string>(all.SelectMany(c => new[] { c.FxId, c.IssueRateId, c.ClearRateId }).Where(x => !string.IsNullOrEmpty(x)));
    var rates = (await db.Rates.AsNoTracking().OrderByDescending(r => r.Date).ToListAsync())
        .Select(r => new { id = r.Id, date = r.Date, QAR = r.QAR, SDG = r.SDG, setBy = r.SetBy, setAt = r.SetAt, source = r.Source ?? "", locked = used.Contains(r.Id) }).ToList();

    var tokenSet = !string.IsNullOrEmpty(ss.Token(s));
    var settings = new
    {
        alertDays = s.AlertDays, alertTime = s.AlertTime, telegramChannel = A.Has("telegram") ? s.TelegramChannel : "", tokenSet, tgEvents = s.TgEvents, hideTelegram = s.HideTelegram,
        reportCurrency = s.ReportCurrency, company = s.Company, timeZone = s.TimeZone, logo = s.Logo,
        cronUrl = (A.Has("telegram", Perm.E) || A.Has("settings")) ? $"{BaseUrl(ctx)}/api/cron/{s.CronKey}" : null,
        policy = PolicyView(s.Policy), secondLimitUsd = s.SecondLimitUsd, rateAlertPct = s.RateAlertPct,
        acc = new { payables = s.Acc.Payables, deferred = s.Acc.Deferred, finPrincipal = s.Acc.FinPrincipal, finProfit = s.Acc.FinProfit, poa = s.Acc.Poa, fxDiff = s.Acc.FxDiff }, funcConfirmed = s.FuncConfirmed,
        mailReady = Mailer.Ready(s),
        smtp = A.Has("settings") ? new { host = s.Smtp.Host, port = s.Smtp.Port, user = s.Smtp.User, from = s.Smtp.From, fromName = s.Smtp.FromName, ssl = s.Smtp.Ssl, passSet = !string.IsNullOrEmpty(s.Smtp.PassEnc) } : null
    };

    var accounts = await db.BankAccounts.AsNoTracking().ToListAsync();
    var banks = await db.Banks.AsNoTracking().OrderBy(x => x.NameEn).ToListAsync();
    var bankCur = banks.ToDictionary(x => x.Id, x => x.Currency);
    var acctCurs = accounts.Where(a => a.Active).Select(a => new { entityId = a.EntityId, cur = bankCur.GetValueOrDefault(a.BankId) }).Distinct().ToList();

    // reference lists go only to roles whose pages use them
    var seeBanks = A.Has("banks") || A.Has("books") || A.Has("voided") || A.Has("issue", "issue") || A.Has("entities") || A.Has("checklist") || A.Has("reports") || A.Has("entries");
    var seeBooks = A.Has("books") || A.Has("voided") || A.Has("issue", "issue") || A.Has("checklist");
    var seeContracts = A.Has("contracts") || A.Has("reports");


    object tgFeed = Array.Empty<object>(), alerts = Array.Empty<object>();
    if (A.Has("telegram"))
    {
        tgFeed = await db.TgMessages.AsNoTracking().Where(m => m.Kind == "event").OrderByDescending(m => m.Id).Take(30)
            .Select(m => new { at = m.At, text = m.Text, sent = m.Sent, error = m.Error }).ToListAsync();
        alerts = await db.TgMessages.AsNoTracking().Where(m => m.Kind == "digest" && m.Count > 0).OrderByDescending(m => m.Id).Take(10)
            .Select(m => new { at = m.At, count = m.Count, by = m.By, sent = m.Sent, error = m.Error }).ToListAsync();
    }

    var benUse = (await db.Cheques.AsNoTracking().GroupBy(c => c.BenId).Select(g => new { id = g.Key, n = g.Count() }).ToListAsync())
        .Concat(await db.Contracts.AsNoTracking().GroupBy(c => c.FinancierId).Select(g => new { id = g.Key, n = g.Count() }).ToListAsync())
        .GroupBy(x => x.id).Select(g => new { id = g.Key, n = g.Sum(x => x.n) }).ToList();

    return Ok(new
    {
        me = UserView(u, A), anyAdmin, today = Clock.Today(s),
        departments = await db.Departments.AsNoTracking().OrderBy(d => d.Id).Select(d => new { id = d.Id, nameEn = d.NameEn, nameAr = d.NameAr }).ToListAsync(),
        roles = roles.OrderBy(r => r.BuiltIn ? 0 : 1).ThenBy(r => r.Id).Select(r => new { id = r.Id, key = r.Key, nameEn = r.NameEn, nameAr = r.NameAr, deptId = r.DeptId, scope = r.Scope, builtIn = r.BuiltIn, notes = r.Notes ?? "", perms = Perm.View(Perm.Parse(r.Perms)), updatedBy = r.UpdatedBy ?? "", updatedAt = r.UpdatedAt ?? "" }).ToList(),
        permCatalog = Perm.Catalog.Select(c => new { page = c.Key, group = c.Group, ops = c.Ops }).ToList(),
        entities = await db.Entities.AsNoTracking().OrderBy(e => e.Id).Select(e => new { id = e.Id, nameEn = e.NameEn, nameAr = e.NameAr, funcCur = e.FuncCur }).ToListAsync(),
        users = uv,
        beneficiaries = await db.Beneficiaries.AsNoTracking().OrderBy(x => x.NameEn)
            .Select(x => new { id = x.Id, code = x.Code ?? "", type = x.Type, nameEn = x.NameEn, nameAr = x.NameAr, contact = x.Contact, phone = x.Phone, email = x.Email }).ToListAsync(),
        benUse, rates, settings, cheques, tgFeed, alerts, acctCurs, comments = msgs, contractRefs,
        banks = seeBanks ? banks.Select(x => (object)new { id = x.Id, nameEn = x.NameEn, nameAr = x.NameAr, currency = x.Currency, active = x.Active }).ToList() : new List<object>(),
        accounts = seeBanks ? accounts.Select(x => (object)new { id = x.Id, bankId = x.BankId, entityId = x.EntityId, description = x.Description, last4 = x.Last4, ledger = x.Ledger, active = x.Active, currency = bankCur.GetValueOrDefault(x.BankId) }).ToList() : new List<object>(),
        books = seeBooks ? (await db.Chequebooks.AsNoTracking().ToListAsync()).Select(x => (object)new { id = x.Id, accountId = x.AccountId, from = x.FromNo, to = x.ToNo, active = x.Active, by = x.AddedBy, at = x.AddedAt }).ToList() : new List<object>(),
        voided = seeBooks ? (await db.VoidedNos.AsNoTracking().OrderByDescending(v => v.Id).ToListAsync()).Select(x => (object)new { id = x.Id, accountId = x.AccountId, number = x.Number, reason = x.Reason, by = x.By, at = x.At }).ToList() : new List<object>(),
        contracts = seeContracts ? (await db.Contracts.AsNoTracking().OrderBy(c => c.OpNo).ToListAsync()).Select(x => (object)new { id = x.Id, opNo = x.OpNo, financierId = x.FinancierId, entityId = x.EntityId, currency = x.Currency, principal = x.Principal, profit = x.Profit, termMonths = x.TermMonths, instalments = x.Instalments, startDate = x.StartDate, endDate = x.EndDate, notes = x.Notes, log = x.Log ?? "[]", by = x.CreatedBy, at = x.CreatedAt,
            expiryDate = string.IsNullOrEmpty(x.ExpiryDate) ? x.EndDate : x.ExpiryDate, noticeDays = x.NoticeDays > 0 ? x.NoticeDays : 30, ownerId = x.OwnerId, followUpDate = x.FollowUpDate, status = string.IsNullOrEmpty(x.Status) ? "Active" : x.Status, closedAt = x.ClosedAt, closedBy = x.ClosedBy, closeReason = x.CloseReason }).ToList() : new List<object>(),
        posted = A.Has("entries") ? (await db.PostedEntries.AsNoTracking().ToListAsync()).Select(x => (object)new { key = x.Key, by = x.By, at = x.At }).ToList() : new List<object>()
    });
});

static object ChequeView(Cheque c, List<object> lines, List<object> files) => new
{
    id = c.Id, seq = c.Seq, requesterId = c.RequesterId, deptId = c.DeptId, benId = c.BenId, entityId = c.EntityId, amount = c.Amount, currency = c.Currency,
    payCur = c.PayCur ?? c.Currency, payAmt = c.PayAmt, dueDate = c.DueDate, reason = c.Reason, status = c.Status, createdAt = c.CreatedAt,
    opType = c.OpType ?? "Other", purpose = c.Purpose ?? "Payment", related = c.Related, docType = c.DocType, docNo = c.DocNo, docDate = c.DocDate,
    project = c.Project, counterAcct = c.CounterAcct, remainDate = c.RemainDate, poaSettleDate = c.PoaSettleDate,
    recipientType = c.RecipientType ?? "Beneficiary", recipientName = c.RecipientName, payMethod = c.PayMethod ?? "Cheque", priority = c.Priority ?? "Normal", priorityReason = c.PriorityReason,
    priorPaid = c.PriorPaid, priorDate = c.PriorDate, priorMethod = c.PriorMethod, priorRef = c.PriorRef,
    appr = c.ApprovedBy == null ? null : new { by = c.ApprovedBy, byId = c.ApprovedById, at = c.ApprovedAt, rateId = c.FxId, rateDate = c.ApprRateDate, qar = c.ApprQar, sdg = c.ApprSdg, src = c.ApprSrc, rateBy = c.ApprRateBy, usdEq = c.UsdEq, funcCur = c.FuncCur, funcVal = c.FuncVal, funcPrincipal = c.FuncPrincipal },
    need2 = c.Need2, need2Why = c.Need2Why,
    appr2 = c.Appr2By == null ? null : new { by = c.Appr2By, byId = c.Appr2ById, at = c.Appr2At },
    issue = c.IssuedBy == null ? null : new { accountId = c.AccountId, no = c.ChequeNo, bank = c.Bank, date = c.ChequeDate, by = c.IssuedBy, byId = c.IssuedById, at = c.IssuedAt, rateId = c.IssueRateId, rateDate = c.IssueRateDate, qar = c.IssueQar, sdg = c.IssueSdg, src = c.IssueSrc, rateBy = c.IssueRateBy, fxDiff = c.IssueFxDiff, carry = c.CarryFunc },
    received = c.ReceivedBy == null ? null : new { by = c.ReceivedBy, at = c.ReceivedAt },
    delivered = c.DeliveredBy == null ? null : new { by = c.DeliveredBy, at = c.DeliveredAt, to = c.DeliveredTo },
    closed = c.ClosedStatus == null ? null : new { status = c.ClosedStatus, by = c.ClosedBy, byId = c.ClosedById, at = c.ClosedAt, reason = c.ClosedReason, rateId = c.ClearRateId, rateDate = c.ClearRateDate, qar = c.ClearQar, sdg = c.ClearSdg, src = c.ClearSrc, rateBy = c.ClearRateBy, usdEq = c.ClearUsdEq, funcVal = c.ClearFuncVal, fxDiff = c.ClearFxDiff },
    solved = c.SolvedBy == null ? null : new { by = c.SolvedBy, at = c.SolvedAt, note = c.SolvedNote, method = c.SolveMethod },
    rejected = c.RejectedBy == null ? null : new { by = c.RejectedBy, at = c.RejectedAt, reason = c.RejectReason },
    poa = c.PoaSettledBy == null ? null : new { by = c.PoaSettledBy, at = c.PoaSettledAt, reference = c.PoaRef },
    lines, files
};

// ---------- attachments ----------
// Keep-awake check for an external pinger (cron-job.org every 10 min): answers without touching the database,
// so the free-plan web app stays loaded without using Azure SQL free time.
app.MapGet("/api/ping", () => Results.Text("ok"));

// Audit log: loaded only when the Audit page is opened (it used to come with every state load).
app.MapGet("/api/audit", async (HttpContext ctx, AppDb db, SettingsStore ss) =>
{
    var u = await CurrentUser(ctx, db); if (u == null) return Err("Please sign in again.", 401);
    var s = await ss.Get(db);
    if (Forced(u, s) != null) return Err("Password change required.", 403);
    var A = await AccessOf(db, u);
    if (!A.Has("audit")) return Err("Your role cannot open the audit log.", 403);
    var audit = await db.Audit.AsNoTracking().OrderByDescending(a => a.Id).Take(3000)
        .Select(a => new { at = a.At, user = a.User, action = a.Action, entity = a.Entity, details = a.Details }).ToListAsync();
    return Ok(new { ok = true, audit });
});

app.MapGet("/api/file/{id:int}", async (int id, HttpContext ctx, AppDb db) =>
{
    var u = await CurrentUser(ctx, db); if (u == null) return Results.StatusCode(401);
    var f = await db.Attachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id);
    if (f == null) return Results.NotFound();
    var c = await db.Cheques.AsNoTracking().FirstOrDefaultAsync(x => x.Id == f.ChequeId);
    if (c == null || !(await AccessOf(db, u)).Sees(u, c)) return Results.NotFound();
    return Results.File(f.Data ?? Array.Empty<byte>(), string.IsNullOrEmpty(f.ContentType) ? "application/octet-stream" : f.ContentType, f.FileName);
});

// ---------- cron (for free-plan wake-up, e.g. cron-job.org) ----------
app.MapGet("/api/cron/{key}", async (string key, AppDb db, SettingsStore ss, Notifier nf) =>
{
    var s = await ss.Get(db);
    if (string.IsNullOrEmpty(s.CronKey) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(key ?? ""), Encoding.UTF8.GetBytes(s.CronKey)))
        return Results.NotFound();
    await nf.DailyIfDue(db);
    return Results.Text("ok");
});

// ---------- actions ----------
app.MapPost("/api/act", async (HttpContext ctx, AppDb db, SettingsStore ss, Notifier nf, Telegram tg, Mailer mail, JsonElement b) =>
{
    var u = await CurrentUser(ctx, db); if (u == null) return Err("Please sign in again.", 401);
    var s = await ss.Get(db);
    if (Forced(u, s) != null) return Err("Password change required.", 403);
    var a = Str(b, "action");
    var me = u.FullName;
    var roles = await AllRoles(db);
    var A = Access.Of(u, roles, await AnyAdmin(db, roles));
    // a role "outranks" the user when it holds administration rights the user does not hold
    bool Outranks(string roleKey)
    {
        var r = roles.FirstOrDefault(z => z.Key == roleKey); if (r == null) return false;
        var rp = Perm.Parse(r.Perms);
        return Perm.Powers.Any(w => Perm.Has(rp, w.Page, w.Op) && !A.Has(w.Page, w.Op));
    }
    try
    {
        switch (a)
        {
            // ===================== cheque cycle =====================
            case "submitReq":
            {
                if (!A.Has("requests", Perm.C)) return Err("Your role cannot raise requests.", 403);
                var ent = await db.Entities.FindAsync(Int(b, "entityId")); if (ent == null) return Err("Choose the entity.");
                var opType = Str(b, "opType"); if (!Lists.OpTypes.Contains(opType)) return Err("Choose the operation type.");
                var purpose = Str(b, "purpose"); if (!Lists.Purposes.Contains(purpose)) return Err("Choose the purpose: payment or guarantee.");
                var benId = Int(b, "benId"); var ben = await db.Beneficiaries.FindAsync(benId); if (ben == null) return Err("Choose a beneficiary.");
                var cur = Str(b, "currency"); var payCur = Str(b, "payCur");
                if (!Lists.Curs.Contains(cur) || !Lists.Curs.Contains(payCur)) return Err("Choose the contract currency and the payment currency.");
                var related = Bool(b, "related");
                var financing = Lists.Financing.Contains(opType);

                // line items
                var lines = new List<ChequeLine>();
                if (b.TryGetProperty("lines", out var ls) && ls.ValueKind == JsonValueKind.Array)
                    foreach (var l in ls.EnumerateArray())
                        lines.Add(new ChequeLine
                        {
                            OpNo = Trunc(Str(l, "opNo"), 50), InstNo = Int(l, "instNo"), Month = Trunc(Str(l, "month"), 7),
                            Due = Math.Round(Dec(l, "due"), 2), PaidBefore = Math.Round(Dec(l, "paidBefore"), 2),
                            Requested = Math.Round(Dec(l, "requested"), 2), Principal = Math.Round(Dec(l, "principal"), 2)
                        });
                if (lines.Count == 0) return Err("Add at least one line.");
                if (lines.Count > 30) return Err("A request can have at most 30 lines.");
                var partial = false;
                for (var i = 0; i < lines.Count; i++)
                {
                    var l = lines[i]; var n = i + 1;
                    if (l.Requested <= 0) return Err($"Line {n}: enter the amount requested now.");
                    if (l.Due < 0 || l.PaidBefore < 0) return Err($"Line {n}: amounts cannot be negative.");
                    if (l.Due > 0 && l.Requested > l.Due - l.PaidBefore) return Err($"Line {n}: requested now is more than what remains due ({Fmt.Money(l.Due - l.PaidBefore, cur)}).");
                    if (l.Due > 0 && l.Requested < l.Due - l.PaidBefore) partial = true;
                    if (l.Month.Length > 0 && !Regex.IsMatch(l.Month, @"^\d{4}-\d{2}$")) return Err($"Line {n}: month must look like 11/2026.");
                    if (!financing) l.Principal = 0;
                    if (l.Principal < 0 || l.Principal > l.Requested) return Err($"Line {n}: the principal part must be between 0 and the amount requested.");
                    if (financing && l.OpNo.Length == 0) return Err($"Line {n}: enter the operation number from the contracts register.");
                    if (Lists.SplitRequired.Contains(opType) && l.Principal <= 0) return Err($"Line {n}: separate the principal from the profit — enter the principal part.");
                }
                var total = lines.Sum(l => l.Requested);

                // financing: each operation must be a registered contract of the same financier and currency
                if (financing)
                {
                    foreach (var g in lines.GroupBy(l => l.OpNo))
                    {
                        var k = await db.Contracts.AsNoTracking().FirstOrDefaultAsync(x => x.OpNo == g.Key);
                        if (k == null) return Err($"Operation {g.Key} is not in the contracts register. Finance must register it first.");
                        if (k.Status == "Closed") return Err($"Operation {g.Key} is closed in the contracts register.");
                        if (k.FinancierId != benId) return Err($"Operation {g.Key} is registered for another financier.");
                        if (k.Currency != cur) return Err($"Operation {g.Key} is registered in {k.Currency}, not {cur}.");
                        var usedPrincipal = await (from ln in db.ChequeLines join ch in db.Cheques on ln.ChequeId equals ch.Id
                                                   where ln.OpNo == g.Key && ch.Status != "Rejected" && ch.Status != "Cancelled"
                                                   select (decimal?)ln.Principal).SumAsync() ?? 0m;
                        var remaining = k.Principal - usedPrincipal;
                        var want = g.Sum(l => l.Principal);
                        if (want > remaining) return Err($"Operation {g.Key}: principal requested {Fmt.Money(want, cur)} is more than the remaining principal {Fmt.Money(remaining, cur)}.");
                    }
                }

                // supporting document
                var docType = Str(b, "docType"); var docNo = Str(b, "docNo"); var docDate = Str(b, "docDate");
                if (docType.Length < 2 || docNo.Length < 1) return Err("Enter the document type and number.");
                if (!Clock.ValidDate(docDate) || Clock.DaysUntil(s, docDate) > 0) return Err("The document date cannot be after today.");
                var due = Str(b, "dueDate"); if (!Clock.ValidDate(due) || Clock.DaysUntil(s, due) < 0) return Err("The due date must be today or later.");
                var remain = Str(b, "remainDate");
                if (partial && (!Clock.ValidDate(remain) || Clock.DaysUntil(s, remain) < 0)) return Err("This is a partial payment: enter the date for the remaining balance.");
                if (!partial) remain = "";
                var poaDate = Str(b, "poaSettleDate");
                if (opType == Lists.Poa && (!Clock.ValidDate(poaDate) || Clock.DaysUntil(s, poaDate) < 0)) return Err("Payment on account: enter the date it will be settled.");
                if (opType != Lists.Poa) poaDate = "";
                var recipientType = Str(b, "recipientType") == "Other" ? "Other" : "Beneficiary";
                var recipientName = Str(b, "recipientName");
                if (recipientType == "Other" && recipientName.Length < 2) return Err("Enter the name of the person who will receive the cheque.");
                var priority = Str(b, "priority") == "Urgent" ? "Urgent" : "Normal"; var priorityReason = Str(b, "priorityReason");
                if (priority == "Urgent" && priorityReason.Length < 3) return Err("Explain why the request is urgent.");
                var priorPaid = Bool(b, "priorPaid"); var priorDate = Str(b, "priorDate"); var priorMethod = Str(b, "priorMethod"); var priorRef = Str(b, "priorRef");
                if (priorPaid && (!Clock.ValidDate(priorDate) || Clock.DaysUntil(s, priorDate) > 0 || priorMethod.Length < 2 || priorRef.Length < 1))
                    return Err("Payment made before the request: enter its date, method and reference.");
                if (!await (from ac in db.BankAccounts join bk in db.Banks on ac.BankId equals bk.Id where ac.EntityId == ent.Id && ac.Active && bk.Currency == payCur select ac.Id).AnyAsync())
                    return Err($"{ent.NameEn} has no active bank account in {payCur}. Ask the CFO to add one, or choose another payment currency.");

                // attachments
                var uploads = new List<Attachment>();
                if (b.TryGetProperty("files", out var fl) && fl.ValueKind == JsonValueKind.Array)
                    foreach (var f in fl.EnumerateArray())
                    {
                        var kind = Str(f, "kind"); if (kind != "doc" && kind != "auth" && kind != "prior") kind = "doc";
                        var type = Str(f, "type").ToLowerInvariant(); var name = Trunc(Str(f, "name"), 200);
                        if (!new[] { "application/pdf", "image/jpeg", "image/png", "image/webp" }.Contains(type)) return Err($"{name}: only PDF, JPG, PNG or WEBP files.");
                        byte[] data;
                        try { data = Convert.FromBase64String(Str(f, "data", false)); } catch { return Err($"{name}: the file could not be read."); }
                        if (data.Length == 0) return Err($"{name} is empty.");
                        if (data.Length > 10 * 1024 * 1024) return Err($"{name} is larger than 10 MB.");
                        uploads.Add(new Attachment { Kind = kind, FileName = name, ContentType = type, Size = data.Length, Data = data, By = me, At = Clock.Stamp(s) });
                    }
                if (uploads.Count > 5) return Err("Attach at most 5 files.");
                if (!uploads.Any(x => x.Kind == "doc")) return Err("Attach the supporting document.");
                if (recipientType == "Other" && !uploads.Any(x => x.Kind == "auth")) return Err("Attach the authorisation letter for the other recipient.");

                // duplicate warning (same financier, operation and instalment)
                if (!Bool(b, "confirmDup"))
                    foreach (var l in lines.Where(x => x.OpNo.Length > 0))
                    {
                        var dup = await (from ln in db.ChequeLines join ch in db.Cheques on ln.ChequeId equals ch.Id
                                         where ch.BenId == benId && ln.OpNo == l.OpNo && ln.InstNo == l.InstNo && ch.Status != "Rejected" && ch.Status != "Cancelled"
                                         select ch.Id).FirstOrDefaultAsync();
                        if (dup != null) return Ok(new { ok = false, dup = true, error = $"{dup} already requests operation {l.OpNo}, instalment {l.InstNo} for this beneficiary. Submit anyway?" });
                    }

                for (var attempt = 0; attempt < 5; attempt++)
                {
                    var seq = (await db.Cheques.MaxAsync(c => (int?)c.Seq) ?? 0) + 1;
                    var c = new Cheque
                    {
                        Id = "CHQ-" + seq.ToString("0000", CultureInfo.InvariantCulture), Seq = seq, RequesterId = u.Id, DeptId = u.DeptId, BenId = benId,
                        Amount = total, Currency = cur, PayCur = payCur, DueDate = due, Reason = Trunc(Str(b, "reason"), 1000), Status = "Pending", CreatedAt = Clock.Stamp(s),
                        EntityId = ent.Id, FuncCur = ent.FuncCur, OpType = opType, Purpose = purpose, Related = related,
                        DocType = Trunc(docType, 60), DocNo = Trunc(docNo, 60), DocDate = docDate, Project = Trunc(Str(b, "project"), 100), CounterAcct = Trunc(Str(b, "counterAcct"), 60),
                        RemainDate = remain, PoaSettleDate = poaDate, RecipientType = recipientType, RecipientName = recipientType == "Other" ? Trunc(recipientName, 150) : null,
                        PayMethod = "Cheque", Priority = priority, PriorityReason = priority == "Urgent" ? Trunc(priorityReason, 300) : null,
                        PriorPaid = priorPaid, PriorDate = priorPaid ? priorDate : null, PriorMethod = priorPaid ? Trunc(priorMethod, 60) : null, PriorRef = priorPaid ? Trunc(priorRef, 100) : null,
                        DupConfirmed = Bool(b, "confirmDup")
                    };
                    db.Cheques.Add(c);
                    foreach (var l in lines) { l.ChequeId = c.Id; db.ChequeLines.Add(l); }
                    foreach (var f in uploads) { f.ChequeId = c.Id; db.Attachments.Add(f); }
                    Log(db, s, me, "Request created", c.Id, $"{Fmt.Money(total, cur)} to {ben.NameEn} · {opType} · {ent.NameEn}, due {Fmt.D(due)}");
                    try { await db.SaveChangesAsync(); return Ok(new { ok = true, id = c.Id }); }
                    catch (DbUpdateException) { db.ChangeTracker.Clear(); await Task.Delay(150 * (attempt + 1)); }
                }
                return Err("Could not save — please try again.");
            }
            case "cancelReq":
            {
                if (!A.Has("requests", Perm.X)) return Err("Your role cannot cancel requests.", 403);
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.Status != "Pending" || c.RequesterId != u.Id) return Err("You can cancel only your own request, and only while it waits for the CFO.");
                c.Status = "Cancelled"; Log(db, s, me, "Cancelled", c.Id, "");
                return await Save(db, c.Id);
            }
            case "approve":
            {
                if (!A.Has("approvals", "approve")) return Err("Your role cannot give the first approval.", 403);
                var c = await Chq(db, b); if (c == null || !A.Sees(u, c)) return Err("Cheque not found.");
                if (c.Status != "Pending") return Err($"{c.Id} is no longer waiting for the CFO. The screen will refresh.");
                if (c.RequesterId == u.Id) return Err("You raised this request, so you cannot approve it. Another CFO must approve it.");
                var docDate = string.IsNullOrEmpty(c.DocDate) ? c.CreatedAt.Substring(0, 10) : c.DocDate;
                var r = await RateOn(db, docDate);
                if (r == null) return Err($"There is no exchange rate on or before the document date ({Fmt.D(docDate)}). Finance must enter it first.");
                var funcCur = string.IsNullOrEmpty(c.FuncCur) ? "SDG" : c.FuncCur;
                var principal = await db.ChequeLines.Where(l => l.ChequeId == c.Id).SumAsync(l => (decimal?)l.Principal) ?? 0m;
                c.FxId = r.Id; c.ApprRateDate = r.Date; c.ApprQar = r.QAR; c.ApprSdg = r.SDG; c.ApprSrc = r.Source ?? ""; c.ApprRateBy = r.SetBy;
                c.UsdEq = Fx.Round(Fx.Conv(c.Amount, c.Currency, "USD", r.QAR, r.SDG), "USD");
                c.FuncCur = funcCur;
                c.FuncVal = Fx.Round(Fx.Conv(c.Amount, c.Currency, funcCur, r.QAR, r.SDG), funcCur);
                c.FuncPrincipal = Fx.Round(Fx.Conv(principal, c.Currency, funcCur, r.QAR, r.SDG), funcCur);
                c.ApprovedBy = me; c.ApprovedById = u.Id; c.ApprovedAt = Clock.Stamp(s);
                if ((c.PayCur ?? c.Currency) == c.Currency) { c.PayCur = c.Currency; c.PayAmt = c.Amount; }
                var why = new List<string>();
                if (c.UsdEq > s.SecondLimitUsd) why.Add($"above the {s.SecondLimitUsd.ToString("N0", CultureInfo.InvariantCulture)} USD limit");
                if (c.Related) why.Add("related party");
                if (c.PriorPaid) why.Add("paid before the request");
                c.Need2 = why.Count > 0; c.Need2Why = string.Join(", ", why);
                c.Status = c.Need2 ? "Pending2" : "Approved";
                Log(db, s, me, "Approved", c.Id, $"Rate {r.Id} ({Fmt.D(r.Date)}) locked · {Fmt.Money(c.UsdEq.Value, "USD")} · {Fmt.Money(c.FuncVal.Value, funcCur)}{(c.Need2 ? " · second approval needed: " + c.Need2Why : "")}");
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "approved", c.Need2 ? "needs second approval: " + c.Need2Why : null, me); return res;
            }
            case "approve2":
            {
                if (!A.Has("approvals", "approve2")) return Err("Your role cannot give the second approval.", 403);
                var c = await Chq(db, b); if (c == null || !A.Sees(u, c)) return Err("Cheque not found.");
                if (c.Status != "Pending2") return Err($"{c.Id} is not waiting for a second approval.");
                if (c.RequesterId == u.Id) return Err("You raised this request, so you cannot give its second approval.");
                if (c.ApprovedById == u.Id) return Err("You gave the first approval, so you cannot give the second one.");
                c.Status = "Approved"; c.Appr2By = me; c.Appr2ById = u.Id; c.Appr2At = Clock.Stamp(s);
                Log(db, s, me, "Second approval", c.Id, c.Need2Why);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "approved2", null, me); return res;
            }
            case "reject":
            {
                var c = await Chq(db, b); if (c == null || !A.Sees(u, c)) return Err("Cheque not found.");
                if (!((c.Status == "Pending" && A.Has("approvals", "approve")) || (c.Status == "Pending2" && A.Has("approvals", "approve2"))))
                    return Err(c.Status == "Pending2" ? "Your role cannot reject at the second approval." : c.Status == "Pending" ? "Your role cannot reject at this stage." : $"{c.Id} is no longer waiting for approval.", 403);
                var rs = Str(b, "reason"); if (rs.Length < 2) return Err("Enter the rejection reason.");
                c.Status = "Rejected"; c.RejectedBy = me; c.RejectedAt = Clock.Stamp(s); c.RejectReason = Trunc(rs, 500);
                Log(db, s, me, "Rejected", c.Id, rs);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "rejected", "reason: " + rs, me); return res;
            }
            case "issue":
            {
                if (!A.Has("issue", "issue")) return Err("Your role cannot issue cheques.", 403);
                var c = await Chq(db, b); if (c == null || !A.Sees(u, c)) return Err("Cheque not found.");
                if (c.Status != "Approved") return Err($"{c.Id} is not waiting to be issued.");
                if (c.RequesterId == u.Id) return Err("You raised this request, so another Finance member must issue its cheque.");
                var acc = await db.BankAccounts.FindAsync(Int(b, "accountId")); if (acc == null || !acc.Active) return Err("Choose an active bank account.");
                var bank = await db.Banks.FindAsync(acc.BankId);
                var payCur = c.PayCur ?? c.Currency;
                if (acc.EntityId != c.EntityId) return Err("This account belongs to another entity.");
                if (bank == null || bank.Currency != payCur) return Err($"Choose an account in {payCur}, the payment currency.");
                var noText = Str(b, "no"); if (!long.TryParse(noText, NumberStyles.None, CultureInfo.InvariantCulture, out var no) || no <= 0) return Err("Enter the cheque number (digits only).");
                if (!await db.Chequebooks.AnyAsync(k => k.AccountId == acc.Id && k.Active && k.FromNo <= no && k.ToNo >= no)) return Err($"Number {noText} is not in any chequebook of this account.");
                if (await db.VoidedNos.AnyAsync(v => v.AccountId == acc.Id && v.Number == no)) return Err($"Number {noText} was voided for this account.");
                var noStr = no.ToString(CultureInfo.InvariantCulture);
                if (await db.Cheques.AnyAsync(x => x.Id != c.Id && x.AccountId == acc.Id && x.ChequeNo != null && (x.ChequeNo == noStr || x.ChequeNo == noText)))
                    return Err($"Number {noText} is already used on this account.");
                var dt = Str(b, "date"); if (!Clock.ValidDate(dt)) return Err("Enter the cheque date.");
                var funcCur = string.IsNullOrEmpty(c.FuncCur) ? "SDG" : c.FuncCur;
                if (payCur != c.Currency)
                {
                    var today = Clock.Today(s);
                    var r = await RateOn(db, today);
                    if (r == null) return Err("Enter today's exchange rate first: the cheque amount uses the issue-day rate.");
                    c.IssueRateId = r.Id; c.IssueRateDate = r.Date; c.IssueQar = r.QAR; c.IssueSdg = r.SDG; c.IssueSrc = r.Source ?? ""; c.IssueRateBy = r.SetBy;
                    c.PayAmt = Fx.Round(Fx.Conv(c.Amount, c.Currency, payCur, r.QAR, r.SDG), payCur);
                    c.CarryFunc = Fx.Round(Fx.Conv(c.PayAmt.Value, payCur, funcCur, r.QAR, r.SDG), funcCur);
                    c.IssueFxDiff = c.CarryFunc - (c.FuncVal ?? 0m);
                }
                else
                {
                    c.PayAmt = c.Amount; c.CarryFunc = c.FuncVal; c.IssueFxDiff = 0m;
                }
                var t = Clock.Stamp(s);
                c.Status = "Posted"; c.AccountId = acc.Id; c.ChequeNo = Trunc(noText, 50); c.Bank = Trunc($"{bank.NameEn} ••{acc.Last4}", 150); c.ChequeDate = dt;
                c.IssuedBy = me; c.IssuedById = u.Id; c.IssuedAt = t;
                var req = await db.Users.FindAsync(c.RequesterId);
                Log(db, s, me, "Cheque issued", c.Id, $"#{noText} · {bank.NameEn} ••{acc.Last4} · {Fmt.Money(c.PayAmt.Value, payCur)} · dated {Fmt.D(dt)} → {req?.FullName}{(c.IssueRateId != null ? $" · rate {c.IssueRateId} locked, FX difference {Fmt.Money(c.IssueFxDiff ?? 0, funcCur)}" : "")}");
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "issued", "to " + req?.FullName, me); return res;
            }
            // ===================== messages on a request =====================
            case "comment":
            {
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (!A.Sees(u, c) && !A.Has("approvals", "approve") && !A.Has("approvals", "approve2") && !A.Has("issue", "issue"))
                    return Err("You cannot write on this request.", 403);
                var text = Str(b, "text"); if (text.Length < 1) return Err("Write the message.");
                if (text.Length > 2000) return Err("The message is too long (2,000 characters at most).");
                var kind = Str(b, "kind"); if (!Lists.CommentKinds.Contains(kind)) kind = "Note";
                var to = Str(b, "to"); if (!Lists.CommentTo.Contains(to)) to = "all";
                int? toUser = null;
                if (to == "user")
                {
                    var tuId = Int(b, "toUserId");
                    var tu = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tuId && x.Active);
                    if (tu == null) return Err("Choose who the message is for.");
                    toUser = tu.Id;
                }
                db.Comments.Add(new Comment
                {
                    ChequeId = c.Id, At = Clock.Stamp(s), ById = u.Id, ByName = Trunc(me, 150), ToKind = to, ToUserId = toUser,
                    Stage = c.Status, Kind = kind, Text = text, ReadBy = "|" + u.Id + "|"
                });
                // writing on a request answers what was waiting for you there
                foreach (var m in await db.Comments.Where(x => x.ChequeId == c.Id && x.ById != u.Id).ToListAsync())
                    if (!(m.ReadBy ?? "").Contains("|" + u.Id + "|") && (m.ReadBy ?? "|").Length < 1900) m.ReadBy = (string.IsNullOrEmpty(m.ReadBy) ? "|" : m.ReadBy) + u.Id + "|";
                Log(db, s, me, "Message", c.Id, $"{kind} to {to}: {(text.Length > 120 ? text[..120] + "…" : text)}");
                return await Save(db, c.Id);
            }
            case "readComments":
            {
                var id = Str(b, "id"); if (string.IsNullOrEmpty(id)) return Err("Cheque not found.");
                var tag = "|" + u.Id + "|";
                foreach (var m in await db.Comments.Where(x => x.ChequeId == id && x.ById != u.Id).ToListAsync())
                    if (!(m.ReadBy ?? "").Contains(tag) && (m.ReadBy ?? "|").Length < 1900) m.ReadBy = (string.IsNullOrEmpty(m.ReadBy) ? "|" : m.ReadBy) + u.Id + "|";
                await db.SaveChangesAsync();
                return Ok(new { ok = true });
            }
            case "receive":
            {
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.RequesterId != u.Id) return Err("Only the requester confirms receipt.", 403);
                if (c.Status != "Posted") return Err("This cheque is not waiting for your receipt.");
                c.Status = "Received"; c.ReceivedBy = me; c.ReceivedAt = Clock.Stamp(s);
                Log(db, s, me, "Receipt confirmed", c.Id, "Requester received the cheque");
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "received", "⏳ not yet with the beneficiary", me); return res;
            }
            case "deliver":
            {
                var c = await Chq(db, b); if (c == null) return Err("Cheque not found.");
                if (c.RequesterId != u.Id) return Err("Only the requester confirms delivery.", 403);
                if (c.Status != "Received") return Err("Confirm receipt first.");
                var to = Str(b, "to"); var dt = Str(b, "date"); if (!Clock.ValidDate(dt) || Clock.DaysUntil(s, dt) > 0) dt = Clock.Today(s);
                c.Status = "Delivered"; c.DeliveredBy = me; c.DeliveredAt = dt + " " + Clock.Now(s).ToString("HH:mm", CultureInfo.InvariantCulture); c.DeliveredTo = Trunc(to, 150);
                var ben = await db.Beneficiaries.FindAsync(c.BenId);
                Log(db, s, me, "Delivered to beneficiary", c.Id, (to.Length > 0 ? "Handed to " + to + " · " : "") + ben?.NameEn);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "delivered", (to.Length > 0 ? "handed to " + to + " · " : "") + "beneficiary will submit to bank", me); return res;
            }
            case "close":
            {
                if (!A.Has("followup", "clear")) return Err("Your role cannot record clearing or return.", 403);
                var c = await Chq(db, b); if (c == null || !A.Sees(u, c)) return Err("Cheque not found.");
                if (c.Status != "Delivered") return Err("Only cheques with the beneficiary can be cleared or returned.");
                if (c.IssuedById == u.Id) return Err("You issued this cheque, so someone else must record its clearing or return.");
                if (Clock.DaysUntil(s, c.DueDate) > 0) return Err($"It can be cleared or returned from the due date ({Fmt.D(c.DueDate)}).");
                var st = Str(b, "status"); var rs = Str(b, "reason");
                if (st != "Cleared" && st != "Returned") return Err("Invalid status.");
                if (st == "Returned" && rs.Length < 2) return Err("Enter the return reason.");
                var r = await RateOn(db, Clock.Today(s));
                if (r == null) return Err("Enter today's exchange rate first: it is saved with the cheque.");
                var payCur = c.PayCur ?? c.Currency; var funcCur = string.IsNullOrEmpty(c.FuncCur) ? "SDG" : c.FuncCur; var amt = c.PayAmt ?? c.Amount;
                c.ClearRateId = r.Id; c.ClearRateDate = r.Date; c.ClearQar = r.QAR; c.ClearSdg = r.SDG; c.ClearSrc = r.Source ?? ""; c.ClearRateBy = r.SetBy;
                c.ClearUsdEq = Fx.Round(Fx.Conv(amt, payCur, "USD", r.QAR, r.SDG), "USD");
                c.ClearFuncVal = Fx.Round(Fx.Conv(amt, payCur, funcCur, r.QAR, r.SDG), funcCur);
                c.ClearFxDiff = st == "Cleared" ? c.ClearFuncVal - (c.CarryFunc ?? c.FuncVal ?? 0m) : 0m;
                c.Status = st; c.ClosedStatus = st; c.ClosedBy = me; c.ClosedById = u.Id; c.ClosedAt = Clock.Stamp(s); c.ClosedReason = Trunc(rs, 500);
                Log(db, s, me, "Marked " + st.ToLowerInvariant(), c.Id, $"rate {r.Id} saved{(st == "Cleared" ? " · realised FX difference " + Fmt.Money(c.ClearFxDiff ?? 0, funcCur) : "")}{(rs.Length > 0 ? " · " + rs : "")}");
                var res = await Save(db, c.Id); await nf.Event(db, s, c, st.ToLowerInvariant(), rs.Length > 0 ? "reason: " + rs : null, me); return res;
            }
            case "solve":
            {
                if (!A.Has("followup", "settle")) return Err("Your role cannot settle returned cheques.", 403);
                var c = await Chq(db, b); if (c == null || !A.Sees(u, c)) return Err("Cheque not found.");
                if (c.Status != "Returned") return Err("Only returned cheques can be settled.");
                var m = Str(b, "method"); if (!Lists.SolveMethods.Contains(m)) return Err("Choose how it was settled.");
                var n = Str(b, "note"); if (n.Length < 2) return Err("Add a short note, e.g. the new cheque or transfer reference.");
                c.Status = "Solved"; c.SolvedBy = me; c.SolvedAt = Clock.Stamp(s); c.SolvedNote = Trunc(n, 500); c.SolveMethod = m;
                Log(db, s, me, "Returned cheque settled", c.Id, m + " · " + n);
                var res = await Save(db, c.Id); await nf.Event(db, s, c, "solved", m + " · " + n, me); return res;
            }
            case "settlePoa":
            {
                if (!A.Has("poa", "settle")) return Err("Your role cannot settle payments on account.", 403);
                var c = await Chq(db, b); if (c == null || !A.Sees(u, c)) return Err("Cheque not found.");
                if (c.OpType != Lists.Poa) return Err("This is not a payment on account.");
                if (!new[] { "Posted", "Received", "Delivered", "Cleared" }.Contains(c.Status)) return Err("The cheque must be issued before the payment on account is settled.");
                if (c.PoaSettledBy != null) return Err("Already settled.");
                var rf = Str(b, "reference"); if (rf.Length < 2) return Err("Enter the invoice or document that settles it.");
                c.PoaSettledBy = me; c.PoaSettledAt = Clock.Stamp(s); c.PoaRef = Trunc(rf, 150);
                Log(db, s, me, "Payment on account settled", c.Id, rf);
                return await Save(db, c.Id);
            }

            // ===================== exchange rates =====================
            case "saveRate":
            {
                if (!A.Has("rates", Perm.C) && !A.Has("rates", Perm.E)) return Err("Your role cannot enter exchange rates.", 403);
                var dt = Str(b, "date"); var q = Dec(b, "QAR"); var sd = Dec(b, "SDG"); var src = Str(b, "source");
                if (!Clock.ValidDate(dt) || Clock.DaysUntil(s, dt) > 0) return Err("The rate date cannot be in the future.");
                if (q <= 0 || sd <= 0) return Err("Enter both rates.");
                if (src.Length < 2) return Err("Enter the source of the rate.");
                var id = "FX-" + dt.Replace("-", "");
                var rateExists = await db.Rates.AnyAsync(x => x.Id == id);
                if (!A.Has("rates", rateExists ? Perm.E : Perm.C)) return Err(rateExists ? "Your role cannot change a rate that is already entered." : "Your role cannot enter exchange rates.", 403);
                if (await db.Cheques.AnyAsync(c => c.FxId == id || c.IssueRateId == id || c.ClearRateId == id)) return Err(id + " is already used by cheques, so it is locked and cannot be changed.");
                var prev = await db.Rates.AsNoTracking().Where(x => string.Compare(x.Date, dt) < 0).OrderByDescending(x => x.Date).FirstOrDefaultAsync();
                if (prev != null && !Bool(b, "confirm"))
                {
                    var dq = prev.QAR > 0 ? Math.Abs(q - prev.QAR) / prev.QAR * 100m : 0m;
                    var dsd = prev.SDG > 0 ? Math.Abs(sd - prev.SDG) / prev.SDG * 100m : 0m;
                    if (dq > s.RateAlertPct || dsd > s.RateAlertPct)
                    {
                        var which = dsd >= dq ? $"SDG moved {dsd.ToString("0.0", CultureInfo.InvariantCulture)}% from {prev.SDG.ToString("N0", CultureInfo.InvariantCulture)}" : $"QAR moved {dq.ToString("0.0", CultureInfo.InvariantCulture)}% from {prev.QAR.ToString("0.####", CultureInfo.InvariantCulture)}";
                        return Ok(new { ok = false, confirm = true, error = $"{which} on {Fmt.D(prev.Date)}, more than the {s.RateAlertPct.ToString("0.#", CultureInfo.InvariantCulture)}% alert. Check the figure, then confirm." });
                    }
                }
                var r = await db.Rates.FindAsync(id);
                if (r == null) db.Rates.Add(new Rate { Id = id, Date = dt, QAR = q, SDG = sd, SetBy = me, SetAt = Clock.Stamp(s), Source = Trunc(src, 100) });
                else { r.QAR = q; r.SDG = sd; r.SetBy = me; r.SetAt = Clock.Stamp(s); r.Source = Trunc(src, 100); }
                Log(db, s, me, "Set exchange rate", id, $"1 USD = {q.ToString(CultureInfo.InvariantCulture)} QAR, {sd.ToString(CultureInfo.InvariantCulture)} SDG · {src}{(Bool(b, "confirm") ? " · confirmed past the alert" : "")}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }

            // ===================== beneficiaries =====================
            case "saveBen":
            {
                var id = Int(b, "id");
                if (id > 0 && !A.Has("beneficiaries", Perm.E)) return Err("Your role cannot edit beneficiaries.", 403);
                if (id == 0 && !A.Has("beneficiaries", Perm.C)) return Err("Your role cannot add beneficiaries.", 403);
                var en = Str(b, "nameEn"); if (en.Length < 2) return Err("The English name is required.");
                var type = Str(b, "type"); if (!Lists.BenTypes.Contains(type)) type = "Other";
                var code = Str(b, "code");
                if (code.Length > 0 && await db.Beneficiaries.AnyAsync(x => x.Code == code && x.Id != id)) return Err("This code is already used.");
                Beneficiary x;
                if (id > 0) { x = await db.Beneficiaries.FindAsync(id); if (x == null) return Err("Not found."); }
                else { x = new Beneficiary(); db.Beneficiaries.Add(x); }
                x.Type = type; x.NameEn = Trunc(en, 200); x.NameAr = Trunc(Str(b, "nameAr"), 200); x.Contact = Trunc(Str(b, "contact"), 150); x.Phone = Trunc(Str(b, "phone"), 50); x.Email = Trunc(Str(b, "email"), 150);
                await db.SaveChangesAsync();
                x.Code = code.Length > 0 ? Trunc(code, 30) : (string.IsNullOrEmpty(x.Code) ? "B-" + x.Id.ToString("0000", CultureInfo.InvariantCulture) : x.Code);
                Log(db, s, me, id > 0 ? "Beneficiary updated" : "Beneficiary added", "BEN-" + x.Id, $"{x.Code} · {en} · {type}");
                await db.SaveChangesAsync(); return Ok(new { ok = true, id = x.Id });
            }
            case "delBen":
            {
                if (!A.Has("beneficiaries", Perm.X)) return Err("Your role cannot delete beneficiaries.", 403);
                var id = Int(b, "id");
                if (await db.Cheques.AnyAsync(c => c.BenId == id)) return Err("Linked to cheques — it cannot be deleted.");
                if (await db.Contracts.AnyAsync(c => c.FinancierId == id)) return Err("Linked to a contract — it cannot be deleted.");
                var x = await db.Beneficiaries.FindAsync(id); if (x == null) return Err("Not found.");
                db.Beneficiaries.Remove(x); Log(db, s, me, "Beneficiary deleted", "BEN-" + id, x.NameEn);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }

            // ===================== banks, accounts, chequebooks =====================
            case "saveBank":
            {
                if (!A.Has("banks", Int(b, "id") > 0 ? Perm.E : Perm.C)) return Err("Your role cannot manage banks.", 403);
                var id = Int(b, "id"); var en = Str(b, "nameEn"); var cur = Str(b, "currency");
                if (en.Length < 2) return Err("Enter the bank name.");
                if (!Lists.Curs.Contains(cur)) return Err("Choose the currency.");
                Bank x;
                if (id > 0) { x = await db.Banks.FindAsync(id); if (x == null) return Err("Not found."); }
                else { x = new Bank(); db.Banks.Add(x); }
                if (id > 0 && x.Currency != cur && await (from ac in db.BankAccounts join ch in db.Cheques on (int?)ac.Id equals ch.AccountId where ac.BankId == id select ch.Id).AnyAsync())
                    return Err("Cheques were issued from this bank's accounts, so its currency cannot change.");
                x.NameEn = Trunc(en, 150); x.NameAr = Trunc(Str(b, "nameAr"), 150); x.Currency = cur; x.Active = id == 0 || Bool(b, "active");
                Log(db, s, me, id > 0 ? "Bank updated" : "Bank added", "BANK", $"{en} · {cur}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "saveAccount":
            {
                if (!A.Has("banks", Int(b, "id") > 0 ? Perm.E : Perm.C)) return Err("Your role cannot manage bank accounts.", 403);
                var id = Int(b, "id"); var bankId = Int(b, "bankId"); var entId = Int(b, "entityId"); var l4 = Str(b, "last4");
                if (!await db.Banks.AnyAsync(x => x.Id == bankId)) return Err("Choose the bank.");
                if (!await db.Entities.AnyAsync(x => x.Id == entId)) return Err("Choose the entity.");
                if (!Regex.IsMatch(l4, @"^\d{4}$")) return Err("Enter only the last 4 digits of the account number.");
                BankAccount x;
                if (id > 0) { x = await db.BankAccounts.FindAsync(id); if (x == null) return Err("Not found."); }
                else { x = new BankAccount(); db.BankAccounts.Add(x); }
                x.BankId = bankId; x.EntityId = entId; x.Last4 = l4; x.Description = Trunc(Str(b, "description"), 150); x.Ledger = Trunc(Str(b, "ledger"), 30); x.Active = id == 0 || Bool(b, "active");
                Log(db, s, me, id > 0 ? "Bank account updated" : "Bank account added", "ACCOUNT", $"••{l4} · {x.Description}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "saveBook":
            {
                if (!A.Has("books", Int(b, "id") > 0 ? Perm.E : Perm.C)) return Err("Your role cannot manage chequebooks.", 403);
                var id = Int(b, "id"); var accId = Int(b, "accountId");
                if (!await db.BankAccounts.AnyAsync(x => x.Id == accId)) return Err("Choose the account.");
                if (!long.TryParse(Str(b, "from"), NumberStyles.None, CultureInfo.InvariantCulture, out var from) || !long.TryParse(Str(b, "to"), NumberStyles.None, CultureInfo.InvariantCulture, out var to) || from <= 0 || to < from)
                    return Err("Enter the first and last cheque numbers (digits, last ≥ first).");
                if (to - from > 100000) return Err("A chequebook cannot have more than 100,000 numbers.");
                if (await db.Chequebooks.AnyAsync(k => k.Id != id && k.AccountId == accId && k.FromNo <= to && k.ToNo >= from)) return Err("This range overlaps another chequebook of the same account.");
                Chequebook x;
                if (id > 0) { x = await db.Chequebooks.FindAsync(id); if (x == null) return Err("Not found."); }
                else { x = new Chequebook { AddedBy = me, AddedAt = Clock.Stamp(s) }; db.Chequebooks.Add(x); }
                x.AccountId = accId; x.FromNo = from; x.ToNo = to; x.Active = id == 0 || Bool(b, "active");
                Log(db, s, me, id > 0 ? "Chequebook updated" : "Chequebook added", "BOOK", $"{from}–{to}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "voidNo":
            {
                if (!A.Has("voided", Perm.C)) return Err("Your role cannot record voided numbers.", 403);
                var accId = Int(b, "accountId"); var rs = Str(b, "reason");
                if (!long.TryParse(Str(b, "number"), NumberStyles.None, CultureInfo.InvariantCulture, out var no) || no <= 0) return Err("Enter the cheque number.");
                if (rs.Length < 2) return Err("Enter why it was voided.");
                if (!await db.Chequebooks.AnyAsync(k => k.AccountId == accId && k.FromNo <= no && k.ToNo >= no)) return Err("This number is not in a chequebook of the account.");
                if (await db.VoidedNos.AnyAsync(v => v.AccountId == accId && v.Number == no)) return Err("Already voided.");
                var noStr = no.ToString(CultureInfo.InvariantCulture);
                if (await db.Cheques.AnyAsync(x => x.AccountId == accId && x.ChequeNo == noStr)) return Err("This number is already used by a cheque.");
                db.VoidedNos.Add(new VoidedNo { AccountId = accId, Number = no, Reason = Trunc(rs, 300), By = me, At = Clock.Stamp(s) });
                Log(db, s, me, "Cheque number voided", "ACCOUNT-" + accId, $"#{no} · {rs}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }

            // ===================== contracts =====================
            case "saveContract":
            {
                var id = Int(b, "id");
                if (!A.Has("contracts", id > 0 ? Perm.E : Perm.C)) return Err("Your role cannot change the contracts register.", 403);
                var op = Str(b, "opNo"); var finId = Int(b, "financierId"); var entId = Int(b, "entityId"); var cur = Str(b, "currency");
                var pr = Math.Round(Dec(b, "principal"), 2); var pf = Math.Round(Dec(b, "profit"), 2); var term = Int(b, "termMonths"); var inst = Int(b, "instalments"); var start = Str(b, "startDate");
                if (op.Length < 2) return Err("Enter the operation number.");
                if (await db.Contracts.AnyAsync(x => x.OpNo == op && x.Id != id)) return Err($"Operation {op} is already registered.");
                var fin = await db.Beneficiaries.FindAsync(finId); if (fin == null || fin.Type != "Financier") return Err("Choose the financier (a beneficiary of type Financier).");
                if (!await db.Entities.AnyAsync(x => x.Id == entId)) return Err("Choose the entity.");
                if (!Lists.Curs.Contains(cur)) return Err("Choose the currency.");
                if (pr <= 0 || pf < 0) return Err("Enter the principal and the profit.");
                if (term < 1 || inst < 1) return Err("Enter the term in months and the number of instalments.");
                if (!Clock.ValidDate(start)) return Err("Enter the start date.");
                var notice = Int(b, "noticeDays"); if (notice == 0) notice = 30;
                if (notice < 1 || notice > 365) return Err("Start the follow-up between 1 and 365 days before expiry.");
                var owner = Int(b, "ownerId");
                if (owner > 0 && !await db.Users.AnyAsync(z => z.Id == owner && z.Active)) return Err("Choose an active user to follow up the contract.");
                Contract x;
                if (id > 0)
                {
                    x = await db.Contracts.FindAsync(id); if (x == null) return Err("Not found.");
                    var usedP = await (from ln in db.ChequeLines join ch in db.Cheques on ln.ChequeId equals ch.Id where ln.OpNo == x.OpNo && ch.Status != "Rejected" && ch.Status != "Cancelled" select (decimal?)ln.Principal).SumAsync() ?? 0m;
                    if (pr < usedP) return Err($"Principal cannot be less than what was already requested ({Fmt.Money(usedP, x.Currency)}).");
                    if (x.OpNo != op && usedP > 0) return Err("Requests already use this operation number, so it cannot change.");
                }
                else { x = new Contract { CreatedBy = me, CreatedAt = Clock.Stamp(s), Log = "[]", Status = "Active" }; db.Contracts.Add(x); }
                // expiry: as entered, otherwise the end of the term (an expiry set apart from the term is kept)
                var end = Clock.AddMonths(start, term);
                var exp = Str(b, "expiryDate");
                if (exp.Length == 0) exp = id > 0 && !string.IsNullOrEmpty(x.ExpiryDate) && x.ExpiryDate != x.EndDate ? x.ExpiryDate : end;
                if (!Clock.ValidDate(exp)) return Err("Enter the expiry date.");
                if (string.CompareOrdinal(exp, start) <= 0) return Err("The expiry date must be after the start date.");
                var oldExp = x.ExpiryDate;
                x.OpNo = Trunc(op, 50); x.FinancierId = finId; x.EntityId = entId; x.Currency = cur; x.Principal = pr; x.Profit = pf; x.TermMonths = term; x.Instalments = inst;
                x.StartDate = start; x.EndDate = end; x.Notes = Trunc(Str(b, "notes"), 500);
                x.ExpiryDate = exp; x.NoticeDays = notice; x.OwnerId = owner > 0 ? owner : null; if (string.IsNullOrEmpty(x.Status)) x.Status = "Active";
                x.Log = id > 0
                    ? AddLog(x.Log, Clock.Stamp(s), me, "Contract updated" + (oldExp != exp ? $" · expiry {Fmt.D(exp)}" : ""), "edit", null, oldExp != exp ? exp : null)
                    : AddLog(x.Log, Clock.Stamp(s), me, $"Contract registered · {Fmt.Money(pr, cur)} principal, {Fmt.Money(pf, cur)} profit, {term} months, {inst} instalments · expiry {Fmt.D(exp)}", "create", null, exp);
                Log(db, s, me, id > 0 ? "Contract updated" : "Contract registered", "CONTRACT", $"{op} · expiry {Fmt.D(exp)}");
                await db.SaveChangesAsync(); return Ok(new { ok = true, id = x.Id });
            }
            case "extendContract":
            {
                if (!A.Has("contracts", Perm.E)) return Err("Your role cannot change the contracts register.", 403);
                var x = await db.Contracts.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                if (x.Status == "Closed") return Err("This contract is closed. Reopen it first.");
                var add = Int(b, "months"); var inst = Int(b, "instalments"); var note = Str(b, "note");
                if (add < 1) return Err("Enter how many months to extend.");
                if (note.Length < 3) return Err("Add a note on the extension.");
                x.TermMonths += add; x.EndDate = Clock.AddMonths(x.StartDate, x.TermMonths); if (inst > 0) x.Instalments = inst;
                if (string.IsNullOrEmpty(x.ExpiryDate) || string.CompareOrdinal(x.ExpiryDate, x.EndDate) < 0) x.ExpiryDate = x.EndDate;
                x.Log = AddLog(x.Log, Clock.Stamp(s), me, $"Extended by {add} months to {Fmt.D(x.EndDate)}{(inst > 0 ? $", {inst} instalments" : "")} · {note}", "extend", note, x.EndDate);
                Log(db, s, me, "Contract extended", "CONTRACT", $"{x.OpNo} · +{add} months · {note}");
                await db.SaveChangesAsync();
                return Ok(new { ok = true, alert = "Check the 10% test (IFRS 9 B3.3.6): if the present value of the new terms differs by 10% or more from the current carrying amount, treat it as a new contract." });
            }
            case "followContract":
            {
                var x = await db.Contracts.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                if (!(A.Has("contracts", "follow") || (x.OwnerId == u.Id && A.Has("contracts")))) return Err("Your role cannot follow up contracts.", 403);
                if (x.Status == "Closed") return Err("This contract is closed. Reopen it first.");
                var note = Str(b, "note"); var next = Str(b, "nextDate");
                if (note.Length < 3) return Err("Write what was done or agreed.");
                if (next.Length > 0 && (!Clock.ValidDate(next) || Clock.DaysUntil(s, next) < 0)) return Err("The next follow-up date must be today or later.");
                x.FollowUpDate = next.Length > 0 ? next : null;
                x.Log = AddLog(x.Log, Clock.Stamp(s), me, "Follow-up: " + note + (next.Length > 0 ? $" · next follow-up {Fmt.D(next)}" : ""), "follow", note, next.Length > 0 ? next : null);
                Log(db, s, me, "Contract follow-up", "CONTRACT", $"{x.OpNo} · {note}{(next.Length > 0 ? " · next " + Fmt.D(next) : "")}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "renewContract":
            {
                if (!A.Has("contracts", Perm.E)) return Err("Your role cannot change the contracts register.", 403);
                var x = await db.Contracts.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                if (x.Status == "Closed") return Err("This contract is closed. Reopen it first.");
                var exp = Str(b, "expiryDate"); var note = Str(b, "note");
                var oldExp = string.IsNullOrEmpty(x.ExpiryDate) ? x.EndDate : x.ExpiryDate;
                if (!Clock.ValidDate(exp) || string.CompareOrdinal(exp, oldExp ?? "") <= 0) return Err("The new expiry date must be after the current one.");
                if (note.Length < 3) return Err("Add a note on the renewal, e.g. the renewal letter reference.");
                x.ExpiryDate = exp; x.FollowUpDate = null;
                x.Log = AddLog(x.Log, Clock.Stamp(s), me, $"Renewed until {Fmt.D(exp)} (was {Fmt.D(oldExp)}) · {note}", "renew", note, exp);
                Log(db, s, me, "Contract renewed", "CONTRACT", $"{x.OpNo} · {Fmt.D(oldExp)} → {Fmt.D(exp)} · {note}");
                await db.SaveChangesAsync();
                return Ok(new { ok = true, alert = "Check the 10% test (IFRS 9 B3.3.6): if the present value of the new terms differs by 10% or more from the current carrying amount, treat it as a new contract." });
            }
            case "closeContract":
            {
                if (!A.Has("contracts", Perm.E)) return Err("Your role cannot change the contracts register.", 403);
                var x = await db.Contracts.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                if (x.Status == "Closed") return Err("This contract is already closed.");
                var why = Str(b, "reason"); var note = Str(b, "note");
                if (!Lists.CloseReasons.Contains(why)) return Err("Choose why the contract is closed.");
                if (why == "Other" && note.Length < 3) return Err("Add a note on why it is closed.");
                var opNo = x.OpNo;
                var waiting = await (from ln in db.ChequeLines join ch in db.Cheques on ln.ChequeId equals ch.Id
                                     where ln.OpNo == opNo && (ch.Status == "Pending" || ch.Status == "Pending2" || ch.Status == "Approved")
                                     select ch.Id).FirstOrDefaultAsync();
                if (waiting != null) return Err($"{waiting} for this contract is still waiting to be approved or issued. Finish or cancel it first.");
                x.Status = "Closed"; x.ClosedAt = Clock.Stamp(s); x.ClosedBy = me; x.CloseReason = Trunc(why + (note.Length > 0 ? " · " + note : ""), 300); x.FollowUpDate = null;
                x.Log = AddLog(x.Log, Clock.Stamp(s), me, $"Closed · {why}{(note.Length > 0 ? " · " + note : "")}", "close", note.Length > 0 ? note : null, null, why);
                Log(db, s, me, "Contract closed", "CONTRACT", $"{x.OpNo} · {why}{(note.Length > 0 ? " · " + note : "")}");
                await db.SaveChangesAsync();
                return Ok(new { ok = true, alert = why == "Fully settled" ? "Derecognise the financing liability once the obligation is discharged, cancelled or expires (IFRS 9 para 3.3.1)." : null });
            }
            case "reopenContract":
            {
                if (!A.Has("contracts", Perm.E)) return Err("Your role cannot change the contracts register.", 403);
                var x = await db.Contracts.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                if (x.Status != "Closed") return Err("This contract is not closed.");
                var note = Str(b, "note"); if (note.Length < 3) return Err("Add a note on why it is reopened.");
                x.Status = "Active"; x.ClosedAt = null; x.ClosedBy = null; x.CloseReason = null;
                x.Log = AddLog(x.Log, Clock.Stamp(s), me, "Reopened · " + note, "reopen", note);
                Log(db, s, me, "Contract reopened", "CONTRACT", $"{x.OpNo} · {note}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "delContract":
            {
                if (!A.Has("contracts", Perm.X)) return Err("Your role cannot delete contracts.", 403);
                var x = await db.Contracts.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                var opNo = x.OpNo;
                if (await db.ChequeLines.AnyAsync(l => l.OpNo == opNo)) return Err("Requests use this operation number, so the contract cannot be deleted. Close it instead.");
                db.Contracts.Remove(x); Log(db, s, me, "Contract deleted", "CONTRACT", opNo);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }

            // ===================== journal entries =====================
            case "postEntry":
            case "unpostEntry":
            {
                if (!A.Has("entries", "post")) return Err("Your role cannot post journal entries.", 403);
                var key = Str(b, "key");
                if (!Regex.IsMatch(key, @"^((ISS|CLR|RET|POA)-CHQ-\d{4,}|(REV|RVR)-\d{8}-CHQ-\d{4,})$")) return Err("Unknown entry.");
                var entryChq = Regex.Match(key, @"CHQ-\d{4,}$").Value;
                if (!A.Sees(u, await db.Cheques.AsNoTracking().FirstOrDefaultAsync(x => x.Id == entryChq))) return Err("Unknown entry.");
                var ex = await db.PostedEntries.FindAsync(key);
                if (a == "postEntry")
                {
                    if (ex != null) return Err("Already marked as posted.");
                    db.PostedEntries.Add(new PostedEntry { Key = key, By = me, At = Clock.Stamp(s) });
                    Log(db, s, me, "Entry marked as posted", "ENTRY", key);
                }
                else
                {
                    if (ex == null) return Err("Not posted.");
                    db.PostedEntries.Remove(ex);
                    Log(db, s, me, "Entry unmarked", "ENTRY", key);
                }
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }

            // ===================== administration =====================
            case "saveDept":
            {
                if (!A.Has("departments", Int(b, "id") > 0 ? Perm.E : Perm.C)) return Err("Your role cannot manage departments.", 403);
                var id = Int(b, "id"); var en = Str(b, "nameEn"); if (en.Length < 2) return Err("The English name is required.");
                Department d;
                if (id > 0) { d = await db.Departments.FindAsync(id); if (d == null) return Err("Not found."); }
                else { d = new Department(); db.Departments.Add(d); }
                d.NameEn = Trunc(en, 150); d.NameAr = Trunc(Str(b, "nameAr"), 150);
                await db.SaveChangesAsync();
                Log(db, s, me, id > 0 ? "Department updated" : "Department added", "DEP-" + d.Id, en);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "delDept":
            {
                if (!A.Has("departments", Perm.X)) return Err("Your role cannot delete departments.", 403);
                var did = Int(b, "id"); var d = await db.Departments.FindAsync(did); if (d == null) return Err("Not found.");
                if (await db.Users.AnyAsync(z => z.DeptId == did)) return Err("Users belong to this department, so it cannot be deleted.");
                if (await db.Cheques.AnyAsync(c => c.DeptId == did)) return Err("This department has requests, so it cannot be deleted.");
                if (await db.Roles.AnyAsync(r => r.DeptId == did)) return Err("Roles belong to this department. Delete them or make them available to all departments first.");
                db.Departments.Remove(d); Log(db, s, me, "Department deleted", "DEP-" + did, d.NameEn);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "saveRole":
            {
                var id = Int(b, "id");
                if (!A.Has("roles", id > 0 ? Perm.E : Perm.C)) return Err("Your role cannot manage roles.", 403);
                var en = Str(b, "nameEn"); var ar = Str(b, "nameAr"); var dep = Int(b, "deptId"); int? deptId = dep > 0 ? dep : null;
                if (en.Length < 2) return Err("The English name is required.");
                if (deptId.HasValue && !await db.Departments.AnyAsync(d => d.Id == dep)) return Err("Choose a department.");
                var scope = Str(b, "scope"); if (!Perm.Scopes.Contains(scope)) return Err("Choose which cheques the role can see.");
                var perms = Perm.Parse(b.TryGetProperty("perms", out var pj) && pj.ValueKind == JsonValueKind.Object ? pj.GetRawText() : "{}");
                if (Perm.Powers.Any(w => Perm.Has(perms, w.Page, w.Op) && !A.Has(w.Page, w.Op))) return Err("You cannot give a role administration rights you do not have.", 403);
                Role x;
                if (id > 0)
                {
                    x = await db.Roles.FirstOrDefaultAsync(r => r.Id == id); if (x == null) return Err("Not found.");
                    if (Outranks(x.Key)) return Err("You cannot change a role that has more administration rights than yours.", 403);
                    if (x.BuiltIn && deptId.HasValue) return Err("Built-in roles are for all departments.");
                    var key = x.Key;
                    if (deptId.HasValue && await db.Users.AnyAsync(z => z.Role == key && z.DeptId != dep)) return Err("Users of other departments have this role. Give them another role first.");
                }
                else { x = new Role { Key = "T" + Convert.ToHexString(RandomNumberGenerator.GetBytes(4)), BuiltIn = false }; db.Roles.Add(x); }
                var sameName = (await db.Roles.AsNoTracking().Where(r => r.Id != id).ToListAsync()).Any(r => r.DeptId == deptId && string.Equals(r.NameEn, en, StringComparison.OrdinalIgnoreCase));
                if (sameName) return Err("A role with this name already exists for this department.");
                x.NameEn = Trunc(en, 100); x.NameAr = Trunc(ar, 100); x.DeptId = deptId; x.Scope = scope; x.Perms = Perm.Write(perms);
                x.Notes = Trunc(Str(b, "notes"), 300); x.UpdatedBy = me; x.UpdatedAt = Clock.Stamp(s);
                await db.SaveChangesAsync();
                if (id == 0) x.Key = "R" + x.Id.ToString(CultureInfo.InvariantCulture);
                var dn = deptId.HasValue ? (await db.Departments.FindAsync(dep))?.NameEn : "all departments";
                Log(db, s, me, id > 0 ? "Role updated" : "Role added", "ROLE-" + x.Id, $"{en} · {dn} · sees {scope} · {Perm.Summary(perms)}");
                await db.SaveChangesAsync(); return Ok(new { ok = true, id = x.Id, key = x.Key });
            }
            case "delRole":
            {
                if (!A.Has("roles", Perm.X)) return Err("Your role cannot delete roles.", 403);
                var rid = Int(b, "id"); var x = await db.Roles.FirstOrDefaultAsync(r => r.Id == rid); if (x == null) return Err("Not found.");
                if (x.BuiltIn) return Err("Built-in roles cannot be deleted.");
                if (Outranks(x.Key)) return Err("You cannot change a role that has more administration rights than yours.", 403);
                var key = x.Key;
                if (await db.Users.AnyAsync(z => z.Role == key)) return Err("Users have this role. Give them another role first.");
                db.Roles.Remove(x); Log(db, s, me, "Role deleted", "ROLE-" + rid, x.NameEn);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "saveEntity":
            {
                if (!A.Has("entities", Int(b, "id") > 0 ? Perm.E : Perm.C)) return Err("Your role cannot manage entities.", 403);
                var id = Int(b, "id"); var en = Str(b, "nameEn"); var fc = Str(b, "funcCur");
                if (en.Length < 2) return Err("The English name is required.");
                if (!Lists.Curs.Contains(fc)) return Err("Choose the functional currency.");
                Entity e;
                if (id > 0) { e = await db.Entities.FindAsync(id); if (e == null) return Err("Not found."); }
                else { e = new Entity(); db.Entities.Add(e); }
                if (id > 0 && e.FuncCur != fc && await db.Cheques.AnyAsync(c => c.EntityId == id && c.ApprovedBy != null))
                    return Err("Approved cheques use this entity's functional currency, so it cannot change.");
                e.NameEn = Trunc(en, 150); e.NameAr = Trunc(Str(b, "nameAr"), 150); e.FuncCur = fc;
                Log(db, s, me, id > 0 ? "Entity updated" : "Entity added", "ENTITY", $"{en} · {fc}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "confirmFunc":
            {
                if (!A.Has("entities", Perm.E)) return Err("Not allowed.", 403);
                s.FuncConfirmed = true; await ss.Save(db, s);
                Log(db, s, me, "Functional currencies confirmed", "SETTINGS", ""); await db.SaveChangesAsync();
                return Ok(new { ok = true });
            }
            case "saveUser":
            {
                var id = Int(b, "id");
                if (!A.Has("users", id > 0 ? Perm.E : Perm.C)) return Err("Your role cannot manage user accounts.", 403);
                var full = Str(b, "fullName"); var fullAr = Str(b, "fullNameAr"); var un = Str(b, "username").ToLowerInvariant(); var role = Str(b, "role"); var dep = Int(b, "deptId");
                var email = Str(b, "email").ToLowerInvariant(); var lang = Str(b, "lang") == "ar" ? "ar" : "en";
                var active = Bool(b, "active"); var must = Bool(b, "mustChange"); var twoFa = Bool(b, "twoFa"); var pw = Str(b, "password", false);
                if (full.Length < 2) return Err("The full name is required.");
                if (!Regex.IsMatch(un, "^[a-z0-9._-]{3,}$")) return Err("Username: at least 3 characters — letters, numbers, dot, dash or underscore, no spaces.");
                if (!ValidEmail(email)) return Err("Email is required. It is used to reset the password.");
                var rr = roles.FirstOrDefault(r => r.Key == role); if (rr == null) return Err("Choose a role.");
                if (!await db.Departments.AnyAsync(d => d.Id == dep)) return Err("Choose a department.");
                if (rr.DeptId.HasValue && rr.DeptId != dep) return Err("This role belongs to another department. Choose a role of the user's department or one for all departments.");
                if (await db.Users.AnyAsync(x => x.Id != id && x.Username == un)) return Err("This username is already taken.");
                if (await db.Users.AnyAsync(x => x.Id != id && x.Email == email)) return Err("This email is already used by another user.");
                if (id == u.Id && !active) return Err("You cannot disable your own account.");
                if (id == u.Id && role != u.Role) return Err("You cannot change your own role.");
                if (Outranks(role)) return Err("You cannot give a role that has more administration rights than yours.", 403);
                if (twoFa && !Mailer.Ready(s)) return Err("Set up email first (Settings › Email): two-step verification sends the code by email.");
                if (pw.Length > 0 || id == 0) { var pe = Pwd.Check(pw, s.Policy); if (pe != null) return Err(pe); }
                AppUser x;
                if (id > 0)
                {
                    x = await db.Users.FindAsync(id); if (x == null) return Err("Not found.");
                    if (x.Id != u.Id && Outranks(x.Role)) return Err("You cannot change an account that has more administration rights than yours.", 403);
                }
                else { x = new AppUser(); db.Users.Add(x); }
                if (id > 0 && x.Role == Roles.CFO && (role != Roles.CFO || !active) && !await db.Users.AnyAsync(y => y.Id != id && y.Role == Roles.CFO && y.Active))
                    return Err("At least one active CFO is required.");
                x.FullName = Trunc(full, 150); x.FullNameAr = Trunc(fullAr, 150); x.Username = un; x.Email = Trunc(email, 150); x.Lang = lang; x.Role = role; x.DeptId = dep; x.Active = active; x.MustChange = must; x.TwoFa = twoFa;
                if (pw.Length > 0) { x.PwdHash = Pwd.Hash(pw); x.PwdChangedAt = Clock.Today(s); x.Failed = 0; x.LockedUntilUtc = null; }
                await db.SaveChangesAsync();
                var dn = (await db.Departments.FindAsync(dep))?.NameEn;
                Log(db, s, me, id > 0 ? "User updated" : "User created", "USR-" + x.Id, $"{full}{(fullAr.Length > 0 ? " / " + fullAr : "")} · {rr.NameEn} · {dn} · {email}{(twoFa ? " · two-step on" : "")}{(pw.Length > 0 && id > 0 ? " · password set" : "")}");
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "unlockUser":
            {
                if (!A.Has("users", Perm.E)) return Err("Not allowed.", 403);
                var x = await db.Users.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                if (Outranks(x.Role)) return Err("You cannot change an account that has more administration rights than yours.", 403);
                x.LockedUntilUtc = null; x.Failed = 0; Log(db, s, me, "Account unlocked", "USR-" + x.Id, x.FullName);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "sendReset":
            {
                if (!A.Has("users", Perm.E)) return Err("Not allowed.", 403);
                var x = await db.Users.FindAsync(Int(b, "id")); if (x == null) return Err("Not found.");
                if (Outranks(x.Role)) return Err("You cannot change an account that has more administration rights than yours.", 403);
                var err = await SendReset(db, s, mail, x, BaseUrl(ctx));
                if (err != null) return Err(err);
                Log(db, s, me, "Password reset link sent", "USR-" + x.Id, x.Email);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "setLang":
            {
                u.Lang = Str(b, "lang") == "ar" ? "ar" : "en";
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "saveSettings":
            {
                var sec = Str(b, "section");
                if (!A.Has(sec == "policy" ? "security" : "settings", Perm.E)) return Err("Your role cannot change these settings.", 403);
                if (sec == "alerts")
                {
                    var d = Int(b, "alertDays"); if (d < 1 || d > 90) return Err("The alert window must be 1–90 days.");
                    var t = Str(b, "alertTime"); if (!TimeSpan.TryParse(t, CultureInfo.InvariantCulture, out _)) return Err("Invalid time.");
                    s.AlertDays = d; s.AlertTime = t; s.HideTelegram = Bool(b, "hideTelegram");
                    if (b.TryGetProperty("tgEvents", out var ev) && ev.ValueKind == JsonValueKind.Object)
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
                    var c = Str(b, "company"); if (c.Length < 2) return Err("The company name is required.");
                    s.Company = Trunc(c, 150);
                    var rc = Str(b, "reportCurrency"); if (Lists.Curs.Contains(rc)) s.ReportCurrency = rc;
                    var tz = Str(b, "timeZone"); if (!string.IsNullOrEmpty(tz)) { try { TimeZoneInfo.FindSystemTimeZoneById(tz); s.TimeZone = tz; } catch { return Err("Unknown time zone."); } }
                    if (b.TryGetProperty("logo", out var lg) && lg.ValueKind == JsonValueKind.String)
                    {
                        var l = lg.GetString() ?? "";
                        if (l.Length > 400_000) return Err("The logo is too large (max about 250 KB).");
                        if (l.Length > 0 && !l.StartsWith("data:image/", StringComparison.Ordinal)) return Err("The logo must be an image.");
                        s.Logo = l;
                    }
                }
                else if (sec == "approval")
                {
                    var lim = Dec(b, "secondLimitUsd"); var pct = Dec(b, "rateAlertPct");
                    if (lim <= 0) return Err("Enter the second-approval limit in USD.");
                    if (pct <= 0 || pct > 100) return Err("Enter the rate alert percentage (for example 5).");
                    s.SecondLimitUsd = Math.Round(lim, 2); s.RateAlertPct = Math.Round(pct, 2);
                }
                else if (sec == "accounts")
                {
                    string Acc(string k) => Trunc(Str(b, k), 30);
                    var nos = new AccountNos { Payables = Acc("payables"), Deferred = Acc("deferred"), FinPrincipal = Acc("finPrincipal"), FinProfit = Acc("finProfit"), Poa = Acc("poa"), FxDiff = Acc("fxDiff") };
                    if (new[] { nos.Payables, nos.Deferred, nos.FinPrincipal, nos.FinProfit, nos.Poa, nos.FxDiff }.Any(x => x.Length == 0)) return Err("Enter all six account numbers.");
                    s.Acc = nos;
                }
                else if (sec == "smtp")
                {
                    var host = Str(b, "host"); var from = Str(b, "from").ToLowerInvariant();
                    if (host.Length > 0 && !ValidEmail(from)) return Err("Enter the sender email address.");
                    s.Smtp.Host = Trunc(host, 150); s.Smtp.Port = Math.Clamp(Int(b, "port"), 1, 65535); s.Smtp.User = Trunc(Str(b, "user"), 150);
                    s.Smtp.From = Trunc(from, 150); s.Smtp.FromName = Trunc(Str(b, "fromName"), 100); s.Smtp.Ssl = Bool(b, "ssl");
                    var pass = Str(b, "password", false); if (pass.Length > 0) ss.SetSmtpPass(s, pass);
                    if (host.Length == 0) ss.SetSmtpPass(s, "");
                }
                else return Err("Unknown section.");
                await ss.Save(db, s);
                Log(db, s, me, "Settings changed", "SETTINGS", sec);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "testEmail":
            {
                if (!A.Has("settings", Perm.E)) return Err("Not allowed.", 403);
                if (string.IsNullOrWhiteSpace(u.Email)) return Err("Add your own email to your user first.");
                var err = await mail.Send(s, u.Email, "ChequeTrack test email", Mailer.Layout(u.Lang == "ar", "Email works", "<p>ChequeTrack can now send password reset links and sign-in codes.</p>"));
                if (err != null) return Err(err);
                return Ok(new { ok = true });
            }
            case "tgConnect":
            {
                if (!A.Has("telegram", Perm.E)) return Err("Your role cannot manage Telegram.", 403);
                var ch = Str(b, "channel"); var tk = Str(b, "token");
                if (!Regex.IsMatch(ch, @"^(@[A-Za-z0-9_]{4,}|-100\d{6,})$")) return Err("The channel must look like @channelname or -100…");
                if (tk.Length == 0) tk = ss.Token(s);
                if (!Regex.IsMatch(tk ?? "", @"^\d{6,}:[A-Za-z0-9_-]{20,}$")) return Err("That does not look like a bot token (format 123456789:AA…).");
                var err = await tg.Send(tk, ch, $"✅ <b>ChequeTrack connected</b>\nAlerts for {Fmt.H(s.Company)} will be posted here.");
                if (err != null) return Err(err + " — check the token, the channel ID, and that the bot is an admin of the channel.");
                s.TelegramChannel = ch; ss.SetToken(s, tk); await ss.Save(db, s);
                Log(db, s, me, "Telegram connected", "SETTINGS", "Channel " + ch);
                await db.SaveChangesAsync(); return Ok(new { ok = true });
            }
            case "tgDisconnect":
            {
                if (!A.Has("telegram", Perm.E)) return Err("Your role cannot manage Telegram.", 403);
                ss.SetToken(s, ""); await ss.Save(db, s); Log(db, s, me, "Telegram disconnected", "SETTINGS", ""); await db.SaveChangesAsync();
                return Ok(new { ok = true });
            }
            case "sendDigest":
            {
                if (!A.Has("telegram", "send")) return Err("Not allowed.", 403);
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
static void Log(AppDb db, AppSettings s, string user, string action, string entity, string details)
    => db.Audit.Add(new AuditEntry { At = Clock.Stamp(s), User = user ?? "", Action = action ?? "", Entity = entity ?? "", Details = Trunc(details, 1000) });
static string Trunc(string v, int n) => v == null ? "" : (v.Length > n ? v.Substring(0, n) : v);
static string Sha(string v) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(v ?? ""))).ToLowerInvariant();
static bool ValidEmail(string e) => !string.IsNullOrEmpty(e) && e.Length <= 150 && Regex.IsMatch(e, @"^[^@\s]+@[^@\s]+\.[^@\s]+$");
static string Mask(string e)
{
    var i = (e ?? "").IndexOf('@');
    return i <= 1 ? e : e.Substring(0, 1) + new string('•', Math.Min(6, i - 1)) + e.Substring(i);
}
static string AddLog(string json, string at, string by, string text, string kind = null, string note = null, string date = null, string reason = null)
{
    List<Dictionary<string, string>> list;
    try { list = JsonSerializer.Deserialize<List<Dictionary<string, string>>>(string.IsNullOrEmpty(json) ? "[]" : json) ?? new(); } catch { list = new(); }
    var e = new Dictionary<string, string> { ["at"] = at, ["by"] = by, ["text"] = text };
    if (kind != null) e["kind"] = kind;
    if (note != null) e["note"] = note;
    if (date != null) e["date"] = date;
    if (reason != null) e["reason"] = reason;
    list.Add(e);
    return JsonSerializer.Serialize(list);
}
static async Task<Rate> RateOn(AppDb db, string date) =>
    await db.Rates.AsNoTracking().Where(r => string.Compare(r.Date, date) <= 0).OrderByDescending(r => r.Date).FirstOrDefaultAsync();
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
