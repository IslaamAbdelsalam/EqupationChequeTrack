using System.Globalization;
using System.Net;
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

public class AppSettings
{
    public int AlertDays { get; set; } = 7;
    public string AlertTime { get; set; } = "09:00";
    public string TelegramChannel { get; set; } = "";
    public string BotTokenEnc { get; set; } = "";
    public Dictionary<string, bool> TgEvents { get; set; } = new()
    {
        ["approved"] = true, ["issued"] = true, ["received"] = true, ["delivered"] = true,
        ["cleared"] = true, ["returned"] = true, ["solved"] = true, ["rejected"] = true
    };
    public string ReportCurrency { get; set; } = "USD";
    public string Company { get; set; } = "Equpation";
    public string TimeZone { get; set; } = "Africa/Khartoum";
    public string CronKey { get; set; } = "";
    public string Logo { get; set; } = "";
    public List<string> Banks { get; set; } = new() { "Bank of Khartoum", "Faisal Islamic Bank", "Qatar National Bank" };
    public Policy Policy { get; set; } = new();
    // One-time CFO reset, triggered from Azure with the CFO_RESET app setting
    public string CfoResetDone { get; set; } = "";
    public int CfoResetUser { get; set; } = -1;   // -1 none pending, 0 create a new CFO, >0 user id to re-create
}

public static class Roles
{
    public const string TOP = "TOP", CFO = "CFO", FIN = "FIN", USER = "USER";
    public static readonly string[] All = { TOP, CFO, FIN, USER };
    public static bool Admin(string r) => r == TOP || r == CFO;
    public static bool SeeAll(string r) => r != USER;
    public static bool Finance(string r) => r == FIN || r == CFO;
    public static bool Bens(string r) => r == TOP || r == CFO || r == FIN;
}

public static class St
{
    public static readonly string[] Open = { "Approved", "Posted", "Received", "Delivered", "Returned" };
}

public class SettingsStore
{
    static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    readonly IDataProtector _p;
    public SettingsStore(IDataProtectionProvider dp) { _p = dp.CreateProtector("ChequeTrack.Telegram.v1"); }

    public async Task<AppSettings> Get(AppDb db)
    {
        var row = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == "app");
        if (row == null || string.IsNullOrWhiteSpace(row.Value)) return new AppSettings();
        try { return JsonSerializer.Deserialize<AppSettings>(row.Value, J) ?? new AppSettings(); }
        catch { return new AppSettings(); }
    }

    public async Task Save(AppDb db, AppSettings s)
    {
        var row = await db.Settings.FirstOrDefaultAsync(x => x.Key == "app");
        var json = JsonSerializer.Serialize(s, J);
        if (row == null) db.Settings.Add(new Setting { Key = "app", Value = json });
        else row.Value = json;
        await db.SaveChangesAsync();
    }

    public string Token(AppSettings s)
    {
        if (string.IsNullOrEmpty(s.BotTokenEnc)) return "";
        try { return _p.Unprotect(s.BotTokenEnc); } catch { return ""; }
    }
    public void SetToken(AppSettings s, string token) => s.BotTokenEnc = string.IsNullOrEmpty(token) ? "" : _p.Protect(token);
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
}

public static class Fmt
{
    public static string Money(decimal v, string cur) =>
        v.ToString(cur == "SDG" ? "N0" : "N2", CultureInfo.InvariantCulture) + (string.IsNullOrEmpty(cur) ? "" : " " + cur);
    public static string First(string s) => (s ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
    public static string H(string s) => WebUtility.HtmlEncode(s ?? "");
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
        ["approved"] = "✅ Approved by CFO", ["issued"] = "🧾 Cheque issued to requester", ["received"] = "📥 Received by requester",
        ["delivered"] = "🤝 Delivered to beneficiary", ["cleared"] = "💚 Cleared", ["returned"] = "🔴 Returned",
        ["solved"] = "✔️ Returned cheque solved", ["rejected"] = "⛔ Rejected"
    };

    public static string Amt(Cheque c) => c.PayAmt.HasValue ? Fmt.Money(c.PayAmt.Value, c.PayCur) : Fmt.Money(c.Amount, c.Currency);
    public static string DueWord(AppSettings s, Cheque c)
    {
        var n = Clock.DaysUntil(s, c.DueDate);
        return n < 0 ? $"{-n}d overdue" : n == 0 ? "due TODAY" : $"due in {n}d";
    }

