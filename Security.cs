using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Server.Kestrel.Core;

namespace ChequeTrack;

/// <summary>
/// Protection against robots, floods and malformed input. Everything here runs before the endpoints:
///  1. Kestrel limits: header size, body size, slow-client (slowloris) data rate, connection count.
///  2. Bot guard: blocks scanner tools and probe paths (/.env, /wp-admin, *.php …), bans an IP for a while after
///     repeated probes, floods or rate-limit hits.
///  3. Rate limits per user (signed in) or per IP (signed out), with strict limits on sign-in and password reset.
///  4. Request validation for every API call: method, content type, body size per route, JSON shape
///     (depth, size, property names, control characters, string lengths) and query-string limits.
///  5. Security headers: CSP, HSTS, frame, referrer, permissions and cross-origin policies.
/// </summary>
public static class Sec
{
    // Test runs can raise every limit (for example SECURITY_RATE_MULTIPLIER=20). Production keeps 1.
    static int Mul => Math.Clamp(int.TryParse(Environment.GetEnvironmentVariable("SECURITY_RATE_MULTIPLIER"), out var m) ? m : 1, 1, 100);

    public const long MaxUploadBody = 72L * 1024 * 1024;   // /api/act: up to 5 attachments of 10 MB (base64)
    public const long MaxApiBody = 64 * 1024;              // every other API call
    public const long MaxSettingsBody = 1024 * 1024;       // settings with a logo

