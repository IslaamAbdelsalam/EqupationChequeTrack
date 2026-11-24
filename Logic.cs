using System.Globalization;
using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace ChequeTrack;

public class Policy
{
    public int MinLen { get; set; } = 8;
    public bool Upper { get; set; } = true;
    public bool Digit { get; set; } = true;
    public bool Special { get; set; } = true;
    public int ExpiryDays { get; set; } = 90;
    public int MaxAttempts { get; set; } = 5;
    public int LockMinutes { get; set; } = 15;
    public bool FirstChange { get; set; } = true;
    public int SessionMin { get; set; } = 30;
}

/// Default account numbers for the proposed journal entries (editable in Settings).
public class AccountNos
{
    public string Payables { get; set; } = "2101";
    public string Deferred { get; set; } = "2150";
    public string FinPrincipal { get; set; } = "2200";
    public string FinProfit { get; set; } = "2300";
    public string Poa { get; set; } = "1300";
    public string FxDiff { get; set; } = "7400";
}

public class SmtpCfg
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string User { get; set; } = "";
    public string PassEnc { get; set; } = "";
    public string From { get; set; } = "";
    public string FromName { get; set; } = "ChequeTrack";
    public bool Ssl { get; set; } = true;
}

public class AppSettings
{
    public int AlertDays { get; set; } = 7;
    public string AlertTime { get; set; } = "09:00";
    public string TelegramChannel { get; set; } = "";
    public string BotTokenEnc { get; set; } = "";
    public Dictionary<string, bool> TgEvents { get; set; } = new()
    {
        ["approved"] = true, ["approved2"] = true, ["issued"] = true, ["received"] = true, ["delivered"] = true,
        ["cleared"] = true, ["returned"] = true, ["solved"] = true, ["rejected"] = true
    };
    public bool HideTelegram { get; set; }
    public string ReportCurrency { get; set; } = "USD";
    public string Company { get; set; } = "Equpation";
    public string TimeZone { get; set; } = "Africa/Khartoum";
    public string CronKey { get; set; } = "";
    public string Logo { get; set; } = "";
    public List<string> Banks { get; set; } = new();          // v1 free-text banks (kept for old data)
    public Policy Policy { get; set; } = new();
    // One-time CFO reset, triggered from Azure with the CFO_RESET app setting
    public string CfoResetDone { get; set; } = "";
    public int CfoResetUser { get; set; } = -1;   // -1 none pending, 0 create a new CFO, >0 user id to re-create
    // v2
    public decimal SecondLimitUsd { get; set; } = 10000m;
    public decimal RateAlertPct { get; set; } = 5m;
    public AccountNos Acc { get; set; } = new();
    public SmtpCfg Smtp { get; set; } = new();
    public bool FuncConfirmed { get; set; }
}

/// Keys of the six built-in roles. Added roles get the key R{id}.
public static class Roles
{
    public const string TOP = "TOP", CFO = "CFO", FIN = "FIN", USER = "USER", ADMIN = "ADMIN", AUDIT = "AUDIT";
}

/// What a role may do: for each page, "view" opens it, create/edit/delete are the rights on its records,
/// and the other operations are workflow steps on that page. The server checks every action against this.
public static class Perm
{
    public const string V = "view", C = "create", E = "edit", X = "delete";
    public static readonly string[] Scopes = { "own", "dept", "all" };

    public sealed record Page(string Key, string Group, string[] Ops);
    public static readonly Page[] Catalog =
    {
        new("requests", "ops", new[] { V, C, X }),            // own requests: raise, cancel while pending
        new("cheques", "ops", new[] { V }),                   // the cheques list (own department or all, by scope)
        new("approvals", "ops", new[] { V, "approve", "approve2" }),
        new("issue", "ops", new[] { V, "issue" }),
        new("followup", "ops", new[] { V, "clear", "settle" }),
        new("contracts", "ops", new[] { V, C, E, X, "follow" }),
        new("poa", "ops", new[] { V, "settle" }),
        new("rates", "ops", new[] { V, C, E }),
        new("reports", "fin", new[] { V }),
        new("entries", "fin", new[] { V, "post" }),
        new("banks", "fin", new[] { V, C, E }),
        new("books", "fin", new[] { V, C, E }),
        new("voided", "fin", new[] { V, C }),
        new("users", "users", new[] { V, C, E }),
        new("roles", "users", new[] { V, C, E, X }),
        new("departments", "users", new[] { V, C, E, X }),
        new("security", "users", new[] { V, E }),             // sign-in and password policy
        new("beneficiaries", "data", new[] { V, C, E, X }),
        new("entities", "data", new[] { V, C, E }),
        new("settings", "system", new[] { V, E }),
        new("telegram", "system", new[] { V, E, "send" }),
        new("audit", "system", new[] { V }),
        new("checklist", "system", new[] { V }),
    };
    static readonly Dictionary<string, string[]> OpsOf = Catalog.ToDictionary(p => p.Key, p => p.Ops);