    public async Task Event(AppDb db, AppSettings s, Cheque c, string ev, string extra, string by)
    {
        var token = _ss.Token(s);
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(s.TelegramChannel)) return;
        if (s.TgEvents == null || !s.TgEvents.TryGetValue(ev, out var on) || !on) return;
        var ben = await db.Beneficiaries.AsNoTracking().FirstOrDefaultAsync(b => b.Id == c.BenId);
        var sb = new StringBuilder();
        sb.Append("<b>").Append(Fmt.H(Titles.GetValueOrDefault(ev, ev))).Append("</b>\n");
        sb.Append(Fmt.H(c.Id)).Append(" · ").Append(Fmt.H(ben?.NameEn)).Append('\n');
        sb.Append(Fmt.H(Amt(c))).Append(" · ").Append(c.DueDate).Append(" (").Append(DueWord(s, c)).Append(')');
        if (!string.IsNullOrEmpty(c.ChequeNo)) sb.Append(" · #").Append(Fmt.H(c.ChequeNo));
        if (!string.IsNullOrEmpty(extra)) sb.Append('\n').Append(Fmt.H(extra));
        sb.Append("\nby ").Append(Fmt.H(by));
        var text = sb.ToString();
        var err = await _tg.Send(token, s.TelegramChannel, text);
        db.TgMessages.Add(new TgMessage { At = Clock.Stamp(s), Text = text, Kind = "event", Day = Clock.Today(s), By = by, Sent = err == null, Error = err ?? "" });
        await db.SaveChangesAsync();
    }

    public async Task<(string text, int count)> Digest(AppDb db, AppSettings s)
    {
        var w = s.AlertDays;
        var open = await db.Cheques.AsNoTracking().Where(c => St.Open.Contains(c.Status)).ToListAsync();
        var bens = await db.Beneficiaries.AsNoTracking().ToDictionaryAsync(b => b.Id, b => b.NameEn);
        var users = await db.Users.AsNoTracking().ToDictionaryAsync(u => u.Id, u => u.FullName);
        bool InW(Cheque c) => Clock.DaysUntil(s, c.DueDate) <= w;
        var groups = new List<(string h, List<Cheque> l, Func<Cheque, string> x)>
        {
            ("🔴 RETURNED — to be solved", open.Where(c => c.Status == "Returned").ToList(), c => string.IsNullOrEmpty(c.ClosedReason) ? "" : "reason: " + c.ClosedReason),
            ("⏰ DUE / OVERDUE — clear or return", open.Where(c => c.Status == "Delivered" && Clock.DaysUntil(s, c.DueDate) <= 0).ToList(), c => ""),
            ("🏦 WITH BENEFICIARY — will submit to bank", open.Where(c => c.Status == "Delivered" && Clock.DaysUntil(s, c.DueDate) > 0 && InW(c)).ToList(), c => string.IsNullOrEmpty(c.DeliveredTo) ? "" : "handed to " + c.DeliveredTo),
            ("📦 NOT RECEIVED BY BENEFICIARY yet", open.Where(c => (c.Status == "Posted" || c.Status == "Received") && InW(c)).ToList(),
                c => (c.Status == "Posted" ? "waiting " + Fmt.First(users.GetValueOrDefault(c.RequesterId)) + " to confirm receipt" : "with " + Fmt.First(users.GetValueOrDefault(c.RequesterId)) + " — not delivered")),
            ("🟡 APPROVED — not issued yet", open.Where(c => c.Status == "Approved" && InW(c)).ToList(), c => "")
        };
        groups = groups.Where(g => g.l.Count > 0).ToList();
        var count = groups.Sum(g => g.l.Count);
        if (count == 0) return ("", 0);
        var sb = new StringBuilder();
        sb.Append("🔔 <b>Daily cheque alert</b> — ").Append(Clock.Today(s)).Append("\n(alert window: ").Append(w).Append(" days)\n");
        foreach (var g in groups)
        {
            sb.Append("\n<b>").Append(Fmt.H(g.h)).Append("</b> (").Append(g.l.Count).Append(")\n");
            foreach (var c in g.l.OrderBy(c => c.DueDate))
            {
                sb.Append("• ").Append(Fmt.H(c.Id)).Append(" · ").Append(Fmt.H(bens.GetValueOrDefault(c.BenId))).Append('\n');
                sb.Append("   ").Append(Fmt.H(Amt(c))).Append(" · ").Append(DueWord(s, c));
                if (!string.IsNullOrEmpty(c.ChequeNo)) sb.Append(" · #").Append(Fmt.H(c.ChequeNo));
                var e = g.x(c);
                if (!string.IsNullOrEmpty(e)) sb.Append("\n   ").Append(Fmt.H(e));
                sb.Append('\n');
            }
        }
        sb.Append("\nChequeTrack · ").Append(Fmt.H(s.Company));
        return (sb.ToString(), count);
    }

    public async Task<string> SendDigest(AppDb db, AppSettings s, string by)
    {
        var token = _ss.Token(s);
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(s.TelegramChannel)) return "Telegram is not set up";
        var (text, count) = await Digest(db, s);
        if (count == 0) return "Nothing to alert today";
        var err = await _tg.Send(token, s.TelegramChannel, text);
        db.TgMessages.Add(new TgMessage { At = Clock.Stamp(s), Text = text, Kind = "digest", Day = Clock.Today(s), Count = count, By = by, Sent = err == null, Error = err ?? "" });
        await db.SaveChangesAsync();
        return err;
    }

    /// Sends the daily digest once per day, after the configured alert time.
    public async Task DailyIfDue(AppDb db)
    {
        var s = await _ss.Get(db);
        if (string.IsNullOrEmpty(_ss.Token(s)) || string.IsNullOrEmpty(s.TelegramChannel)) return;
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
