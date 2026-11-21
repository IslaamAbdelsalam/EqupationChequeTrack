using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ChequeTrack;

// NOTE: every column added after the first release must also be added in Schema.cs,
// which upgrades an existing database in place (EnsureCreated only builds new databases).

public class Department
{
    public int Id { get; set; }
    [MaxLength(150)] public string NameEn { get; set; } = "";
    [MaxLength(150)] public string NameAr { get; set; } = "";
}

public class Entity
{
    public int Id { get; set; }
    [MaxLength(150)] public string NameEn { get; set; } = "";
    [MaxLength(150)] public string NameAr { get; set; } = "";
    [MaxLength(5)] public string FuncCur { get; set; } = "SDG";
}

public class AppUser
{
    public int Id { get; set; }
    [MaxLength(60)] public string Username { get; set; } = "";
    [MaxLength(150)] public string FullName { get; set; } = "";
    [MaxLength(10)] public string Role { get; set; } = "USER"; // TOP, CFO, FIN, USER, ADMIN, AUDIT
    public int DeptId { get; set; }
    public bool Active { get; set; } = true;
    [MaxLength(100)] public string PwdHash { get; set; } = "";
    public bool MustChange { get; set; }
    public int Failed { get; set; }
    public DateTime? LockedUntilUtc { get; set; }
    [MaxLength(10)] public string PwdChangedAt { get; set; } = ""; // yyyy-MM-dd (local)
    [MaxLength(20)] public string LastLogin { get; set; } = "";
    // added in v2
    [MaxLength(150)] public string Email { get; set; } = "";
    [MaxLength(5)] public string Lang { get; set; } = "en";
    public bool TwoFa { get; set; }
    [MaxLength(100)] public string TwoFaHash { get; set; } = "";
    public DateTime? TwoFaExpUtc { get; set; }
    public int TwoFaTries { get; set; }
}

public class Beneficiary
{
    public int Id { get; set; }
    [MaxLength(20)] public string Type { get; set; } = "Supplier";
    [MaxLength(200)] public string NameEn { get; set; } = "";
    [MaxLength(200)] public string NameAr { get; set; } = "";
    [MaxLength(150)] public string Contact { get; set; } = "";
    [MaxLength(50)] public string Phone { get; set; } = "";
    [MaxLength(150)] public string Email { get; set; } = "";
    [MaxLength(30)] public string Code { get; set; } = "";
}