    /// Rights only an administrator may hand out: nobody can give a role (or an account) more of these than they hold.
    public static readonly (string Page, string Op)[] Powers =
        { ("users", C), ("users", E), ("roles", C), ("roles", E), ("roles", X), ("security", E), ("settings", E) };

    public static Dictionary<string, HashSet<string>> Parse(string json)
    {
        var p = new Dictionary<string, HashSet<string>>();
        Dictionary<string, string[]> raw;
        try { raw = JsonSerializer.Deserialize<Dictionary<string, string[]>>(string.IsNullOrWhiteSpace(json) ? "{}" : json); } catch { raw = null; }
        if (raw == null) return p;
        foreach (var (page, ops) in raw)
        {
            if (page == null || ops == null || !OpsOf.TryGetValue(page, out var allowed)) continue;
            var set = new HashSet<string>(ops.Where(o => allowed.Contains(o)));
            if (set.Count > 0) p[page] = set;
        }
        return p;
    }
    public static string Write(Dictionary<string, HashSet<string>> p) =>
        JsonSerializer.Serialize(Catalog.Where(c => p.TryGetValue(c.Key, out var s) && s.Count > 0)
            .ToDictionary(c => c.Key, c => c.Ops.Where(o => p[c.Key].Contains(o)).ToArray()));
    public static Dictionary<string, string[]> View(Dictionary<string, HashSet<string>> p) =>
        Catalog.Where(c => p.TryGetValue(c.Key, out var s) && s.Count > 0).ToDictionary(c => c.Key, c => c.Ops.Where(o => p[c.Key].Contains(o)).ToArray());
    public static bool Has(Dictionary<string, HashSet<string>> p, string page, string op = V) => p.TryGetValue(page, out var s) && s.Contains(op);
    public static bool IsAdmin(Dictionary<string, HashSet<string>> p) => Has(p, "users", E) && Has(p, "roles", E);
    public static string Summary(Dictionary<string, HashSet<string>> p) => p.Count == 0 ? "no access" : $"{p.Count} pages, {p.Sum(x => x.Value.Count)} rights";

    static Dictionary<string, HashSet<string>> P(params string[] items)
    {
        var p = new Dictionary<string, HashSet<string>>();
        foreach (var it in items) { var i = it.IndexOf(':'); p[it[..i]] = new HashSet<string>(it[(i + 1)..].Split(',')); }
        return p;
    }

    /// The six built-in roles carry exactly the access the fixed roles had before roles became editable.
    public static readonly (string Key, string En, string Ar, string Scope, Dictionary<string, HashSet<string>> P)[] BuiltIns =
    {
        (Roles.USER, "Department User", "مستخدم إدارة", "own", P("requests:view,create,delete", "rates:view", "beneficiaries:create")),
        (Roles.FIN, "Finance", "المالية", "all", P("requests:view,create,delete", "cheques:view", "issue:view,issue", "followup:view,clear,settle",
            "contracts:view,create,edit,delete,follow", "poa:view,settle", "rates:view,create,edit", "reports:view", "entries:view,post",
            "banks:view", "books:view", "voided:view,create", "beneficiaries:view,create,edit,delete", "telegram:view,send")),
        (Roles.CFO, "CFO", "المدير المالي", "all", P("requests:view,create,delete", "cheques:view", "approvals:view,approve", "followup:view,clear,settle",
            "contracts:view,follow", "poa:view", "rates:view", "reports:view", "entries:view", "banks:view,create,edit", "books:view,create,edit",
            "voided:view,create", "beneficiaries:view,create", "telegram:view,edit,send", "checklist:view")),
        (Roles.TOP, "Top Management", "الإدارة العليا", "all", P("requests:view,create,delete", "cheques:view", "approvals:view,approve2", "followup:view",
            "contracts:view", "poa:view", "rates:view", "reports:view", "entries:view", "banks:view", "books:view", "voided:view",
            "beneficiaries:view,create", "telegram:view,send")),
        (Roles.ADMIN, "System Admin", "مسؤول النظام", "all", P("cheques:view", "followup:view", "contracts:view", "poa:view", "rates:view", "reports:view",
            "entries:view", "banks:view", "books:view", "voided:view", "users:view,create,edit", "roles:view,create,edit,delete",
            "departments:view,create,edit,delete", "security:view,edit", "beneficiaries:view", "entities:view,create,edit",
            "settings:view,edit", "telegram:view,edit,send", "audit:view", "checklist:view")),
        (Roles.AUDIT, "Auditor", "مدقق", "all", P("cheques:view", "followup:view", "contracts:view", "poa:view", "rates:view", "reports:view",
            "entries:view", "banks:view", "books:view", "voided:view", "roles:view", "beneficiaries:view", "telegram:view", "audit:view")),
    };

