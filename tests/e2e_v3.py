#!/usr/bin/env python3
"""End-to-end API test for ChequeTrack v3: roles & permissions, contract expiry & follow-up, Arabic names.

Usage:  python3 tests/e2e_v3.py upgrade   (on a database made by v2 and filled by `tests/e2e.py v2`)
        python3 tests/e2e_v3.py           (on a new database right after the first CFO is set up as 'cfo')
Base URL from CT_URL (default http://localhost:5080). Test passwords only.
"""
import json, os, sys, base64, urllib.request, urllib.error, http.cookiejar, datetime

URL = os.environ.get("CT_URL", "http://localhost:5080")
PW = "Test#Pass2026"
fails = 0


class S:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(URL + path, data=data, method="POST" if body is not None else "GET",
                                     headers={"Content-Type": "application/json", "X-Requested-With": "ChequeTrack"})
        try:
            r = self.op.open(req, timeout=60)
        except urllib.error.HTTPError as e:
            r = e
        txt = r.read().decode() or "{}"
        try:
            j = json.loads(txt)
        except Exception:
            j = {"ok": False, "error": txt[:200]}
        if isinstance(j, dict):
            j["_status"] = getattr(r, "status", None) or getattr(r, "code", None)
        return j

    def act(self, action, **kw):
        kw["action"] = action
        return self.call("/api/act", kw)

    def state(self):
        return self.call("/api/state")


def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(extra)[:300]))
    if not cond:
        fails += 1


def login(u, pw=PW):
    s = S()
    j = s.call("/api/login", {"username": u, "password": pw})
    check("login " + u, j.get("ok"), j)
    return s


def denied(j):
    return not j.get("ok") and j.get("_status") == 403


