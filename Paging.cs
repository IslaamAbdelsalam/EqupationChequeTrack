using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace ChequeTrack;

/// <summary>
/// Cursor (keyset) pagination. Lists never load a whole table: each call returns one page (10, 25, 50 or 100 rows)
/// and an opaque cursor for the next page. Keyset paging stays fast however large the table grows, and rows added
/// while someone is paging do not shift or repeat rows.
/// The tabs and filters of each cheque list are applied here, in SQL, under the caller's scope and row-level security.
/// </summary>
public static class Paging
{
    public static readonly string[] Closed = { "Cleared", "Solved", "Rejected", "Cancelled" };
    public static readonly string[] Open = { "Approved", "Posted", "Received", "Delivered", "Returned" };
    public static readonly string[] Outstanding = { "Posted", "Received", "Delivered" };

    static readonly Regex CurRx = new(@"^(?<d>\d{4}-\d{2}-\d{2}|)\|(?<s>\d{1,9})$", RegexOptions.Compiled);

    // ---------- cursors: base64url of "dueDate|seq" (or "|seq"); validated strictly when read back ----------
    public static string Enc(string due, int seq) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes((due ?? "") + "|" + seq)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static bool Dec(string cur, out string due, out int seq)
    {
        due = ""; seq = 0;
        if (string.IsNullOrEmpty(cur) || cur.Length > 64 || !Regex.IsMatch(cur, "^[A-Za-z0-9_-]+$")) return false;
        try
        {
            var b = cur.Replace('-', '+').Replace('_', '/'); b += new string('=', (4 - b.Length % 4) % 4);
            var m = CurRx.Match(Encoding.UTF8.GetString(Convert.FromBase64String(b)));
            if (!m.Success) return false;
            due = m.Groups["d"].Value; return int.TryParse(m.Groups["s"].Value, out seq);
        }
        catch { return false; }
    }
    /// <summary>Numeric cursor (audit id); same base64url wrapping so the format is not guessable.</summary>
    public static string EncN(long n) => Enc("", (int)Math.Min(n, int.MaxValue));
    public static long DecN(string cur) => Dec(cur, out _, out var s) ? s : 0;
    /// <summary>Date cursor (exchange rates).</summary>
    public static string EncD(string d) => Enc(d, 0);
    public static string DecD(string cur) => Dec(cur, out var d, out _) ? d : "";

    public static string Like(string q) => "%" + q.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";

    // ---------- the tabs of each cheque list ----------
    public sealed record Tab(string Key, bool ByDue, Func<IQueryable<Cheque>, IQueryable<Cheque>> F);

    /// <summary>The base rows of a list (before tabs) and its tabs. Unknown list → null.</summary>
    public static (Func<IQueryable<Cheque>, IQueryable<Cheque>> Base, Tab[] Tabs)? List(string list, int me, string today, string soon, bool a1, bool a2)
    {
        IQueryable<Cheque> Id(IQueryable<Cheque> q) => q;
        switch (list)
        {
            case "all":
                return (Id, new[]
                {
                    new Tab("all", false, Id),
                    new Tab("p1", false, q => q.Where(c => c.Status == "Pending")),
                    new Tab("p2", false, q => q.Where(c => c.Status == "Pending2")),
                    new Tab("ap", false, q => q.Where(c => c.Status == "Approved")),
                    new Tab("out", false, q => q.Where(c => Outstanding.Contains(c.Status))),
                    new Tab("ret", false, q => q.Where(c => c.Status == "Returned")),
                    new Tab("cl", false, q => q.Where(c => Closed.Contains(c.Status))),
                });
            case "mine":
                return (q => q.Where(c => c.RequesterId == me), new[]
                {
                    new Tab("all", false, Id),
                    new Tab("wait", false, q => q.Where(c => c.Status == "Pending" || c.Status == "Pending2")),
                    new Tab("ap", false, q => q.Where(c => c.Status == "Approved")),
                    new Tab("me", false, q => q.Where(c => c.Status == "Posted" || c.Status == "Received")),
                    new Tab("ben", false, q => q.Where(c => c.Status == "Delivered")),
                    new Tab("cl", false, q => q.Where(c => Closed.Contains(c.Status) || c.Status == "Returned")),
                });
            case "appr":
            {
                bool any = !a1 && !a2, s1 = a1 || any, s2 = a2 || any;
                return (q => q.Where(c => (s1 && c.Status == "Pending") || (s2 && c.Status == "Pending2")), new[]
                {
                    new Tab("mine", false, q => q.Where(c => c.RequesterId != me && (c.ApprovedById == null || c.ApprovedById != me))),
                    new Tab("all", false, Id),
                });
            }
            case "iss":
                return (Id, new[]
                {
                    new Tab("ap", false, q => q.Where(c => c.Status == "Approved")),
                    new Tab("req", false, q => q.Where(c => c.Status == "Posted" || c.Status == "Received")),
                    new Tab("ben", true, q => q.Where(c => c.Status == "Delivered")),
                    new Tab("ret", false, q => q.Where(c => c.Status == "Returned")),
                });
            case "fu":
                return (q => q.Where(c => Open.Contains(c.Status)), new[]
                {
                    new Tab("od", true, q => q.Where(c => c.Status != "Returned" && c.DueDate != "" && c.DueDate.CompareTo(today) < 0)),
                    new Tab("wk", true, q => q.Where(c => c.Status != "Returned" && c.DueDate.CompareTo(today) >= 0 && c.DueDate.CompareTo(soon) <= 0)),
                    new Tab("later", true, q => q.Where(c => c.Status != "Returned" && (c.DueDate == "" || c.DueDate.CompareTo(soon) > 0))),
                    new Tab("ret", true, q => q.Where(c => c.Status == "Returned")),
                });
            default: return null;
        }
    }