public class Rate
{
    [Key, MaxLength(20)] public string Id { get; set; } = ""; // FX-yyyyMMdd
    [MaxLength(10)] public string Date { get; set; } = "";
    [Column(TypeName = "decimal(18,6)")] public decimal QAR { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal SDG { get; set; }
    [MaxLength(150)] public string SetBy { get; set; } = "";
    [MaxLength(20)] public string SetAt { get; set; } = "";
    [MaxLength(100)] public string Source { get; set; } = "";
}

public class Bank
{
    public int Id { get; set; }
    [MaxLength(150)] public string NameEn { get; set; } = "";
    [MaxLength(150)] public string NameAr { get; set; } = "";
    [MaxLength(5)] public string Currency { get; set; } = "SDG";
    public bool Active { get; set; } = true;
}

public class BankAccount
{
    public int Id { get; set; }
    public int BankId { get; set; }
    public int EntityId { get; set; }
    [MaxLength(150)] public string Description { get; set; } = "";
    [MaxLength(4)] public string Last4 { get; set; } = "";
    [MaxLength(30)] public string Ledger { get; set; } = "";
    public bool Active { get; set; } = true;
}

public class Chequebook
{
    public int Id { get; set; }
    public int AccountId { get; set; }
    public long FromNo { get; set; }
    public long ToNo { get; set; }
    public bool Active { get; set; } = true;
    [MaxLength(150)] public string AddedBy { get; set; } = "";
    [MaxLength(20)] public string AddedAt { get; set; } = "";
}

public class VoidedNo
{
    public int Id { get; set; }
    public int AccountId { get; set; }
    public long Number { get; set; }
    [MaxLength(300)] public string Reason { get; set; } = "";
    [MaxLength(150)] public string By { get; set; } = "";
    [MaxLength(20)] public string At { get; set; } = "";
}

public class Contract
{
    public int Id { get; set; }
    [MaxLength(50)] public string OpNo { get; set; } = "";
    public int FinancierId { get; set; }
    public int EntityId { get; set; }
    [MaxLength(5)] public string Currency { get; set; } = "USD";
    [Column(TypeName = "decimal(18,2)")] public decimal Principal { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal Profit { get; set; }
    public int TermMonths { get; set; }
    public int Instalments { get; set; }
    [MaxLength(10)] public string StartDate { get; set; } = "";
    [MaxLength(10)] public string EndDate { get; set; } = "";
    [MaxLength(500)] public string Notes { get; set; } = "";
    public string Log { get; set; } = "[]"; // JSON list of {at, by, text}
    [MaxLength(150)] public string CreatedBy { get; set; } = "";
    [MaxLength(20)] public string CreatedAt { get; set; } = "";
}

public class ChequeLine
{
    public int Id { get; set; }
    [MaxLength(20)] public string ChequeId { get; set; } = "";
    [MaxLength(50)] public string OpNo { get; set; } = "";
    public int InstNo { get; set; }
    [MaxLength(7)] public string Month { get; set; } = ""; // yyyy-MM
    [Column(TypeName = "decimal(18,2)")] public decimal Due { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal PaidBefore { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal Requested { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal Principal { get; set; }
}

public class Attachment
{
    public int Id { get; set; }
    [MaxLength(20)] public string ChequeId { get; set; } = "";
    [MaxLength(20)] public string Kind { get; set; } = "doc"; // doc | auth | prior
    [MaxLength(200)] public string FileName { get; set; } = "";
    [MaxLength(100)] public string ContentType { get; set; } = "";
    public int Size { get; set; }
    public byte[] Data { get; set; }
    [MaxLength(150)] public string By { get; set; } = "";
    [MaxLength(20)] public string At { get; set; } = "";
}

public class PostedEntry
{
    [Key, MaxLength(80)] public string Key { get; set; } = "";
    [MaxLength(150)] public string By { get; set; } = "";
    [MaxLength(20)] public string At { get; set; } = "";
}

public class PwdReset
{
    public int Id { get; set; }
    public int UserId { get; set; }
    [MaxLength(64)] public string TokenHash { get; set; } = "";
    public DateTime ExpUtc { get; set; }
    public DateTime? UsedUtc { get; set; }
    public DateTime CreatedUtc { get; set; }
}

public class Cheque
{
    [Key, MaxLength(20)] public string Id { get; set; } = ""; // CHQ-0001
    public int Seq { get; set; }
    public int RequesterId { get; set; }
    public int DeptId { get; set; }
    public int BenId { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal Amount { get; set; }   // total requested, contract currency
    [MaxLength(5)] public string Currency { get; set; } = "USD";             // contract currency
    [MaxLength(10)] public string DueDate { get; set; } = "";
    [MaxLength(1000)] public string Reason { get; set; } = "";
    [MaxLength(20)] public string Status { get; set; } = "Pending";
    [MaxLength(20)] public string CreatedAt { get; set; } = "";
    // first approval (FxId = locked rate of the document date)
    [MaxLength(150)] public string ApprovedBy { get; set; }
    [MaxLength(20)] public string ApprovedAt { get; set; }
    [MaxLength(5)] public string PayCur { get; set; }                         // payment currency (chosen in the request)
    [Column(TypeName = "decimal(18,2)")] public decimal? PayAmt { get; set; } // cheque amount, payment currency
    [MaxLength(20)] public string FxId { get; set; }
    // issue
    [MaxLength(50)] public string ChequeNo { get; set; }
    [MaxLength(150)] public string Bank { get; set; }
    [MaxLength(10)] public string ChequeDate { get; set; }
    [MaxLength(150)] public string IssuedBy { get; set; }
    [MaxLength(20)] public string IssuedAt { get; set; }
    // requester
    [MaxLength(150)] public string ReceivedBy { get; set; }
    [MaxLength(20)] public string ReceivedAt { get; set; }
    [MaxLength(150)] public string DeliveredBy { get; set; }
    [MaxLength(20)] public string DeliveredAt { get; set; }
    [MaxLength(150)] public string DeliveredTo { get; set; }
    // close
    [MaxLength(20)] public string ClosedStatus { get; set; }
    [MaxLength(150)] public string ClosedBy { get; set; }
    [MaxLength(20)] public string ClosedAt { get; set; }
    [MaxLength(500)] public string ClosedReason { get; set; }
    [MaxLength(150)] public string SolvedBy { get; set; }
    [MaxLength(20)] public string SolvedAt { get; set; }
    [MaxLength(500)] public string SolvedNote { get; set; }
    [MaxLength(150)] public string RejectedBy { get; set; }
    [MaxLength(20)] public string RejectedAt { get; set; }
    [MaxLength(500)] public string RejectReason { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; }

    // ---------- added in v2 ----------
    public int? EntityId { get; set; }
    [MaxLength(40)] public string OpType { get; set; }
    [MaxLength(20)] public string Purpose { get; set; }
    public bool Related { get; set; }
    [MaxLength(60)] public string DocType { get; set; }
    [MaxLength(60)] public string DocNo { get; set; }
    [MaxLength(10)] public string DocDate { get; set; }
    [MaxLength(100)] public string Project { get; set; }
    [MaxLength(60)] public string CounterAcct { get; set; }
    [MaxLength(10)] public string RemainDate { get; set; }
    [MaxLength(10)] public string PoaSettleDate { get; set; }
    [MaxLength(20)] public string RecipientType { get; set; }
    [MaxLength(150)] public string RecipientName { get; set; }
    [MaxLength(30)] public string PayMethod { get; set; }
    [MaxLength(20)] public string Priority { get; set; }
    [MaxLength(300)] public string PriorityReason { get; set; }
    public bool PriorPaid { get; set; }
    [MaxLength(10)] public string PriorDate { get; set; }
    [MaxLength(60)] public string PriorMethod { get; set; }
    [MaxLength(100)] public string PriorRef { get; set; }
    public bool DupConfirmed { get; set; }
    // approval snapshot (A3)
    public int? ApprovedById { get; set; }
    [MaxLength(10)] public string ApprRateDate { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal? ApprQar { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal? ApprSdg { get; set; }
    [MaxLength(100)] public string ApprSrc { get; set; }
    [MaxLength(150)] public string ApprRateBy { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? UsdEq { get; set; }
    [MaxLength(5)] public string FuncCur { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? FuncVal { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? FuncPrincipal { get; set; }
    // second approval
    public bool Need2 { get; set; }
    [MaxLength(200)] public string Need2Why { get; set; }
    [MaxLength(150)] public string Appr2By { get; set; }
    public int? Appr2ById { get; set; }
    [MaxLength(20)] public string Appr2At { get; set; }
    // issue snapshot
    public int? AccountId { get; set; }
    public int? IssuedById { get; set; }
    [MaxLength(20)] public string IssueRateId { get; set; }
    [MaxLength(10)] public string IssueRateDate { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal? IssueQar { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal? IssueSdg { get; set; }
    [MaxLength(100)] public string IssueSrc { get; set; }
    [MaxLength(150)] public string IssueRateBy { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? IssueFxDiff { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? CarryFunc { get; set; }
    // clearing / return snapshot (A4)
    public int? ClosedById { get; set; }
    [MaxLength(20)] public string ClearRateId { get; set; }
    [MaxLength(10)] public string ClearRateDate { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal? ClearQar { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal? ClearSdg { get; set; }
    [MaxLength(100)] public string ClearSrc { get; set; }
    [MaxLength(150)] public string ClearRateBy { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? ClearUsdEq { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? ClearFuncVal { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? ClearFxDiff { get; set; }
    [MaxLength(30)] public string SolveMethod { get; set; }
    // payment on account settlement
    [MaxLength(150)] public string PoaSettledBy { get; set; }
    [MaxLength(20)] public string PoaSettledAt { get; set; }
    [MaxLength(150)] public string PoaRef { get; set; }
}

public class AuditEntry
{
    public long Id { get; set; }
    [MaxLength(20)] public string At { get; set; } = "";
    [MaxLength(150)] public string User { get; set; } = "";
    [MaxLength(100)] public string Action { get; set; } = "";
    [MaxLength(50)] public string Entity { get; set; } = "";
    [MaxLength(1000)] public string Details { get; set; } = "";
}

public class Setting
{
    [Key, MaxLength(50)] public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

public class TgMessage
{
    public long Id { get; set; }
    [MaxLength(20)] public string At { get; set; } = "";
    [MaxLength(4000)] public string Text { get; set; } = "";
    [MaxLength(20)] public string Kind { get; set; } = "event"; // event | digest
    [MaxLength(10)] public string Day { get; set; } = "";
    public int Count { get; set; }
    [MaxLength(150)] public string By { get; set; } = "";
    public bool Sent { get; set; }
    [MaxLength(300)] public string Error { get; set; } = "";
}

public class AppDb : DbContext, IDataProtectionKeyContext
{
    public AppDb(DbContextOptions<AppDb> o) : base(o) { }
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Entity> Entities => Set<Entity>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Beneficiary> Beneficiaries => Set<Beneficiary>();
    public DbSet<Rate> Rates => Set<Rate>();
    public DbSet<Bank> Banks => Set<Bank>();
    public DbSet<BankAccount> BankAccounts => Set<BankAccount>();
    public DbSet<Chequebook> Chequebooks => Set<Chequebook>();
    public DbSet<VoidedNo> VoidedNos => Set<VoidedNo>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Cheque> Cheques => Set<Cheque>();
    public DbSet<ChequeLine> ChequeLines => Set<ChequeLine>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<PostedEntry> PostedEntries => Set<PostedEntry>();
    public DbSet<PwdReset> PwdResets => Set<PwdReset>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<TgMessage> TgMessages => Set<TgMessage>();
    public DbSet<DataProtectionKey> DataProtectionKeys { get; set; }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AppUser>().HasIndex(x => x.Username).IsUnique();
        b.Entity<Cheque>().HasIndex(x => x.Seq).IsUnique();
        b.Entity<Cheque>().HasIndex(x => x.Status);
        b.Entity<Cheque>().HasIndex(x => x.RequesterId);
        b.Entity<TgMessage>().HasIndex(x => new { x.Kind, x.Day });
        b.Entity<Contract>().HasIndex(x => x.OpNo).IsUnique();
        b.Entity<ChequeLine>().HasIndex(x => x.ChequeId);
        b.Entity<Attachment>().HasIndex(x => x.ChequeId);
        b.Entity<PwdReset>().HasIndex(x => x.TokenHash);
    }
}
