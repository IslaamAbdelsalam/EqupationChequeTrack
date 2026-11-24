using Microsoft.EntityFrameworkCore;

namespace ChequeTrack;

/// Upgrades a database made by the first release in place. EnsureCreated only builds a brand-new
/// database, so every table or column added later is created here with idempotent SQL.
/// Nothing is dropped or renamed: the first release keeps working on the same data.
public static class Schema
{
    static readonly string[] Ddl =
    {
        // ----- new tables -----
        @"IF OBJECT_ID(N'dbo.Entities', N'U') IS NULL CREATE TABLE dbo.Entities (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Entities PRIMARY KEY,
            [NameEn] nvarchar(150) NULL, [NameAr] nvarchar(150) NULL, [FuncCur] nvarchar(5) NULL)",
        @"IF OBJECT_ID(N'dbo.Banks', N'U') IS NULL CREATE TABLE dbo.Banks (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Banks PRIMARY KEY,
            [NameEn] nvarchar(150) NULL, [NameAr] nvarchar(150) NULL, [Currency] nvarchar(5) NULL, [Active] bit NOT NULL)",
        @"IF OBJECT_ID(N'dbo.BankAccounts', N'U') IS NULL CREATE TABLE dbo.BankAccounts (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_BankAccounts PRIMARY KEY,
            [BankId] int NOT NULL, [EntityId] int NOT NULL, [Description] nvarchar(150) NULL, [Last4] nvarchar(4) NULL,
            [Ledger] nvarchar(30) NULL, [Active] bit NOT NULL)",
        @"IF OBJECT_ID(N'dbo.Chequebooks', N'U') IS NULL CREATE TABLE dbo.Chequebooks (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Chequebooks PRIMARY KEY,
            [AccountId] int NOT NULL, [FromNo] bigint NOT NULL, [ToNo] bigint NOT NULL, [Active] bit NOT NULL,
            [AddedBy] nvarchar(150) NULL, [AddedAt] nvarchar(20) NULL)",
        @"IF OBJECT_ID(N'dbo.VoidedNos', N'U') IS NULL CREATE TABLE dbo.VoidedNos (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_VoidedNos PRIMARY KEY,
            [AccountId] int NOT NULL, [Number] bigint NOT NULL, [Reason] nvarchar(300) NULL, [By] nvarchar(150) NULL, [At] nvarchar(20) NULL)",
        @"IF OBJECT_ID(N'dbo.Contracts', N'U') IS NULL CREATE TABLE dbo.Contracts (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Contracts PRIMARY KEY,
            [OpNo] nvarchar(50) NULL, [FinancierId] int NOT NULL, [EntityId] int NOT NULL, [Currency] nvarchar(5) NULL,
            [Principal] decimal(18,2) NOT NULL, [Profit] decimal(18,2) NOT NULL, [TermMonths] int NOT NULL, [Instalments] int NOT NULL,
            [StartDate] nvarchar(10) NULL, [EndDate] nvarchar(10) NULL, [Notes] nvarchar(500) NULL, [Log] nvarchar(max) NULL,
            [CreatedBy] nvarchar(150) NULL, [CreatedAt] nvarchar(20) NULL)",
        @"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Contracts_OpNo' AND object_id = OBJECT_ID(N'dbo.Contracts'))
            CREATE UNIQUE INDEX IX_Contracts_OpNo ON dbo.Contracts([OpNo]) WHERE [OpNo] IS NOT NULL",
        @"IF OBJECT_ID(N'dbo.ChequeLines', N'U') IS NULL CREATE TABLE dbo.ChequeLines (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_ChequeLines PRIMARY KEY,
            [ChequeId] nvarchar(20) NULL, [OpNo] nvarchar(50) NULL, [InstNo] int NOT NULL, [Month] nvarchar(7) NULL,
            [Due] decimal(18,2) NOT NULL, [PaidBefore] decimal(18,2) NOT NULL, [Requested] decimal(18,2) NOT NULL, [Principal] decimal(18,2) NOT NULL)",
        @"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChequeLines_ChequeId' AND object_id = OBJECT_ID(N'dbo.ChequeLines'))
            CREATE INDEX IX_ChequeLines_ChequeId ON dbo.ChequeLines([ChequeId])",
        @"IF OBJECT_ID(N'dbo.Attachments', N'U') IS NULL CREATE TABLE dbo.Attachments (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Attachments PRIMARY KEY,
            [ChequeId] nvarchar(20) NULL, [Kind] nvarchar(20) NULL, [FileName] nvarchar(200) NULL, [ContentType] nvarchar(100) NULL,
            [Size] int NOT NULL, [Data] varbinary(max) NULL, [By] nvarchar(150) NULL, [At] nvarchar(20) NULL)",
        @"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Attachments_ChequeId' AND object_id = OBJECT_ID(N'dbo.Attachments'))
            CREATE INDEX IX_Attachments_ChequeId ON dbo.Attachments([ChequeId])",
        @"IF OBJECT_ID(N'dbo.PostedEntries', N'U') IS NULL CREATE TABLE dbo.PostedEntries (
            [Key] nvarchar(80) NOT NULL CONSTRAINT PK_PostedEntries PRIMARY KEY, [By] nvarchar(150) NULL, [At] nvarchar(20) NULL)",
        @"IF OBJECT_ID(N'dbo.PwdResets', N'U') IS NULL CREATE TABLE dbo.PwdResets (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_PwdResets PRIMARY KEY,
            [UserId] int NOT NULL, [TokenHash] nvarchar(64) NULL, [ExpUtc] datetime2 NOT NULL, [UsedUtc] datetime2 NULL, [CreatedUtc] datetime2 NOT NULL)",
        @"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PwdResets_TokenHash' AND object_id = OBJECT_ID(N'dbo.PwdResets'))
            CREATE INDEX IX_PwdResets_TokenHash ON dbo.PwdResets([TokenHash])",
        // v3: roles and permissions
        @"IF OBJECT_ID(N'dbo.Roles', N'U') IS NULL CREATE TABLE dbo.Roles (
            [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Roles PRIMARY KEY,
            [Key] nvarchar(10) NULL, [NameEn] nvarchar(100) NULL, [NameAr] nvarchar(100) NULL, [DeptId] int NULL, [Scope] nvarchar(10) NULL,
            [Perms] nvarchar(max) NULL, [BuiltIn] bit NOT NULL, [Notes] nvarchar(300) NULL, [UpdatedBy] nvarchar(150) NULL, [UpdatedAt] nvarchar(20) NULL)",
        @"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Roles_Key' AND object_id = OBJECT_ID(N'dbo.Roles'))
            CREATE UNIQUE INDEX IX_Roles_Key ON dbo.Roles([Key]) WHERE [Key] IS NOT NULL",
        // v3.2: messages between the stages of a request
        @"IF OBJECT_ID(N'dbo.Comments', N'U') IS NULL CREATE TABLE dbo.Comments (
            [Id] bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_Comments PRIMARY KEY,
            [ChequeId] nvarchar(20) NULL, [At] nvarchar(20) NULL, [ById] int NOT NULL, [ByName] nvarchar(150) NULL,
            [ToKind] nvarchar(20) NULL, [ToUserId] int NULL, [Stage] nvarchar(20) NULL, [Kind] nvarchar(30) NULL,
            [Text] nvarchar(2000) NULL, [ReadBy] nvarchar(2000) NULL,
            INDEX IX_Comments_ChequeId NONCLUSTERED ([ChequeId]))",
        // speed: department-scoped cheque lists
        @"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Cheques_DeptId' AND object_id = OBJECT_ID(N'dbo.Cheques'))
            CREATE INDEX IX_Cheques_DeptId ON dbo.Cheques([DeptId])",
    };

    // table, column, type (NOT NULL columns get a default so existing rows stay valid)
    static readonly (string t, string c, string type)[] Cols =
    {
        ("Users", "Email", "nvarchar(150) NULL"), ("Users", "Lang", "nvarchar(5) NULL"),
        ("Users", "TwoFa", "bit NOT NULL CONSTRAINT DF_Users_TwoFa DEFAULT 0"), ("Users", "TwoFaHash", "nvarchar(100) NULL"),
        ("Users", "TwoFaExpUtc", "datetime2 NULL"), ("Users", "TwoFaTries", "int NOT NULL CONSTRAINT DF_Users_TwoFaTries DEFAULT 0"),
        ("Beneficiaries", "Code", "nvarchar(30) NULL"),
        ("Rates", "Source", "nvarchar(100) NULL"),
        ("Cheques", "EntityId", "int NULL"), ("Cheques", "OpType", "nvarchar(40) NULL"), ("Cheques", "Purpose", "nvarchar(20) NULL"),
        ("Cheques", "Related", "bit NOT NULL CONSTRAINT DF_Cheques_Related DEFAULT 0"),
        ("Cheques", "DocType", "nvarchar(60) NULL"), ("Cheques", "DocNo", "nvarchar(60) NULL"), ("Cheques", "DocDate", "nvarchar(10) NULL"),
        ("Cheques", "Project", "nvarchar(100) NULL"), ("Cheques", "CounterAcct", "nvarchar(60) NULL"), ("Cheques", "RemainDate", "nvarchar(10) NULL"),
        ("Cheques", "PoaSettleDate", "nvarchar(10) NULL"), ("Cheques", "RecipientType", "nvarchar(20) NULL"), ("Cheques", "RecipientName", "nvarchar(150) NULL"),
        ("Cheques", "PayMethod", "nvarchar(30) NULL"), ("Cheques", "Priority", "nvarchar(20) NULL"), ("Cheques", "PriorityReason", "nvarchar(300) NULL"),
        ("Cheques", "PriorPaid", "bit NOT NULL CONSTRAINT DF_Cheques_PriorPaid DEFAULT 0"), ("Cheques", "PriorDate", "nvarchar(10) NULL"),
        ("Cheques", "PriorMethod", "nvarchar(60) NULL"), ("Cheques", "PriorRef", "nvarchar(100) NULL"),
        ("Cheques", "DupConfirmed", "bit NOT NULL CONSTRAINT DF_Cheques_DupConfirmed DEFAULT 0"),
        ("Cheques", "ApprovedById", "int NULL"), ("Cheques", "ApprRateDate", "nvarchar(10) NULL"), ("Cheques", "ApprQar", "decimal(18,6) NULL"),
        ("Cheques", "ApprSdg", "decimal(18,6) NULL"), ("Cheques", "ApprSrc", "nvarchar(100) NULL"), ("Cheques", "ApprRateBy", "nvarchar(150) NULL"),
        ("Cheques", "UsdEq", "decimal(18,2) NULL"), ("Cheques", "FuncCur", "nvarchar(5) NULL"), ("Cheques", "FuncVal", "decimal(18,2) NULL"),
        ("Cheques", "FuncPrincipal", "decimal(18,2) NULL"),
        ("Cheques", "Need2", "bit NOT NULL CONSTRAINT DF_Cheques_Need2 DEFAULT 0"), ("Cheques", "Need2Why", "nvarchar(200) NULL"),
        ("Cheques", "Appr2By", "nvarchar(150) NULL"), ("Cheques", "Appr2ById", "int NULL"), ("Cheques", "Appr2At", "nvarchar(20) NULL"),
        ("Cheques", "AccountId", "int NULL"), ("Cheques", "IssuedById", "int NULL"), ("Cheques", "IssueRateId", "nvarchar(20) NULL"),
        ("Cheques", "IssueRateDate", "nvarchar(10) NULL"), ("Cheques", "IssueQar", "decimal(18,6) NULL"), ("Cheques", "IssueSdg", "decimal(18,6) NULL"),
        ("Cheques", "IssueSrc", "nvarchar(100) NULL"), ("Cheques", "IssueRateBy", "nvarchar(150) NULL"),
        ("Cheques", "IssueFxDiff", "decimal(18,2) NULL"), ("Cheques", "CarryFunc", "decimal(18,2) NULL"),
        ("Cheques", "ClosedById", "int NULL"), ("Cheques", "ClearRateId", "nvarchar(20) NULL"), ("Cheques", "ClearRateDate", "nvarchar(10) NULL"),
        ("Cheques", "ClearQar", "decimal(18,6) NULL"), ("Cheques", "ClearSdg", "decimal(18,6) NULL"), ("Cheques", "ClearSrc", "nvarchar(100) NULL"),
        ("Cheques", "ClearRateBy", "nvarchar(150) NULL"), ("Cheques", "ClearUsdEq", "decimal(18,2) NULL"), ("Cheques", "ClearFuncVal", "decimal(18,2) NULL"),
        ("Cheques", "ClearFxDiff", "decimal(18,2) NULL"), ("Cheques", "SolveMethod", "nvarchar(30) NULL"),
        ("Cheques", "PoaSettledBy", "nvarchar(150) NULL"), ("Cheques", "PoaSettledAt", "nvarchar(20) NULL"), ("Cheques", "PoaRef", "nvarchar(150) NULL"),
        // v3
        ("Users", "FullNameAr", "nvarchar(150) NULL"),
        ("Users", "NotifSeen", "nvarchar(20) NULL"),
        ("Contracts", "ExpiryDate", "nvarchar(10) NULL"), ("Contracts", "NoticeDays", "int NOT NULL CONSTRAINT DF_Contracts_NoticeDays DEFAULT 30"),
        ("Contracts", "OwnerId", "int NULL"), ("Contracts", "FollowUpDate", "nvarchar(10) NULL"), ("Contracts", "Status", "nvarchar(20) NULL"),
        ("Contracts", "ClosedAt", "nvarchar(20) NULL"), ("Contracts", "ClosedBy", "nvarchar(150) NULL"), ("Contracts", "CloseReason", "nvarchar(300) NULL"),
    };

    public static async Task Upgrade(AppDb db, SettingsStore ss, ILogger log)
    {
        if (!db.Database.IsSqlServer()) return;
        // Speed (cold start): each list runs as ONE batch, so start-up needs 2 database round trips instead of ~95.
        // Every statement is an independent, idempotent IF ... check, so batching does not change the result.
        await db.Database.ExecuteSqlRawAsync(string.Join(";\n", Ddl));
        await db.Database.ExecuteSqlRawAsync(string.Join(";\n", Cols.Select(x =>
            $"IF COL_LENGTH(N'dbo.{x.t}', N'{x.c}') IS NULL ALTER TABLE dbo.[{x.t}] ADD [{x.c}] {x.type}")));

        // default entities (functional currency, IAS 21 para 9) — editable in Setup › Entities
        if (!await db.Entities.AnyAsync())
        {
            db.Entities.AddRange(
                new Entity { NameEn = "Equpation Sudan", NameAr = "إكوبيشن السودان", FuncCur = "SDG" },
                new Entity { NameEn = "Equpation Qatar", NameAr = "إكوبيشن قطر", FuncCur = "QAR" },
                new Entity { NameEn = "Bareeq", NameAr = "بريق", FuncCur = "QAR" });
            await db.SaveChangesAsync();
        }

        // cheques from the first release: fill the new fields so they show and report correctly
        var legacy = await db.Cheques.Where(c => c.EntityId == null).ToListAsync();
        if (legacy.Count > 0)
        {
            var first = await db.Entities.OrderBy(e => e.Id).FirstAsync();
            var rates = await db.Rates.AsNoTracking().ToDictionaryAsync(r => r.Id);
            var users = await db.Users.AsNoTracking().ToListAsync();
            int? Uid(string name) => string.IsNullOrEmpty(name) ? null : users.FirstOrDefault(x => x.FullName == name)?.Id;
            foreach (var c in legacy)
            {
                c.EntityId = first.Id; c.FuncCur = first.FuncCur;
                c.OpType ??= "Other"; c.Purpose ??= "Payment"; c.PayMethod ??= "Cheque"; c.Priority ??= "Normal"; c.RecipientType ??= "Beneficiary";
                c.DocDate ??= string.IsNullOrEmpty(c.CreatedAt) ? null : c.CreatedAt.Substring(0, 10);
                c.PayCur ??= c.Currency;
                c.ApprovedById ??= Uid(c.ApprovedBy); c.IssuedById ??= Uid(c.IssuedBy); c.ClosedById ??= Uid(c.ClosedBy);
                if (!string.IsNullOrEmpty(c.FxId) && rates.TryGetValue(c.FxId, out var r))
                {
                    c.ApprRateDate = r.Date; c.ApprQar = r.QAR; c.ApprSdg = r.SDG; c.ApprSrc = string.IsNullOrEmpty(r.Source) ? "" : r.Source; c.ApprRateBy = r.SetBy;
                    c.UsdEq = Fx.Round(Fx.Conv(c.Amount, c.Currency, "USD", r.QAR, r.SDG), "USD");
                    c.FuncVal = Fx.Round(Fx.Conv(c.Amount, c.Currency, c.FuncCur, r.QAR, r.SDG), c.FuncCur);
                    c.FuncPrincipal = 0m;
                    if (!string.IsNullOrEmpty(c.IssuedBy))
                    {
                        // the first release converted at approval, so the cheque carries the same rate
                        c.CarryFunc = Fx.Round(Fx.Conv(c.PayAmt ?? c.Amount, c.PayCur, c.FuncCur, r.QAR, r.SDG), c.FuncCur);
                        c.IssueFxDiff = c.CarryFunc - c.FuncVal;
                    }
                }
            }
            await db.SaveChangesAsync();
            log.LogInformation("Upgraded {Count} cheques from the first release", legacy.Count);
        }

        // v3: built-in roles carry exactly the access the fixed roles had, so nobody's access changes on upgrade
        var haveRoles = (await db.Roles.Select(r => r.Key).ToListAsync()).ToHashSet();
        var addRoles = Perm.BuiltIns.Where(d => !haveRoles.Contains(d.Key)).ToList();
        foreach (var d in addRoles)
            db.Roles.Add(new Role { Key = d.Key, NameEn = d.En, NameAr = d.Ar, Scope = d.Scope, Perms = Perm.Write(d.P), BuiltIn = true, Notes = "", UpdatedBy = "System", UpdatedAt = "" });
        if (addRoles.Count > 0) { await db.SaveChangesAsync(); log.LogInformation("Added {Count} built-in roles", addRoles.Count); }

        // v3: existing contracts expire at the end of their term until someone sets another expiry date
        var kOld = await db.Contracts.Where(k => k.ExpiryDate == null || k.Status == null).ToListAsync();
        foreach (var k in kOld) { k.ExpiryDate ??= k.EndDate; k.Status ??= "Active"; if (k.NoticeDays <= 0) k.NoticeDays = 30; }
        if (kOld.Count > 0) await db.SaveChangesAsync();

        // users from the first release have no language yet
        await db.Database.ExecuteSqlRawAsync("UPDATE dbo.Users SET Lang = N'en' WHERE Lang IS NULL");
        await db.Database.ExecuteSqlRawAsync("UPDATE dbo.Rates SET Source = N'' WHERE Source IS NULL");
    }
}