    /// <summary>Search and filters shared by every cheque list. All values are validated by the caller.</summary>
    public static IQueryable<Cheque> Filter(AppDb db, IQueryable<Cheque> q, string text, int ent, string cur, string from, string to, string op)
    {
        if (ent > 0) q = q.Where(c => c.EntityId == ent);
        if (!string.IsNullOrEmpty(cur)) q = q.Where(c => c.PayCur == cur || c.Currency == cur);
        if (!string.IsNullOrEmpty(from)) q = q.Where(c => c.DueDate.CompareTo(from) >= 0);
        if (!string.IsNullOrEmpty(to)) q = q.Where(c => c.DueDate != "" && c.DueDate.CompareTo(to) <= 0);
        if (!string.IsNullOrEmpty(op)) q = q.Where(c => db.ChequeLines.Any(l => l.ChequeId == c.Id && l.OpNo == op));
        if (!string.IsNullOrEmpty(text))
        {
            var p = Like(text);
            var bens = db.Beneficiaries.Where(b => EF.Functions.Like(b.NameEn, p) || EF.Functions.Like(b.NameAr, p) || EF.Functions.Like(b.Code, p)).Select(b => b.Id);
            var users = db.Users.Where(u => EF.Functions.Like(u.FullName, p) || EF.Functions.Like(u.FullNameAr, p)).Select(u => u.Id);
            q = q.Where(c => EF.Functions.Like(c.Id, p) || EF.Functions.Like(c.DocNo, p) || EF.Functions.Like(c.Reason, p) || EF.Functions.Like(c.ChequeNo, p)
                          || bens.Contains(c.BenId) || users.Contains(c.RequesterId));
        }
        return q;
    }

    /// <summary>One page in a stable order: due date (soonest first) or newest first, continuing after the cursor.</summary>
    public static IQueryable<Cheque> Page(IQueryable<Cheque> q, bool byDue, string cursor, int size)
    {
        if (byDue)
        {
            if (Dec(cursor, out var d, out var s)) q = q.Where(c => c.DueDate.CompareTo(d) > 0 || (c.DueDate == d && c.Seq > s));
            return q.OrderBy(c => c.DueDate).ThenBy(c => c.Seq).Take(size + 1);
        }
        if (Dec(cursor, out _, out var sq)) q = q.Where(c => c.Seq < sq);
        return q.OrderByDescending(c => c.Seq).Take(size + 1);
    }
}

/// <summary>Attachment details without the file bytes (the bytes come only from /api/file/{id}).</summary>
public sealed record FileRow(int Id, string ChequeId, string Kind, string FileName, int Size, string By, string At);