    /// Until some active user has a role that manages users and roles, the CFO also does that job (as before).
    public static readonly Dictionary<string, HashSet<string>> CfoActingAdmin = P("users:view,create,edit", "roles:view,create,edit,delete",
        "departments:view,create,edit,delete", "security:view,edit", "entities:view,create,edit", "settings:view,edit", "telegram:view,edit,send",
        "audit:view", "checklist:view");
}

/// The effective access of one signed-in user.
public sealed class Access
{
    public string Scope { get; init; } = "own";
    public Dictionary<string, HashSet<string>> P { get; init; } = new();
    public bool Has(string page, string op = Perm.V) => Perm.Has(P, page, op);
    /// Whether the user may see (and act on) this cheque.
    public bool Sees(AppUser u, Cheque c) => c != null && (Scope == "all" || c.RequesterId == u.Id || (Scope == "dept" && c.DeptId == u.DeptId));
    public static Access Of(AppUser u, IEnumerable<Role> roles, bool anyAdmin)
    {
        var r = roles.FirstOrDefault(x => x.Key == u.Role);
        var p = r == null ? new Dictionary<string, HashSet<string>>() : Perm.Parse(r.Perms);
        if (u.Role == Roles.CFO && !anyAdmin)
            foreach (var (page, ops) in Perm.CfoActingAdmin)
            {
                if (!p.TryGetValue(page, out var set)) p[page] = set = new HashSet<string>();
                set.UnionWith(ops);
            }
        return new Access { Scope = r != null && Perm.Scopes.Contains(r.Scope) ? r.Scope : "own", P = p };
    }
}

public static class St
{
    public static readonly string[] Open = { "Approved", "Posted", "Received", "Delivered", "Returned" };
    public static readonly string[] Dead = { "Rejected", "Cancelled" };
}

public static class Lists
{
    public static readonly string[] Curs = { "USD", "QAR", "SDG" };
    public const string Poa = "Payment on account";
    public static readonly string[] OpTypes = { "Supplier payment", "Financing instalment", "Final settlement", "Institutional instalment", Poa, "Other" };
    public static readonly string[] Financing = { "Financing instalment", "Final settlement", "Institutional instalment" };
    public static readonly string[] CommentKinds = { "Query", "Document change", "Modification", "Answer", "Note" };
    public static readonly string[] CommentTo = { "all", "requester", "approver", "finance", "user" };
    public static readonly string[] SplitRequired = { "Final settlement", "Institutional instalment" };
    public static readonly string[] Purposes = { "Payment", "Guarantee" };
    public static readonly string[] BenTypes = { "Supplier", "Financier", "Customer", "Employee", "Other" };
    public static readonly string[] SolveMethods = { "Replacement cheque", "Transfer", "Obligation cancelled" };
    public static readonly string[] Priorities = { "Normal", "Urgent" };
    public static readonly string[] CloseReasons = { "Fully settled", "Not renewed", "Cancelled", "Other" };
}

public static class Fx
{
    public static decimal PerUsd(string cur, decimal qar, decimal sdg) => cur == "USD" ? 1m : cur == "QAR" ? qar : sdg;
    public static decimal Conv(decimal amount, string from, string to, decimal qar, decimal sdg)
    {
        if (from == to) return amount;
        var f = PerUsd(from, qar, sdg); var t = PerUsd(to, qar, sdg);
        if (f <= 0) return 0m;
        return amount / f * t;
    }
    /// SDG has no fractions; USD and QAR use two decimals.
    public static decimal Round(decimal v, string cur) => Math.Round(v, cur == "SDG" ? 0 : 2, MidpointRounding.AwayFromZero);
}

public class SettingsStore
{
    static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    readonly IDataProtector _p, _m;
    public SettingsStore(IDataProtectionProvider dp)
    {
        _p = dp.CreateProtector("ChequeTrack.Telegram.v1");
        _m = dp.CreateProtector("ChequeTrack.Smtp.v1");
    }

