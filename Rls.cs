using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace ChequeTrack;

/// <summary>
/// Row-level security (RLS) in SQL Server, as a second lock behind the role checks in the code.
///
/// Endpoints that return cheque data run inside <c>using (Rls.As(user, scope))</c>. Every database connection
/// opened inside that block first tells SQL Server who is asking (sp_set_session_context: ct_uid, ct_dept,
/// ct_scope). The security policy <c>rls.ChequePolicy</c> then filters dbo.Cheques, dbo.ChequeLines,
/// dbo.Attachments and dbo.Comments to the rows that user may see:
///   scope all  → every row
///   scope dept → the user's department and the user's own requests
///   scope own  → only the user's own requests
/// Even if a query in the code forgot its filter, the database would not return other people's rows.
///
/// Work outside such a block (saving, background alerts, start-up) runs as "sys" and sees every row,
/// because its checks (duplicate numbers, next cheque number, contract totals) must look at all data.
/// Rollback switch: app setting SECURITY_RLS=off removes the policy at the next start.
/// </summary>
public static class Rls
{
    sealed class Ctx { public int Uid; public int Dept; public string Scope = "sys"; }
    static readonly AsyncLocal<Ctx> Cur = new();

    sealed class Restore : IDisposable { readonly Ctx _p; public Restore(Ctx p) => _p = p; public void Dispose() => Cur.Value = _p; }

    /// <summary>Queries inside the returned block are filtered by the database to what this user may see.</summary>
    public static IDisposable As(AppUser u, string scope)
    {
        var prev = Cur.Value;
        Cur.Value = new Ctx { Uid = u?.Id ?? -1, Dept = u?.DeptId ?? -1, Scope = scope is "all" or "dept" ? scope : "own" };
        return new Restore(prev);
    }

    internal static (int uid, int dept, string scope) Now()
    {
        var c = Cur.Value;
        return c == null ? (0, 0, "sys") : (c.Uid, c.Dept, c.Scope);
    }

    public static bool Enabled => !string.Equals(Environment.GetEnvironmentVariable("SECURITY_RLS"), "off", StringComparison.OrdinalIgnoreCase);

    const string DropSql = "IF EXISTS (SELECT 1 FROM sys.security_policies WHERE name = N'ChequePolicy') DROP SECURITY POLICY rls.ChequePolicy;";
    /// <summary>Removes the policy (before schema upgrades). Never throws.</summary>
    public static async Task Drop(AppDb db) { try { await db.Database.ExecuteSqlRawAsync(DropSql); } catch { } }

    /// <summary>Creates (or removes, when switched off) the SQL Server objects. Safe to run on every start.</summary>
    public static async Task Install(AppDb db, ILogger log)
    {
        try
        {
            await db.Database.ExecuteSqlRawAsync(DropSql);
            if (!Enabled) { log.LogWarning("Row-level security is OFF (SECURITY_RLS=off)."); return; }
            await db.Database.ExecuteSqlRawAsync("IF SCHEMA_ID(N'rls') IS NULL EXEC(N'CREATE SCHEMA rls');");
            await db.Database.ExecuteSqlRawAsync(@"CREATE OR ALTER FUNCTION rls.fn_cheque(@RequesterId int, @DeptId int)
RETURNS TABLE WITH SCHEMABINDING AS RETURN
SELECT 1 AS ok WHERE
    CAST(SESSION_CONTEXT(N'ct_scope') AS nvarchar(10)) IS NULL
 OR CAST(SESSION_CONTEXT(N'ct_scope') AS nvarchar(10)) IN (N'sys', N'all')
 OR @RequesterId = CAST(SESSION_CONTEXT(N'ct_uid') AS int)
 OR (CAST(SESSION_CONTEXT(N'ct_scope') AS nvarchar(10)) = N'dept' AND @DeptId = CAST(SESSION_CONTEXT(N'ct_dept') AS int));");
            await db.Database.ExecuteSqlRawAsync(@"CREATE OR ALTER FUNCTION rls.fn_child(@ChequeId nvarchar(20))
RETURNS TABLE WITH SCHEMABINDING AS RETURN
SELECT 1 AS ok FROM dbo.Cheques c WHERE c.Id = @ChequeId AND (
    CAST(SESSION_CONTEXT(N'ct_scope') AS nvarchar(10)) IS NULL
 OR CAST(SESSION_CONTEXT(N'ct_scope') AS nvarchar(10)) IN (N'sys', N'all')
 OR c.RequesterId = CAST(SESSION_CONTEXT(N'ct_uid') AS int)
 OR (CAST(SESSION_CONTEXT(N'ct_scope') AS nvarchar(10)) = N'dept' AND c.DeptId = CAST(SESSION_CONTEXT(N'ct_dept') AS int)));");
            await db.Database.ExecuteSqlRawAsync(@"CREATE SECURITY POLICY rls.ChequePolicy
 ADD FILTER PREDICATE rls.fn_cheque(RequesterId, DeptId) ON dbo.Cheques,
 ADD FILTER PREDICATE rls.fn_child(ChequeId) ON dbo.ChequeLines,
 ADD FILTER PREDICATE rls.fn_child(ChequeId) ON dbo.Attachments,
 ADD FILTER PREDICATE rls.fn_child(ChequeId) ON dbo.Comments
 WITH (STATE = ON, SCHEMABINDING = ON);");
            log.LogInformation("Row-level security policy rls.ChequePolicy is on.");
        }
        catch (Exception ex)
        {
            // never stop the app from starting; the role checks in the code still apply
            log.LogError(ex, "Row-level security could not be installed. The app continues with code-level checks only.");
        }
    }
}

/// <summary>Sets SESSION_CONTEXT on every connection EF Core opens, from the current <see cref="Rls"/> block.</summary>
public sealed class RlsInterceptor : DbConnectionInterceptor
{
    const string Sql = "EXEC sp_set_session_context @key=N'ct_scope', @value=@s; EXEC sp_set_session_context @key=N'ct_uid', @value=@u; EXEC sp_set_session_context @key=N'ct_dept', @value=@d;";

    static DbCommand Cmd(DbConnection c)
    {
        var (uid, dept, scope) = Rls.Now();
        var cmd = c.CreateCommand(); cmd.CommandText = Sql;
        void P(string n, object v) { var p = cmd.CreateParameter(); p.ParameterName = n; p.Value = v; cmd.Parameters.Add(p); }
        P("@s", scope); P("@u", uid); P("@d", dept);
        return cmd;
    }
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    { using var cmd = Cmd(connection); cmd.ExecuteNonQuery(); }
    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    { await using var cmd = Cmd(connection); await cmd.ExecuteNonQueryAsync(cancellationToken); }
}