PDF = base64.b64encode(b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").decode()

# the access the fixed roles had before roles became editable
EXPECTED = {
    "USER": {"requests": ["view", "create", "delete"], "rates": ["view"], "beneficiaries": ["create"]},
    "FIN": {"requests": ["view", "create", "delete"], "cheques": ["view"], "issue": ["view", "issue"], "followup": ["view", "clear", "settle"],
            "contracts": ["view", "create", "edit", "delete", "follow"], "poa": ["view", "settle"], "rates": ["view", "create", "edit"],
            "reports": ["view"], "entries": ["view", "post"], "banks": ["view"], "books": ["view"], "voided": ["view", "create"],
            "beneficiaries": ["view", "create", "edit", "delete"], "telegram": ["view", "send"]},
    "TOP": {"requests": ["view", "create", "delete"], "cheques": ["view"], "approvals": ["view", "approve2"], "followup": ["view"], "contracts": ["view"],
            "poa": ["view"], "rates": ["view"], "reports": ["view"], "entries": ["view"], "banks": ["view"], "books": ["view"], "voided": ["view"],
            "beneficiaries": ["view", "create"], "telegram": ["view", "send"]},
}


def perms_equal(a, b):
    return {k: sorted(v) for k, v in a.items()} == {k: sorted(v) for k, v in b.items()}


if sys.argv[1:] == ["upgrade"]:
    cfo = login("cfo")
    st = cfo.state()
    keys = sorted(r["key"] for r in st.get("roles", []))
    check("built-in roles added on upgrade", keys == sorted(["USER", "FIN", "CFO", "TOP", "ADMIN", "AUDIT"]), keys)
    check("CFO still acts as admin while there is no System Admin", "edit" in st["me"]["perms"].get("users", []) and "edit" in st["me"]["perms"].get("roles", []), st["me"]["perms"])
    for un, role in [("fin1", "FIN"), ("top", "TOP"), ("user1", "USER")]:
        s = login(un)
        me = s.state()["me"]
        check(f"{un} keeps the {role} access", perms_equal(me["perms"], EXPECTED[role]), me["perms"])
    us = login("user1").state()
    check("department user still sees only own cheques", us["me"]["scope"] == "own" and all(c["requesterId"] == us["me"]["id"] for c in us["cheques"]))
    aud = login("aud")
    check("auditor still cannot change", denied(aud.act("saveRate", date=st["today"], QAR=3.64, SDG=2400, source="x")))
    check("auditor sees the audit log", len(aud.call("/api/audit").get("audit") or []) > 0)   # loaded on demand since v3.1
    k = next((k for k in st["contracts"] if k["opNo"] == "OP-1"), None)
    check("existing contract expires at the end of its term", k and k["expiryDate"] == k["endDate"] and k["status"] == "Active" and k["noticeDays"] == 30, k)
    print("\nFAILURES:", fails)
    sys.exit(1 if fails else 0)

# ---------------- new database ----------------
cfo = login("cfo")
st = cfo.state()
today = st["today"]
d = lambda n: (datetime.date.fromisoformat(today) + datetime.timedelta(days=n)).isoformat()
check("six built-in roles", len([r for r in st["roles"] if r["builtIn"]]) == 6, st["roles"])
check("permission catalog sent", any(p["page"] == "roles" for p in st["permCatalog"]))
fin_dept = next(x for x in st["departments"] if x["nameEn"] == "Finance")["id"]

# departments
check("add department", cfo.act("saveDept", id=0, nameEn="Operations", nameAr="العمليات").get("ok"))
check("add empty department", cfo.act("saveDept", id=0, nameEn="Temp", nameAr="مؤقت").get("ok"))
st = cfo.state()
ops = next(x for x in st["departments"] if x["nameEn"] == "Operations")["id"]
tmp = next(x for x in st["departments"] if x["nameEn"] == "Temp")["id"]

# a role for one department, with department scope
ops_perms = {"requests": ["view", "create", "delete"], "cheques": ["view"], "contracts": ["view"], "rates": ["view"], "beneficiaries": ["create"], "bogus": ["view"], "roles": ["fly"]}
j = cfo.act("saveRole", id=0, nameEn="Operations manager", nameAr="مدير العمليات", deptId=ops, scope="dept", perms=ops_perms, notes="sees the department")
check("add role", j.get("ok") and j.get("key", "").startswith("R"), j)
mgr_key, mgr_id = j.get("key"), j.get("id")
st = cfo.state()
r = next(x for x in st["roles"] if x["key"] == mgr_key)
check("unknown pages and rights are dropped", "bogus" not in r["perms"] and "roles" not in r["perms"], r["perms"])
check("role keeps department and scope", r["deptId"] == ops and r["scope"] == "dept", r)
check("same name in the same department refused", not cfo.act("saveRole", id=0, nameEn="operations MANAGER", deptId=ops, scope="own", perms={}).get("ok"))
check("bad scope refused", not cfo.act("saveRole", id=0, nameEn="X role", deptId=0, scope="everything", perms={}).get("ok"))

# users with Arabic names
def mk(un, role, dep, ar=""):
    return cfo.act("saveUser", id=0, fullName=un.title(), fullNameAr=ar, username=un, email=un + "@example.com", role=role, deptId=dep, lang="en", active=True, mustChange=False, twoFa=False, password=PW)

check("role of another department refused", not mk("wrong", mgr_key, fin_dept).get("ok"))
check("department manager", mk("opsmgr", mgr_key, ops, "مدير العمليات").get("ok"))
check("operations user", mk("opsuser", "USER", ops, "موظف العمليات").get("ok"))
check("finance user", mk("finuser", "USER", fin_dept).get("ok"))
check("finance", mk("fin", "FIN", fin_dept).get("ok"))
check("finance 2", mk("fin2", "FIN", fin_dept).get("ok"))
st = cfo.state()
u = next(x for x in st["users"] if x["username"] == "opsuser")
check("Arabic name saved", u["fullNameAr"] == "موظف العمليات", u)
check("unknown role refused", not mk("ghost", "NOPE", ops).get("ok"))

# requests from two departments
fin = login("fin")
check("rate", fin.act("saveRate", date=today, QAR=3.64, SDG=2400, source="CBOS", confirm=True).get("ok"))
check("bank", cfo.act("saveBank", id=0, nameEn="Bank of Khartoum", currency="SDG").get("ok"))
st = cfo.state()
ent = next(e for e in st["entities"] if e["funcCur"] == "SDG")["id"]
check("account", cfo.act("saveAccount", id=0, bankId=st["banks"][0]["id"], entityId=ent, last4="1234", ledger="1101", description="Main").get("ok"))
st = cfo.state()
acc = st["accounts"][0]["id"]
check("chequebook", cfo.act("saveBook", id=0, accountId=acc, **{"from": "2001", "to": "2050"}).get("ok"))
j = fin.act("saveBen", id=0, nameEn="Acme", type="Supplier")
sup = j.get("id")
j = fin.act("saveBen", id=0, nameEn="Bank Finance", type="Financier")
fid = j.get("id")


def req(s, **kw):
    base = dict(entityId=ent, opType="Supplier payment", purpose="Payment", benId=sup, related=False, currency="SDG", payCur="SDG",
                lines=[dict(opNo="", instNo=0, month="", due=0, paidBefore=0, requested=100000, principal=0)],
                docType="Invoice", docNo="INV-" + os.urandom(2).hex(), docDate=today, dueDate=today, recipientType="Beneficiary", priority="Normal",
                files=[dict(kind="doc", name="inv.pdf", type="application/pdf", data=PDF)])
    base.update(kw)
    return s.act("submitReq", **base)


opsuser, finuser, mgr = login("opsuser"), login("finuser"), login("opsmgr")
c_ops = req(opsuser).get("id")
c_fin = req(finuser).get("id")
check("both departments raised requests", c_ops and c_fin)
ms = mgr.state()
ids = {c["id"] for c in ms["cheques"]}
check("department scope: sees own department's requests", c_ops in ids and c_fin not in ids, ids)
check("department scope in /api/me", ms["me"]["scope"] == "dept")
check("manager cannot approve", denied(mgr.act("approve", id=c_ops)))
check("manager does not get account details", "email" not in ms["users"][0], ms["users"][0])
check("manager does not get bank lists", ms["accounts"] == [] and ms["books"] == [], (ms["accounts"], ms["books"]))
fs = finuser.state()
fid_file = next(c for c in fs["cheques"] if c["id"] == c_fin)["files"][0]["id"]
try:
    mgr.op.open(urllib.request.Request(URL + f"/api/file/{fid_file}"), timeout=30); got = 200
except urllib.error.HTTPError as e:
    got = e.code
check("manager cannot open another department's file", got == 404, got)
check("department user sees only own", {c["id"] for c in fs["cheques"]} == {c_fin}, [c["id"] for c in fs["cheques"]])
check("approve in scope", cfo.act("approve", id=c_ops).get("ok"))

# CFO stops acting as admin once a System Admin exists
check("system admin", mk("admin", "ADMIN", fin_dept).get("ok"))
st = cfo.state()
check("CFO no longer manages users once an admin exists", "users" not in st["me"]["perms"], st["me"]["perms"].get("users"))
admin = login("admin")

# escalation guard: a role that manages accounts but not roles
hr_perms = {"users": ["view", "create", "edit"], "departments": ["view"]}
j = admin.act("saveRole", id=0, nameEn="HR", nameAr="الموارد البشرية", deptId=0, scope="own", perms=hr_perms)
check("HR role", j.get("ok"), j)
hr_key = j.get("key")
check("hr user", admin.act("saveUser", id=0, fullName="Hr Person", fullNameAr="موظف الموارد", username="hrperson", email="hr@example.com", role=hr_key, deptId=fin_dept, lang="ar", active=True, mustChange=False, twoFa=False, password=PW).get("ok"))
hr = login("hrperson")
check("HR creates a department user", hr.act("saveUser", id=0, fullName="New Joiner", username="joiner", email="joiner@example.com", role="USER", deptId=ops, lang="en", active=True, mustChange=False, twoFa=False, password=PW).get("ok"))
check("HR cannot create a System Admin", denied(hr.act("saveUser", id=0, fullName="Sneaky", username="sneaky", email="sneaky@example.com", role="ADMIN", deptId=ops, lang="en", active=True, mustChange=False, twoFa=False, password=PW)))
adm_id = next(x for x in admin.state()["users"] if x["username"] == "admin")["id"]
check("HR cannot reset the admin's password", denied(hr.act("saveUser", id=adm_id, fullName="Admin", username="admin", email="admin@example.com", role="ADMIN", deptId=fin_dept, lang="en", active=True, mustChange=False, twoFa=False, password="New#Pass2026x")))
check("HR cannot add roles", denied(hr.act("saveRole", id=0, nameEn="Mine", deptId=0, scope="all", perms={"roles": ["view", "edit"]})))
check("admin adds a role", admin.act("saveRole", id=0, nameEn="Viewer", deptId=0, scope="all", perms={"reports": ["view"]}).get("ok"))
check("HR cannot change settings", denied(hr.act("saveSettings", section="policy", minLen=8, expiryDays=0, maxAttempts=5, lockMinutes=15, sessionMin=30, upper=True, digit=True, special=True, firstChange=True)))
check("admin changes the sign-in policy", admin.act("saveSettings", section="policy", minLen=8, expiryDays=0, maxAttempts=5, lockMinutes=15, sessionMin=30, upper=True, digit=True, special=True, firstChange=True).get("ok"))

# deleting roles and departments
check("built-in role cannot be deleted", not admin.act("delRole", id=next(r for r in admin.state()["roles"] if r["key"] == "USER")["id"]).get("ok"))
check("role in use cannot be deleted", not admin.act("delRole", id=mgr_id).get("ok"))
viewer = next(r for r in admin.state()["roles"] if r["nameEn"] == "Viewer")
check("unused role deleted", admin.act("delRole", id=viewer["id"]).get("ok"))
check("department with users cannot be deleted", not admin.act("delDept", id=ops).get("ok"))
check("empty department deleted", admin.act("delDept", id=tmp).get("ok"))
check("role moved to a department where its users are not", not admin.act("saveRole", id=mgr_id, nameEn="Operations manager", deptId=fin_dept, scope="dept", perms=ops_perms).get("ok"))

# contracts: expiry and follow-up
check("contract without expiry uses end of term", fin.act("saveContract", id=0, opNo="OP-A", financierId=fid, entityId=ent, currency="USD", principal=1000, profit=100, termMonths=12, instalments=12, startDate=d(-30)).get("ok"))
opsuser_id = next(x for x in admin.state()["users"] if x["username"] == "opsmgr")["id"]
j = fin.act("saveContract", id=0, opNo="OP-B", financierId=fid, entityId=ent, currency="USD", principal=5000, profit=500, termMonths=12, instalments=12, startDate=d(-350), expiryDate=d(10), noticeDays=30, ownerId=opsuser_id)
check("contract with expiry, reminder and owner", j.get("ok"), j)
check("expiry before start refused", not fin.act("saveContract", id=0, opNo="OP-C", financierId=fid, entityId=ent, currency="USD", principal=5000, profit=500, termMonths=12, instalments=12, startDate=d(0), expiryDate=d(-1)).get("ok"))
check("reminder over a year refused", not fin.act("saveContract", id=0, opNo="OP-C", financierId=fid, entityId=ent, currency="USD", principal=5000, profit=500, termMonths=12, instalments=12, startDate=d(0), noticeDays=400).get("ok"))
st = fin.state()
ka = next(k for k in st["contracts"] if k["opNo"] == "OP-A")
kb = next(k for k in st["contracts"] if k["opNo"] == "OP-B")
check("default expiry", ka["expiryDate"] == ka["endDate"] and ka["noticeDays"] == 30 and ka["status"] == "Active", ka)
check("fields saved", kb["expiryDate"] == d(10) and kb["ownerId"] == opsuser_id, kb)
check("follow-up date in the past refused", not fin.act("followContract", id=kb["id"], note="called them", nextDate=d(-1)).get("ok"))
check("follow-up", fin.act("followContract", id=kb["id"], note="Asked for the renewal letter", nextDate=d(3)).get("ok"))
check("owner may follow up (view only role)", mgr.act("followContract", id=kb["id"], note="Letter received", nextDate=d(5)).get("ok"))
check("user without the contracts page refused", denied(finuser.act("followContract", id=kb["id"], note="x x x")))
kb = next(k for k in fin.state()["contracts"] if k["opNo"] == "OP-B")
log = json.loads(kb["log"])
check("follow-up recorded with its kind and next date", kb["followUpDate"] == d(5) and log[-1].get("kind") == "follow" and log[-1].get("date") == d(5), log[-1])
check("renewal must move the date forward", not fin.act("renewContract", id=kb["id"], expiryDate=d(5), note="renewed").get("ok"))
j = fin.act("renewContract", id=kb["id"], expiryDate=d(375), note="Renewal letter REF-9")
check("renew", j.get("ok") and "B3.3.6" in (j.get("alert") or ""), j)
kb = next(k for k in fin.state()["contracts"] if k["opNo"] == "OP-B")
check("renewed expiry, follow-up cleared", kb["expiryDate"] == d(375) and not kb["followUpDate"], kb)

# a financing request keeps a contract open; a closed contract takes no new requests
j = req(fin, opType="Financing instalment", benId=fid, currency="USD", payCur="SDG", docNo="FIN-1",
        lines=[dict(opNo="OP-A", instNo=1, month=d(0)[:7], due=90, paidBefore=0, requested=90, principal=80)])
check("financing request", j.get("ok"), j)
c_k = j.get("id")
check("close refused while a request waits", not fin.act("closeContract", id=ka["id"], reason="Fully settled").get("ok"))
check("cancel the request", fin.act("cancelReq", id=c_k).get("ok"))
check("close needs a reason", not fin.act("closeContract", id=ka["id"], reason="Because").get("ok"))
j = fin.act("closeContract", id=ka["id"], reason="Fully settled", note="Last instalment paid")
check("close", j.get("ok") and "3.3.1" in (j.get("alert") or ""), j)
j = req(fin, opType="Financing instalment", benId=fid, currency="USD", payCur="SDG", docNo="FIN-2",
        lines=[dict(opNo="OP-A", instNo=2, month=d(0)[:7], due=90, paidBefore=0, requested=90, principal=80)])
check("closed contract takes no new requests", not j.get("ok") and "closed" in j.get("error", ""), j)
check("follow-up on a closed contract refused", not fin.act("followContract", id=ka["id"], note="still here").get("ok"))
check("reopen", fin.act("reopenContract", id=ka["id"], note="Rescheduled").get("ok"))
check("contract used by requests cannot be deleted", not fin.act("delContract", id=ka["id"]).get("ok"))
check("auditor-like roles cannot delete contracts", denied(mgr.act("delContract", id=kb["id"])))
check("unused contract deleted", fin.act("delContract", id=kb["id"]).get("ok"))

# workflow rights now come from roles: give the operations manager first approval for its department only
ops_perms2 = dict(ops_perms, approvals=["view", "approve"])
check("grant first approval to the department role", admin.act("saveRole", id=mgr_id, nameEn="Operations manager", nameAr="مدير العمليات", deptId=ops, scope="dept", perms=ops_perms2).get("ok"))
c_ops2 = req(opsuser, docNo="OPS-2").get("id")
c_fin2 = req(finuser, docNo="FIN-3").get("id")
check("department approver approves own department", mgr.act("approve", id=c_ops2).get("ok"))
check("department approver cannot approve another department", not mgr.act("approve", id=c_fin2).get("ok"))
check("department approver sees the right badge", "approve" in mgr.state()["me"]["perms"].get("approvals", []))

print("\nFAILURES:", fails)
sys.exit(1 if fails else 0)