    // Speed: the settings row is read on every request, so its JSON is kept in memory for 60 seconds
    // (and replaced at once on Save). Each caller still gets its own copy, so changes never leak.
    static string _json; static DateTime _jsonExp;
    static readonly object _lk = new();
    public async Task<AppSettings> Get(AppDb db)
    {
        string json;
        lock (_lk) json = _json != null && DateTime.UtcNow < _jsonExp ? _json : null;
        if (json == null)
        {
            var row = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == "app");
            json = row?.Value ?? "";
            lock (_lk) { _json = json; _jsonExp = DateTime.UtcNow.AddSeconds(60); }
        }
        if (string.IsNullOrWhiteSpace(json)) return Fix(new AppSettings());
        try { return Fix(JsonSerializer.Deserialize<AppSettings>(json, J) ?? new AppSettings()); }
        catch { return Fix(new AppSettings()); }
    }

    static AppSettings Fix(AppSettings s)
    {
        s.Policy ??= new Policy(); s.Acc ??= new AccountNos(); s.Smtp ??= new SmtpCfg(); s.Banks ??= new List<string>();
        s.TgEvents ??= new Dictionary<string, bool>();
        if (!s.TgEvents.ContainsKey("approved2")) s.TgEvents["approved2"] = true;
        if (s.SecondLimitUsd <= 0) s.SecondLimitUsd = 10000m;
        if (s.RateAlertPct <= 0) s.RateAlertPct = 5m;
        return s;
    }

    public async Task Save(AppDb db, AppSettings s)
    {
        var row = await db.Settings.FirstOrDefaultAsync(x => x.Key == "app");
        var json = JsonSerializer.Serialize(s, J);
        if (row == null) db.Settings.Add(new Setting { Key = "app", Value = json });
        else row.Value = json;
        await db.SaveChangesAsync();
        lock (_lk) { _json = json; _jsonExp = DateTime.UtcNow.AddSeconds(60); }
    }

    // Secrets live on the server only. An environment variable (Azure App Service > Environment variables) wins over
    // the encrypted copy saved from the Settings screen, so production secrets never need to be typed into the app.
    static string Env(string k) { var v = Environment.GetEnvironmentVariable(k); return string.IsNullOrWhiteSpace(v) ? null : v.Trim(); }
    public static bool TokenFromEnv => Env("TELEGRAM_BOT_TOKEN") != null;
    public static bool SmtpPassFromEnv => Env("SMTP_PASSWORD") != null;
    /// <summary>Key of the daily-alert URL: CRON_KEY if set, otherwise the random key saved at setup.</summary>
    public string CronKey(AppSettings s) => Env("CRON_KEY") ?? s.CronKey ?? "";

    public string Token(AppSettings s)
    {
        var env = Env("TELEGRAM_BOT_TOKEN"); if (env != null) return env;
        if (string.IsNullOrEmpty(s.BotTokenEnc)) return "";
        try { return _p.Unprotect(s.BotTokenEnc); } catch { return ""; }
    }
    public void SetToken(AppSettings s, string token) => s.BotTokenEnc = string.IsNullOrEmpty(token) ? "" : _p.Protect(token);

    public string SmtpPass(AppSettings s)
    {
        var env = Env("SMTP_PASSWORD"); if (env != null) return env;
        if (string.IsNullOrEmpty(s.Smtp?.PassEnc)) return "";
        try { return _m.Unprotect(s.Smtp.PassEnc); } catch { return ""; }
    }
    public void SetSmtpPass(AppSettings s, string pass) => s.Smtp.PassEnc = string.IsNullOrEmpty(pass) ? "" : _m.Protect(pass);
}

/// <summary>
/// Change signal for the notifications. Every saved change bumps the number; browsers poll /api/pulse
/// (no database access, so Azure SQL free time is not used) and reload their data only when it moved.
/// Boot changes when the app restarts, so clients reload once after a deployment.
/// </summary>
public static class Pulse
{
    static long _v;
    public static readonly string Boot = Guid.NewGuid().ToString("N")[..8];
    public static string Key => Boot + ":" + Interlocked.Read(ref _v);
    public static void Bump() => Interlocked.Increment(ref _v);
    /// <summary>Actions that change only the signed-in user's own view: they do not wake the other screens.</summary>
    public static readonly HashSet<string> Private = new() { "readComments", "setLang", "seenNotifs", "testEmail" };
}

