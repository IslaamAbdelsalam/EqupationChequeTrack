using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ChequeTrack;

public class Department
{
    public int Id { get; set; }
    [MaxLength(150)] public string NameEn { get; set; } = "";
    [MaxLength(150)] public string NameAr { get; set; } = "";
}

public class AppUser
{
    public int Id { get; set; }
    [MaxLength(60)] public string Username { get; set; } = "";
    [MaxLength(150)] public string FullName { get; set; } = "";
    [MaxLength(10)] public string Role { get; set; } = "USER"; // TOP, CFO, FIN, USER
    public int DeptId { get; set; }
    public bool Active { get; set; } = true;
    [MaxLength(100)] public string PwdHash { get; set; } = "";
    public bool MustChange { get; set; }
    public int Failed { get; set; }
    public DateTime? LockedUntilUtc { get; set; }
    [MaxLength(10)] public string PwdChangedAt { get; set; } = ""; // yyyy-MM-dd (local)
    [MaxLength(20)] public string LastLogin { get; set; } = "";
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
}

public class Rate
{
    [Key, MaxLength(20)] public string Id { get; set; } = ""; // FX-yyyyMMdd
    [MaxLength(10)] public string Date { get; set; } = "";
    [Column(TypeName = "decimal(18,6)")] public decimal QAR { get; set; }
    [Column(TypeName = "decimal(18,6)")] public decimal SDG { get; set; }
    [MaxLength(150)] public string SetBy { get; set; } = "";
    [MaxLength(20)] public string SetAt { get; set; } = "";
}

public class Cheque
{
    [Key, MaxLength(20)] public string Id { get; set; } = ""; // CHQ-0001
    public int Seq { get; set; }
    public int RequesterId { get; set; }
    public int DeptId { get; set; }
    public int BenId { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal Amount { get; set; }
    [MaxLength(5)] public string Currency { get; set; } = "USD";
    [MaxLength(10)] public string DueDate { get; set; } = "";
    [MaxLength(1000)] public string Reason { get; set; } = "";
    [MaxLength(20)] public string Status { get; set; } = "Pending";
    [MaxLength(20)] public string CreatedAt { get; set; } = "";
    // approval
    [MaxLength(150)] public string ApprovedBy { get; set; }
    [MaxLength(20)] public string ApprovedAt { get; set; }
    [MaxLength(5)] public string PayCur { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal? PayAmt { get; set; }
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
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Beneficiary> Beneficiaries => Set<Beneficiary>();
    public DbSet<Rate> Rates => Set<Rate>();
    public DbSet<Cheque> Cheques => Set<Cheque>();
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
    }
}