    public static void AddSecurity(WebApplicationBuilder b)
    {
        b.WebHost.ConfigureKestrel(k =>
        {
            k.AddServerHeader = false;
            k.Limits.MaxRequestBodySize = MaxUploadBody;
            k.Limits.MaxRequestHeadersTotalSize = 32 * 1024;
            k.Limits.MaxRequestHeaderCount = 60;
            k.Limits.MaxRequestLineSize = 8 * 1024;
            k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
            k.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(75);
            k.Limits.MinRequestBodyDataRate = new MinDataRate(240, TimeSpan.FromSeconds(10));
            k.Limits.MinResponseDataRate = new MinDataRate(240, TimeSpan.FromSeconds(10));
            k.Limits.MaxConcurrentConnections = 2000;
            k.Limits.MaxConcurrentUpgradedConnections = 0;
        });

        // Azure App Service sits behind a front end that adds X-Forwarded-For / -Proto.
        // ForwardLimit = 1 takes only the address the Azure front end appended, so a client cannot spoof its IP.
        b.Services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.ForwardLimit = 1;
            o.KnownNetworks.Clear();
            o.KnownProxies.Clear();
        });

        b.Services.AddHsts(o => { o.MaxAge = TimeSpan.FromDays(365); o.IncludeSubDomains = true; });

        b.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.GlobalLimiter = PartitionedRateLimiter.CreateChained(
                PartitionedRateLimiter.Create<HttpContext, string>(Bucket),
                PartitionedRateLimiter.Create<HttpContext, string>(PerIp));
            o.OnRejected = async (ctx, ct) =>
            {
                Strike(Ip(ctx.HttpContext), 1);
                if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var ra))
                    ctx.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(ra.TotalSeconds)).ToString();
                ctx.HttpContext.Response.ContentType = "application/json";
                await ctx.HttpContext.Response.WriteAsync("{\"ok\":false,\"error\":\"Too many requests. Wait a minute and try again.\"}", ct);
            };
        });
    }

    // ---------------- rate limits ----------------
    static string Kind(string p)
    {
        if (!p.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)) return "";
        p = p.ToLowerInvariant();
        if (p is "/api/login" or "/api/login2" or "/api/setup" or "/api/reset") return "auth";
        if (p == "/api/forgot") return "forgot";
        if (p is "/api/pulse" or "/api/ping" or "/api/me") return "pulse";
        if (p.StartsWith("/api/cron/")) return "cron";
        if (p == "/api/act") return "write";
        if (p.StartsWith("/api/file/")) return "file";
        return "read";
    }

    static RateLimitPartition<string> Bucket(HttpContext c)
    {
        var kind = Kind(c.Request.Path.Value ?? "");
        if (kind == "") return RateLimitPartition.GetNoLimiter("static");
        var uid = c.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        var who = kind is "auth" or "forgot" or "cron" || string.IsNullOrEmpty(uid) ? "ip:" + Ip(c) : "u:" + uid;
        var key = kind + "|" + who; var m = Mul;
        return kind switch
        {
            // sign-in, two-step code, first setup, reset link: 10 a minute per IP (the account also locks after failed attempts)
            "auth" => RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions { PermitLimit = 10 * m, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }),
            // password reset emails: 5 per 15 minutes per IP
            "forgot" => RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions { PermitLimit = 5 * m, Window = TimeSpan.FromMinutes(15), QueueLimit = 0 }),
            // the daily alert URL: 12 an hour
            "cron" => RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions { PermitLimit = 12 * m, Window = TimeSpan.FromHours(1), QueueLimit = 0 }),
            // notifications poll every 30 s
            "pulse" => RateLimitPartition.GetTokenBucketLimiter(key, _ => new TokenBucketRateLimiterOptions { TokenLimit = 20 * m, TokensPerPeriod = 20 * m, ReplenishmentPeriod = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }),
            // saving: 60 a minute per user
            "write" => RateLimitPartition.GetTokenBucketLimiter(key, _ => new TokenBucketRateLimiterOptions { TokenLimit = 60 * m, TokensPerPeriod = 60 * m, ReplenishmentPeriod = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }),
            // attachment downloads: 60 a minute per user
            "file" => RateLimitPartition.GetTokenBucketLimiter(key, _ => new TokenBucketRateLimiterOptions { TokenLimit = 60 * m, TokensPerPeriod = 60 * m, ReplenishmentPeriod = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }),
            // reading pages of data: 180 a minute per user (export and reports fetch several pages in a row)
            _ => RateLimitPartition.GetTokenBucketLimiter(key, _ => new TokenBucketRateLimiterOptions { TokenLimit = 180 * m, TokensPerPeriod = 180 * m, ReplenishmentPeriod = TimeSpan.FromMinutes(1), QueueLimit = 2, AutoReplenishment = true })
        };
    }

    // every API call from one IP address, whoever is signed in: 400 a minute
    static RateLimitPartition<string> PerIp(HttpContext c) =>
        Kind(c.Request.Path.Value ?? "") == "" ? RateLimitPartition.GetNoLimiter("static")
        : RateLimitPartition.GetSlidingWindowLimiter("ip|" + Ip(c), _ => new SlidingWindowRateLimiterOptions { PermitLimit = 400 * Mul, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 });

    public static string Ip(HttpContext c) => c.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    // ---------------- bot guard: bans ----------------
    static readonly ConcurrentDictionary<string, DateTime> Banned = new();
    static readonly ConcurrentDictionary<string, (int n, DateTime from)> Strikes = new();
    static readonly ConcurrentDictionary<string, (int n, long win)> Hits = new();
    static long _sweep;

    /// <summary>Strike points: a probe path 5, a scanner tool 10, a rate-limit hit 1. 20 points in 10 minutes bans the IP for an hour.</summary>
    static void Strike(string ip, int pts)
    {
        var now = DateTime.UtcNow;
        var s = Strikes.AddOrUpdate(ip, _ => (pts, now), (_, o) => now - o.from > TimeSpan.FromMinutes(10) ? (pts, now) : (o.n + pts, o.from));
        if (s.n >= 20) { Banned[ip] = now.AddHours(1); Strikes.TryRemove(ip, out _); }
    }
    static bool IsBanned(string ip)
    {
        if (!Banned.TryGetValue(ip, out var until)) return false;
        if (until > DateTime.UtcNow) return true;
        Banned.TryRemove(ip, out _); return false;
    }
    static void Sweep()
    {
        var now = DateTime.UtcNow; var t = now.Ticks;
        if (t - Interlocked.Read(ref _sweep) < TimeSpan.FromMinutes(5).Ticks) return;
        Interlocked.Exchange(ref _sweep, t);
        foreach (var k in Banned.Where(x => x.Value < now).Select(x => x.Key).ToList()) Banned.TryRemove(k, out _);
        foreach (var k in Strikes.Where(x => now - x.Value.from > TimeSpan.FromMinutes(10)).Select(x => x.Key).ToList()) Strikes.TryRemove(k, out _);
        var w = now.Ticks / TimeSpan.FromSeconds(10).Ticks;
        foreach (var k in Hits.Where(x => x.Value.win < w - 1).Select(x => x.Key).ToList()) Hits.TryRemove(k, out _);
    }

    static readonly Regex Probe = new(@"(\.(php\d?|asp|aspx|jsp|cgi|pl|env|git|svn|bak|sql|ini|config|yml|yaml|log|old|swp)(\b|$))|/(wp-|wordpress|phpmyadmin|pma|mysql|adminer|vendor/|cgi-bin|actuator|server-status|xmlrpc|boaform|hnap1|\.well-known/security|\.aws|\.ssh|\.docker|owa/|autodiscover|solr|jenkins|console|shell|telescope|_ignition|debug)|\.\./|%2e%2e|%252e|etc/passwd|win\.ini|<script|%3cscript|union(\s|%20|\+)+select",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));
    static readonly Regex Scanner = new(@"sqlmap|nikto|nmap|masscan|zgrab|nuclei|acunetix|nessus|openvas|wpscan|dirbuster|gobuster|ffuf|feroxbuster|hydra|w3af|arachni|skipfish|jaeles|httpx|whatweb|netsparker|burpcollaborator|commix|fimap|zmeu|morfeus|censysinspect|internet-measurement|expanse",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));
    static readonly Regex PropName = new(@"^[A-Za-z][A-Za-z0-9_]{0,39}$", RegexOptions.Compiled);

    // per-key size limits for strings inside JSON bodies (everything else: 4,000 characters)
    static readonly Dictionary<string, int> BigKeys = new(StringComparer.Ordinal)
    {
        ["data"] = 14_000_000,   // one attachment, base64 (10 MB file)
        ["logo"] = 400_000,      // company logo (data URL)
        ["perms"] = 20_000,      // role permissions
    };

    /// <summary>Order: forwarded headers → this → static files → auth → rate limiter → endpoints.</summary>
    public static void UseSecurity(WebApplication app)
    {
        app.UseForwardedHeaders();
        if (!app.Environment.IsDevelopment()) { app.UseHsts(); app.UseHttpsRedirection(); }

        app.Use(async (ctx, next) =>
        {
            Sweep();
            var ip = Ip(ctx);
            var req = ctx.Request;
            var path = req.Path.Value ?? "/";
            var isApi = path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);

            // 1. banned addresses get nothing
            if (IsBanned(ip)) { ctx.Response.StatusCode = 403; return; }

            // 2. floods: more than 300 requests in 10 seconds from one address bans it for an hour
            var w = DateTime.UtcNow.Ticks / TimeSpan.FromSeconds(10).Ticks;
            var h = Hits.AddOrUpdate(ip, _ => (1, w), (_, o) => o.win == w ? (o.n + 1, w) : (1, w));
            if (h.n > 300 * Mul) { Banned[ip] = DateTime.UtcNow.AddHours(1); ctx.Response.StatusCode = 429; return; }

            // 3. only the methods the app uses
            if (!(HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method) || HttpMethods.IsPost(req.Method)))
            { ctx.Response.StatusCode = 405; return; }

            // 4. scanners and probe paths
            var ua = req.Headers.UserAgent.ToString();
            var full = path + req.QueryString.Value;
            bool probe; try { probe = Probe.IsMatch(full); } catch (RegexMatchTimeoutException) { probe = true; }
            if (probe) { Strike(ip, 5); ctx.Response.StatusCode = 404; return; }
            bool scan; try { scan = Scanner.IsMatch(ua); } catch (RegexMatchTimeoutException) { scan = true; }
            if (scan) { Strike(ip, 10); ctx.Response.StatusCode = 403; return; }
            if (isApi && string.IsNullOrWhiteSpace(ua) && !path.Equals("/api/ping", StringComparison.OrdinalIgnoreCase))
            { ctx.Response.StatusCode = 403; return; }

            // 5. security headers (on everything, set before the response starts)
            var hd = ctx.Response.Headers;
            hd["X-Content-Type-Options"] = "nosniff";
            hd["X-Frame-Options"] = "DENY";
            hd["Referrer-Policy"] = "no-referrer";
            hd["X-Permitted-Cross-Domain-Policies"] = "none";
            hd["Cross-Origin-Opener-Policy"] = "same-origin";
            hd["Cross-Origin-Resource-Policy"] = "same-origin";
            hd["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()";
            hd["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
                "form-action 'self'; frame-ancestors 'none'" + (req.IsHttps ? "; upgrade-insecure-requests" : "");
            if (isApi) { hd["Cache-Control"] = "no-store"; hd["X-Robots-Tag"] = "noindex, nofollow"; }

            if (!isApi) { await next(); return; }

            // 6. query strings: short, printable
            if (req.QueryString.HasValue)
            {
                if (req.QueryString.Value.Length > 2048) { await Bad(ctx, "The request is too long."); return; }
                foreach (var q in req.Query)
                    foreach (var v in q.Value)
                        if (q.Key.Length > 40 || (v ?? "").Length > 300 || HasControl(v ?? "", false)) { await Bad(ctx, "The request is not valid."); return; }
            }

            if (HttpMethods.IsPost(req.Method))
            {
                // 7. writes must come from our page (CSRF) and be JSON
                if (req.Headers["X-Requested-With"] != "ChequeTrack") { await Bad(ctx, "Bad request"); return; }
                if (!(req.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) { ctx.Response.StatusCode = 415; return; }

                // 8. body size per route
                var limit = path.Equals("/api/act", StringComparison.OrdinalIgnoreCase) ? MaxUploadBody : MaxApiBody;
                if (req.ContentLength > limit) { ctx.Response.StatusCode = 413; return; }
                var f = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
                if (f != null && !f.IsReadOnly) f.MaxRequestBodySize = limit;

                // 9. JSON shape
                req.EnableBuffering(64 * 1024, limit);
                string err;
                try
                {
                    using var doc = await JsonDocument.ParseAsync(req.Body, new JsonDocumentOptions { MaxDepth = 10, AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow }, ctx.RequestAborted);
                    var n = 0;
                    err = doc.RootElement.ValueKind != JsonValueKind.Object ? "The request is not valid." : Check(doc.RootElement, null, ref n);
                    if (err == null && path.Equals("/api/act", StringComparison.OrdinalIgnoreCase))
                    {
                        var a = doc.RootElement.TryGetProperty("action", out var av) && av.ValueKind == JsonValueKind.String ? av.GetString() : "";
                        if (!Actions.Contains(a ?? "")) err = "Unknown action.";
                        else if (a != "submitReq" && a != "saveSettings" && req.ContentLength > MaxSettingsBody) err = "The request is too large.";
                    }
                }
                catch (Microsoft.AspNetCore.Http.BadHttpRequestException) { ctx.Response.StatusCode = 413; return; }
                catch (JsonException) { err = "The request is not valid JSON."; }
                if (err != null) { await Bad(ctx, err); return; }
                req.Body.Position = 0;
            }
            await next();
        });
    }

    /// <summary>Every action /api/act accepts. Anything else is refused before it reaches the code.</summary>
    public static readonly HashSet<string> Actions = new(StringComparer.Ordinal)
    {
        "submitReq","cancelReq","approve","approve2","reject","issue","comment","seenNotifs","readComments","receive","deliver","close","solve","settlePoa",
        "saveRate","saveBen","delBen","saveBank","saveAccount","saveBook","voidNo","saveContract","extendContract","followContract","renewContract","closeContract",
        "reopenContract","delContract","postEntry","unpostEntry","saveDept","delDept","saveRole","delRole","saveEntity","confirmFunc","saveUser","unlockUser",
        "sendReset","setLang","saveSettings","testEmail","tgConnect","tgDisconnect","sendDigest"
    };

    static string Check(JsonElement e, string key, ref int nodes)
    {
        if (++nodes > 5000) return "The request has too many fields.";
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in e.EnumerateObject())
                {
                    if (!PropName.IsMatch(p.Name)) return "The request has a field with an invalid name.";
                    var r = Check(p.Value, p.Name, ref nodes); if (r != null) return r;
                }
                return null;
            case JsonValueKind.Array:
                if (e.GetArrayLength() > 500) return "The request has too many items.";
                foreach (var x in e.EnumerateArray()) { var r = Check(x, key, ref nodes); if (r != null) return r; }
                return null;
            case JsonValueKind.String:
                var s = e.GetString() ?? "";
                var max = key != null && BigKeys.TryGetValue(key, out var m) ? m : 4000;
                if (s.Length > max) return $"The field '{key}' is too long.";
                if (HasControl(s, true)) return $"The field '{key}' has characters that are not allowed.";
                return null;
            case JsonValueKind.Number:
                return e.GetRawText().Length > 30 ? $"The number in '{key}' is too long." : null;
            default:
                return null;
        }
    }

    /// <summary>Control characters (NUL, escape codes, bidi overrides used to disguise text). Line breaks and tabs are allowed in text.</summary>
    public static bool HasControl(string s, bool allowLines)
    {
        foreach (var ch in s)
        {
            if (ch == '\n' || ch == '\r' || ch == '\t') { if (!allowLines) return true; continue; }
            if (ch < 0x20 || ch == 0x7F) return true;
            if (ch >= 0x202A && ch <= 0x202E) return true;   // bidi embedding / override
            if (ch >= 0x2066 && ch <= 0x2069) return true;   // bidi isolates
        }
        return false;
    }

    static async Task Bad(HttpContext ctx, string m)
    {
        ctx.Response.StatusCode = 400; ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new { ok = false, error = m }));
    }

    // ---------------- /api/act: checks every action shares ----------------
    static readonly HashSet<string> ChequeActions = new(StringComparer.Ordinal)
    { "cancelReq","approve","approve2","reject","issue","comment","readComments","receive","deliver","close","solve","settlePoa" };
    static readonly Regex DateKey = new(@"(^date$|Date$)", RegexOptions.Compiled);
    static readonly Regex MonthVal = new(@"^\d{4}-\d{2}$", RegexOptions.Compiled);

    /// <summary>Run before any action code: cheque ids, dates, months, numbers and ids are well formed.</summary>
    public static string ValidateAct(string action, JsonElement b)
    {
        if (ChequeActions.Contains(action))
        {
            var id = b.TryGetProperty("id", out var iv) && iv.ValueKind == JsonValueKind.String ? iv.GetString() : "";
            if (!ChequeId(id)) return "The cheque reference is not valid.";
        }
        return Fields(b, 0);
    }
    static string Fields(JsonElement o, int depth)
    {
        if (o.ValueKind != JsonValueKind.Object || depth > 3) return null;
        foreach (var p in o.EnumerateObject())
        {
            var v = p.Value;
            if (v.ValueKind == JsonValueKind.String)
            {
                var s = v.GetString() ?? "";
                if (DateKey.IsMatch(p.Name) && s.Length > 0 && s.Length <= 10 && !Date(s)) return $"'{p.Name}' must be a date (dd/MM/yyyy).";
                if (p.Name == "month" && s.Length > 0 && !MonthVal.IsMatch(s)) return "Month must look like 11/2026.";
            }
            else if (v.ValueKind == JsonValueKind.Number)
            {
                if (!v.TryGetDecimal(out var d)) return $"'{p.Name}' is not a valid number.";
                if (Math.Abs(d) >= 1_000_000_000_000m) return $"'{p.Name}' is too large.";
                if (p.Name.EndsWith("Id", StringComparison.Ordinal) && (d < 0 || d != Math.Floor(d))) return $"'{p.Name}' is not valid.";
            }
            else if (v.ValueKind == JsonValueKind.Object) { var r = Fields(v, depth + 1); if (r != null) return r; }
            else if (v.ValueKind == JsonValueKind.Array)
                foreach (var x in v.EnumerateArray()) { var r = Fields(x, depth + 1); if (r != null) return r; }
        }
        return null;
    }

    // ---------------- field validators used by the endpoints ----------------
    static readonly Regex IsoDate = new(@"^\d{4}-\d{2}-\d{2}$", RegexOptions.Compiled);
    static readonly Regex ChqId = new(@"^CHQ-[0-9A-Z-]{1,15}$", RegexOptions.Compiled);
    public static bool Date(string s) => string.IsNullOrEmpty(s) || (IsoDate.IsMatch(s) && DateTime.TryParseExact(s, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out _));
    public static bool ChequeId(string s) => !string.IsNullOrEmpty(s) && s.Length <= 20 && ChqId.IsMatch(s);
    /// <summary>Page sizes are fixed: 10, 25, 50 or 100 rows (500 only for report and export loaders).</summary>
    public static int PageSize(string v, bool big = false)
    {
        var n = int.TryParse(v, out var x) ? x : 25;
        if (big && n == 500) return 500;
        return n is 10 or 25 or 50 or 100 ? n : 25;
    }
}