public static class Clock
{
    public static TimeZoneInfo Zone(AppSettings s)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(s.TimeZone) ? "Africa/Khartoum" : s.TimeZone); }
        catch { return TimeZoneInfo.Utc; }
    }
    public static DateTime Now(AppSettings s) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone(s));
    public static string Stamp(AppSettings s) => Now(s).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
    public static string Today(AppSettings s) => Now(s).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static int DaysUntil(AppSettings s, string date)
    {
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return 9999;
        return (int)(d.Date - Now(s).Date).TotalDays;
    }
    public static bool ValidDate(string d) => DateTime.TryParseExact(d ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    public static string AddMonths(string d, int months) =>
        DateTime.TryParseExact(d ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var x)
            ? x.AddMonths(months).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "";
}

public static class Fmt
{
    public static string Money(decimal v, string cur) =>
        v.ToString(cur == "SDG" ? "N0" : "N2", CultureInfo.InvariantCulture) + (string.IsNullOrEmpty(cur) ? "" : " " + cur);
    public static string First(string s) => (s ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
    public static string H(string s) => WebUtility.HtmlEncode(s ?? "");
    /// yyyy-MM-dd[ HH:mm] → dd/MM/yyyy[ HH:mm]
    public static string D(string iso)
    {
        if (string.IsNullOrEmpty(iso) || iso.Length < 10) return iso ?? "";
        var d = iso.Substring(8, 2) + "/" + iso.Substring(5, 2) + "/" + iso.Substring(0, 4);
        return iso.Length > 10 ? d + iso.Substring(10) : d;
    }
}

public static class Pwd
{
    public static string Check(string pw, Policy p)
    {
        pw ??= "";
        if (pw.Length < p.MinLen) return $"Password must be at least {p.MinLen} characters.";
        if (p.Upper && !(pw.Any(char.IsUpper) && pw.Any(char.IsLower))) return "Password needs upper and lower case letters.";
        if (p.Digit && !pw.Any(char.IsDigit)) return "Password needs at least one number.";
        if (p.Special && pw.All(char.IsLetterOrDigit)) return "Password needs at least one symbol.";
        return null;
    }
    public static string Hash(string pw) => BCrypt.Net.BCrypt.HashPassword(pw, 11);
    public static bool Verify(string pw, string hash)
    {
        try { return !string.IsNullOrEmpty(hash) && BCrypt.Net.BCrypt.Verify(pw ?? "", hash); } catch { return false; }
    }
}

/// Sends email through the SMTP server set in Settings › Email (port 587 with STARTTLS, or 25).
public class Mailer
{
    readonly SettingsStore _ss; readonly ILogger<Mailer> _log;
    public Mailer(SettingsStore ss, ILogger<Mailer> log) { _ss = ss; _log = log; }

    public static bool Ready(AppSettings s) => !string.IsNullOrWhiteSpace(s.Smtp?.Host) && !string.IsNullOrWhiteSpace(s.Smtp?.From);

    public async Task<string> Send(AppSettings s, string to, string subject, string html)
    {
        if (!Ready(s)) return "Email is not set up yet (Settings › Email).";
        try
        {
            using var msg = new MailMessage
            {
                From = new MailAddress(s.Smtp.From, string.IsNullOrWhiteSpace(s.Smtp.FromName) ? "ChequeTrack" : s.Smtp.FromName),
                Subject = subject, Body = html, IsBodyHtml = true, BodyEncoding = Encoding.UTF8, SubjectEncoding = Encoding.UTF8
            };
            msg.To.Add(new MailAddress(to));
            using var c = new SmtpClient(s.Smtp.Host, s.Smtp.Port <= 0 ? 587 : s.Smtp.Port)
            {
                EnableSsl = s.Smtp.Ssl, DeliveryMethod = SmtpDeliveryMethod.Network, Timeout = 20000
            };
            if (!string.IsNullOrEmpty(s.Smtp.User)) c.Credentials = new NetworkCredential(s.Smtp.User, _ss.SmtpPass(s));
            await c.SendMailAsync(msg);
            return null;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Email to {To} failed", to);
            return "Email could not be sent: " + ex.Message;
        }
    }

    /// Simple branded HTML email, right-to-left when the user reads Arabic.
    public static string Layout(bool ar, string title, string bodyHtml, string buttonText = null, string buttonUrl = null)
    {
        var dir = ar ? "rtl" : "ltr";
        var sb = new StringBuilder();
        sb.Append("<div dir=\"").Append(dir).Append("\" style=\"font-family:Segoe UI,Arial,sans-serif;background:#F4F4F2;padding:24px\">");
        sb.Append("<div style=\"max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #ECEAE4\">");
        sb.Append("<div style=\"font-weight:700;font-size:18px;margin-bottom:18px\"><span style=\"display:inline-block;background:#FFC400;border-radius:8px;padding:4px 10px;margin-")
          .Append(ar ? "left" : "right").Append(":8px\">E</span>ChequeTrack</div>");
        sb.Append("<h2 style=\"font-size:19px;margin:0 0 12px\">").Append(Fmt.H(title)).Append("</h2>");
        sb.Append("<div style=\"font-size:15px;line-height:1.6;color:#2B2B2B\">").Append(bodyHtml).Append("</div>");
        if (!string.IsNullOrEmpty(buttonUrl))
            sb.Append("<p style=\"margin:22px 0\"><a href=\"").Append(Fmt.H(buttonUrl)).Append("\" style=\"background:#FFC400;color:#1D1D1D;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px;display:inline-block\">")
              .Append(Fmt.H(buttonText)).Append("</a></p>");
        sb.Append("</div></div>");
        return sb.ToString();
    }
}

public class Telegram
{
    readonly IHttpClientFactory _http;
    readonly ILogger<Telegram> _log;
    public Telegram(IHttpClientFactory http, ILogger<Telegram> log) { _http = http; _log = log; }

    public async Task<string> Send(string token, string chat, string html)
    {
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(chat)) return "Telegram is not set up";
        try
        {
            var c = _http.CreateClient("tg");
            var body = new Dictionary<string, string> { ["chat_id"] = chat, ["text"] = html, ["parse_mode"] = "HTML", ["disable_web_page_preview"] = "true" };
            var r = await c.PostAsync($"https://api.telegram.org/bot{token}/sendMessage", new FormUrlEncodedContent(body));
            if (r.IsSuccessStatusCode) return null;
            var txt = await r.Content.ReadAsStringAsync();
            _log.LogWarning("Telegram error {Code}: {Body}", (int)r.StatusCode, txt);
            try
            {
                using var doc = JsonDocument.Parse(txt);
                if (doc.RootElement.TryGetProperty("description", out var d)) return "Telegram: " + d.GetString();
            }
            catch { }
            return "Telegram error " + (int)r.StatusCode;
        }
        catch (Exception ex) { _log.LogWarning(ex, "Telegram send failed"); return "Telegram unreachable: " + ex.Message; }
    }
}

public class Notifier
{
    readonly Telegram _tg; readonly SettingsStore _ss;
    public Notifier(Telegram tg, SettingsStore ss) { _tg = tg; _ss = ss; }

    static readonly Dictionary<string, string> Titles = new()
    {
        ["approved"] = "✅ Approved by CFO", ["approved2"] = "✅ Second approval given", ["issued"] = "🧾 Cheque issued to requester",
        ["received"] = "📥 Received by requester", ["delivered"] = "🤝 Delivered to beneficiary", ["cleared"] = "💚 Cleared",
        ["returned"] = "🔴 Returned", ["solved"] = "✔️ Returned cheque settled", ["rejected"] = "⛔ Rejected"
    };

    public static string Amt(Cheque c) => c.PayAmt.HasValue ? Fmt.Money(c.PayAmt.Value, c.PayCur) : Fmt.Money(c.Amount, c.Currency);
    public static string DueWord(AppSettings s, Cheque c)
    {
        var n = Clock.DaysUntil(s, c.DueDate);
        return n < 0 ? $"{-n}d overdue" : n == 0 ? "due TODAY" : $"due in {n}d";
    }
    bool Off(AppSettings s) => s.HideTelegram || string.IsNullOrEmpty(_ss.Token(s)) || string.IsNullOrEmpty(s.TelegramChannel);

    public async Task Event(AppDb db, AppSettings s, Cheque c, string ev, string extra, string by)
    {
        if (Off(s)) return;
        if (s.TgEvents == null || !s.TgEvents.TryGetValue(ev, out var on) || !on) return;
        var ben = await db.Beneficiaries.AsNoTracking().FirstOrDefaultAsync(b => b.Id == c.BenId);
        var sb = new StringBuilder();
        sb.Append("<b>").Append(Fmt.H(Titles.GetValueOrDefault(ev, ev))).Append("</b>\n");
        sb.Append(Fmt.H(c.Id)).Append(" · ").Append(Fmt.H(ben?.NameEn)).Append('\n');
        sb.Append(Fmt.H(Amt(c))).Append(" · ").Append(Fmt.D(c.DueDate)).Append(" (").Append(DueWord(s, c)).Append(')');
        if (!string.IsNullOrEmpty(c.ChequeNo)) sb.Append(" · #").Append(Fmt.H(c.ChequeNo));
        if (!string.IsNullOrEmpty(extra)) sb.Append('\n').Append(Fmt.H(extra));
        sb.Append("\nby ").Append(Fmt.H(by));
        var text = sb.ToString();
        var err = await _tg.Send(_ss.Token(s), s.TelegramChannel, text);
        db.TgMessages.Add(new TgMessage { At = Clock.Stamp(s), Text = text, Kind = "event", Day = Clock.Today(s), By = by, Sent = err == null, Error = err ?? "" });
        await db.SaveChangesAsync();
    }

    public async Task<(string text, int count)> Digest(AppDb db, AppSettings s)
    {
        var w = s.AlertDays;
        var open = await db.Cheques.AsNoTracking().Where(c => St.Open.Contains(c.Status) || c.Status == "Pending" || c.Status == "Pending2").ToListAsync();
        var bens = await db.Beneficiaries.AsNoTracking().ToDictionaryAsync(b => b.Id, b => b.NameEn);
        var users = await db.Users.AsNoTracking().ToDictionaryAsync(u => u.Id, u => u.FullName);
        bool InW(Cheque c) => Clock.DaysUntil(s, c.DueDate) <= w;
        var groups = new List<(string h, List<Cheque> l, Func<Cheque, string> x)>
        {
            ("🔴 RETURNED — to be settled", open.Where(c => c.Status == "Returned").ToList(), c => string.IsNullOrEmpty(c.ClosedReason) ? "" : "reason: " + c.ClosedReason),
            ("⏰ DUE / OVERDUE — clear or return", open.Where(c => c.Status == "Delivered" && Clock.DaysUntil(s, c.DueDate) <= 0).ToList(), c => ""),
            ("🏦 WITH BENEFICIARY — will submit to bank", open.Where(c => c.Status == "Delivered" && Clock.DaysUntil(s, c.DueDate) > 0 && InW(c)).ToList(), c => string.IsNullOrEmpty(c.DeliveredTo) ? "" : "handed to " + c.DeliveredTo),
            ("📦 NOT RECEIVED BY BENEFICIARY yet", open.Where(c => (c.Status == "Posted" || c.Status == "Received") && InW(c)).ToList(),
                c => (c.Status == "Posted" ? "waiting " + Fmt.First(users.GetValueOrDefault(c.RequesterId)) + " to confirm receipt" : "with " + Fmt.First(users.GetValueOrDefault(c.RequesterId)) + " — not delivered")),
            ("🟡 APPROVED — not issued yet", open.Where(c => c.Status == "Approved" && InW(c)).ToList(), c => ""),
            ("🟣 WAITING APPROVAL", open.Where(c => (c.Status == "Pending" || c.Status == "Pending2") && InW(c)).ToList(), c => c.Status == "Pending2" ? "second approval (Top Management)" : "CFO approval")
        };
        groups = groups.Where(g => g.l.Count > 0).ToList();

        // contracts: expired, inside their reminder period, or with a follow-up due
        static string Exp(Contract k) => string.IsNullOrEmpty(k.ExpiryDate) ? k.EndDate : k.ExpiryDate;
        var ks = (await db.Contracts.AsNoTracking().ToListAsync()).Where(k => k.Status != "Closed").ToList();
        var kExpired = ks.Where(k => Clock.DaysUntil(s, Exp(k)) < 0).OrderBy(Exp).ToList();
        var kSoon = ks.Where(k => { var n = Clock.DaysUntil(s, Exp(k)); return n >= 0 && n <= Math.Max(1, k.NoticeDays); }).OrderBy(Exp).ToList();
        var kFollow = ks.Where(k => !kExpired.Contains(k) && !kSoon.Contains(k) && !string.IsNullOrEmpty(k.FollowUpDate) && Clock.DaysUntil(s, k.FollowUpDate) <= 0)
            .OrderBy(k => k.FollowUpDate).ToList();
        var kGroups = new List<(string h, List<Contract> l)>
        {
            ("📄 CONTRACTS EXPIRED — renew or close", kExpired), ("📄 CONTRACTS EXPIRING", kSoon), ("📝 CONTRACT FOLLOW-UPS DUE", kFollow)
        }.Where(g => g.l.Count > 0).ToList();

        var count = groups.Sum(g => g.l.Count) + kGroups.Sum(g => g.l.Count);
        if (count == 0) return ("", 0);
        var sb = new StringBuilder();
        sb.Append(kGroups.Count > 0 ? "🔔 <b>Daily cheque & contract alert</b> — " : "🔔 <b>Daily cheque alert</b> — ").Append(Fmt.D(Clock.Today(s))).Append("\n(alert window: ").Append(w).Append(" days)\n");
        foreach (var g in groups)
        {
            sb.Append("\n<b>").Append(Fmt.H(g.h)).Append("</b> (").Append(g.l.Count).Append(")\n");
            foreach (var c in g.l.OrderBy(c => c.DueDate))
            {
                sb.Append("• ").Append(Fmt.H(c.Id)).Append(" · ").Append(Fmt.H(bens.GetValueOrDefault(c.BenId))).Append('\n');
                sb.Append("   ").Append(Fmt.H(Amt(c))).Append(" · ").Append(Fmt.D(c.DueDate)).Append(" (").Append(DueWord(s, c)).Append(')');
                if (!string.IsNullOrEmpty(c.ChequeNo)) sb.Append(" · #").Append(Fmt.H(c.ChequeNo));
                var e = g.x(c);
                if (!string.IsNullOrEmpty(e)) sb.Append("\n   ").Append(Fmt.H(e));
                sb.Append('\n');
            }
        }
        foreach (var g in kGroups)
        {
            sb.Append("\n<b>").Append(Fmt.H(g.h)).Append("</b> (").Append(g.l.Count).Append(")\n");
            foreach (var k in g.l)
            {
                var n = Clock.DaysUntil(s, Exp(k));
                sb.Append("• ").Append(Fmt.H(k.OpNo)).Append(" · ").Append(Fmt.H(bens.GetValueOrDefault(k.FinancierId))).Append('\n');
                sb.Append("   ").Append(n < 0 ? $"expired {Fmt.D(Exp(k))} ({-n}d ago)" : n == 0 ? $"expires TODAY {Fmt.D(Exp(k))}" : $"expires {Fmt.D(Exp(k))} (in {n}d)");
                if (!string.IsNullOrEmpty(k.FollowUpDate)) sb.Append(" · follow-up ").Append(Fmt.D(k.FollowUpDate));
                if (k.OwnerId.HasValue && users.TryGetValue(k.OwnerId.Value, out var on)) sb.Append(" · ").Append(Fmt.H(Fmt.First(on)));
                sb.Append('\n');
            }
        }
        sb.Append("\nChequeTrack · ").Append(Fmt.H(s.Company));
        return (sb.ToString(), count);
    }

    public async Task<string> SendDigest(AppDb db, AppSettings s, string by)
    {
        if (Off(s)) return "Telegram is not set up";
        var (text, count) = await Digest(db, s);
        if (count == 0) return "Nothing to alert today";
        var err = await _tg.Send(_ss.Token(s), s.TelegramChannel, text);
        db.TgMessages.Add(new TgMessage { At = Clock.Stamp(s), Text = text, Kind = "digest", Day = Clock.Today(s), Count = count, By = by, Sent = err == null, Error = err ?? "" });
        await db.SaveChangesAsync();
        return err;
    }

    /// Sends the daily digest once per day, after the configured alert time.
    public async Task DailyIfDue(AppDb db)
    {
        var s = await _ss.Get(db);
        if (Off(s)) return;
        var now = Clock.Now(s);
        if (!TimeSpan.TryParse(s.AlertTime, CultureInfo.InvariantCulture, out var at)) at = new TimeSpan(9, 0, 0);
        if (now.TimeOfDay < at) return;
        var day = Clock.Today(s);
        if (await db.TgMessages.AnyAsync(m => m.Kind == "digest" && m.Day == day && m.By == "System")) return;
        var (text, count) = await Digest(db, s);
        if (count == 0)
        {
            db.TgMessages.Add(new TgMessage { At = Clock.Stamp(s), Text = "", Kind = "digest", Day = day, Count = 0, By = "System", Sent = true });
            await db.SaveChangesAsync();
            return;
        }
        var err = await _tg.Send(_ss.Token(s), s.TelegramChannel, text);
        db.TgMessages.Add(new TgMessage { At = Clock.Stamp(s), Text = text, Kind = "digest", Day = day, Count = count, By = "System", Sent = err == null, Error = err ?? "" });
        await db.SaveChangesAsync();
    }
}

public class DailyWorker : BackgroundService
{
    readonly IServiceProvider _sp; readonly ILogger<DailyWorker> _log;
    public DailyWorker(IServiceProvider sp, ILogger<DailyWorker> log) { _sp = sp; _log = log; }
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromSeconds(30), ct);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = _sp.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await scope.ServiceProvider.GetRequiredService<Notifier>().DailyIfDue(db);
            }
            catch (Exception ex) { _log.LogWarning(ex, "Daily alert check failed"); }
            await Task.Delay(TimeSpan.FromMinutes(10), ct);
        }
    }
}
