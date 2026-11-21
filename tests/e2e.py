#!/usr/bin/env python3
"""End-to-end API test for ChequeTrack v2.

Usage:  python3 tests/e2e.py v1   (against a v1 build: creates the CFO and an old request)
        python3 tests/e2e.py v2   (against the v2 build on the same database)
Base URL from CT_URL (default http://localhost:5080). Test passwords only.
"""
import json, os, sys, base64, urllib.request, http.cookiejar, datetime

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
            return json.loads(txt)
        except Exception:
            return {"ok": False, "error": txt[:200]}

    def act(self, action, **kw):
        kw["action"] = action
        return self.call("/api/act", kw)


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


PDF = base64.b64encode(b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").decode()

if sys.argv[1:] == ["v1"]:
    s = S()
    j = s.call("/api/setup", {"company": "Equpation", "fullName": "Chief Fin", "username": "cfo", "password": PW, "timeZone": "Africa/Khartoum"})
    check("v1 setup", j.get("ok"), j)
    s = login("cfo")
    st = s.call("/api/state")
    today = st["today"]
    print("v1 saveRate", s.act("saveRate", date=today, QAR=3.64, SDG=2400))
    print("v1 saveBen", s.act("saveBen", nameEn="Old Supplier", type="Supplier"))
    st = s.call("/api/state")
    ben = st["beneficiaries"][0]["id"] if st.get("beneficiaries") else 0
    print("v1 submitReq", s.act("submitReq", benId=ben, amount=1500000, currency="SDG", dueDate=today, reason="legacy"))
    sys.exit(0)

# ---------------- v2 ----------------
cfo = login("cfo")
st = cfo.call("/api/state")
check("state loads after upgrade", "cheques" in st and "entities" in st, st)
today = st["today"]
d = lambda n: (datetime.date.fromisoformat(today) + datetime.timedelta(days=n)).isoformat()
check("entities seeded", len(st["entities"]) >= 2, st.get("entities"))
legacy = [c for c in st["cheques"] if c.get("reason") == "legacy"]
if legacy:
    check("legacy cheque backfilled", legacy[0]["entityId"] and legacy[0]["opType"] == "Other", legacy[0])
sdg_ent = next(e for e in st["entities"] if e["funcCur"] == "SDG")["id"]
dep = st["departments"][0]["id"]

for un, role in [("fin1", "FIN"), ("fin2", "FIN"), ("top", "TOP"), ("user1", "USER"), ("aud", "AUDIT")]:
    j = cfo.act("saveUser", id=0, fullName=un.upper(), username=un, email=un + "@example.com", role=role, deptId=dep, lang="en", active=True, mustChange=False, twoFa=False, password=PW)
    check("create user " + un, j.get("ok"), j)
j = cfo.act("saveUser", id=0, fullName="No Mail", username="nomail", email="", role="USER", deptId=dep, lang="en", active=True, mustChange=False, password=PW)
check("email is required", not j.get("ok"), j)

fin1, fin2, top, user, aud = login("fin1"), login("fin2"), login("top"), login("user1"), login("aud")
check("auditor cannot change", not aud.act("saveRate", date=today, QAR=3.64, SDG=2400, source="x").get("ok"))

# rates: document date 2360, today 2400 (worked example)
check("rate doc date", fin1.act("saveRate", date=d(-5), QAR=3.64, SDG=2360, source="CBOS").get("ok"))
j = fin1.act("saveRate", date=d(-1), QAR=3.64, SDG=2700, source="CBOS")
check("rate alert asks to confirm", j.get("confirm") is True, j)
check("rate alert confirmed", fin1.act("saveRate", date=d(-1), QAR=3.64, SDG=2700, source="CBOS", confirm=True).get("ok"))
check("rate today", fin1.act("saveRate", date=today, QAR=3.64, SDG=2400, source="CBOS", confirm=True).get("ok"))
check("only finance enters rates", not user.act("saveRate", date=today, QAR=3.64, SDG=2400, source="x").get("ok"))

# banking
check("bank SDG", cfo.act("saveBank", id=0, nameEn="Bank of Khartoum", currency="SDG").get("ok"))
check("bank USD", cfo.act("saveBank", id=0, nameEn="QNB", currency="USD").get("ok"))
st = cfo.call("/api/state")
bsdg = next(b for b in st["banks"] if b["currency"] == "SDG")["id"]
check("account", cfo.act("saveAccount", id=0, bankId=bsdg, entityId=sdg_ent, last4="1234", ledger="1101", description="Main").get("ok"))
check("account needs 4 digits", not cfo.act("saveAccount", id=0, bankId=bsdg, entityId=sdg_ent, last4="12345678").get("ok"))
st = cfo.call("/api/state")
acc = st["accounts"][0]["id"]
check("chequebook", cfo.act("saveBook", id=0, accountId=acc, **{"from": "1001", "to": "1050"}).get("ok"))
check("chequebook overlap refused", not cfo.act("saveBook", id=0, accountId=acc, **{"from": "1040", "to": "1060"}).get("ok"))
check("void number", fin1.act("voidNo", accountId=acc, number="1001", reason="spoiled").get("ok"))

# financier + contract
j = fin1.act("saveBen", id=0, nameEn="Bank Finance Co", type="Financier")
check("financier", j.get("ok"), j)
fid = j["id"]
j = user.act("saveBen", id=0, nameEn="Acme Supplies", type="Supplier")
check("requester adds beneficiary", j.get("ok"), j)
sup = j["id"]
check("contract", fin1.act("saveContract", id=0, opNo="OP-1", financierId=fid, entityId=sdg_ent, currency="USD", principal=100000, profit=9000, termMonths=12, instalments=12, startDate=d(-30)).get("ok"))


def req(s, **kw):
    base = dict(entityId=sdg_ent, opType="Supplier payment", purpose="Payment", benId=sup, related=False, currency="SDG", payCur="SDG",
                lines=[dict(opNo="INV-" + os.urandom(3).hex(), instNo=0, month="", due=0, paidBefore=0, requested=1000000, principal=0)],
                docType="Invoice", docNo="INV-1", docDate=d(-5), dueDate=today, recipientType="Beneficiary", priority="Normal",
                files=[dict(kind="doc", name="inv.pdf", type="application/pdf", data=PDF)])
    base.update(kw)
    return s.act("submitReq", **base)


j = req(user, files=[])
check("document required", not j.get("ok") and "supporting" in j.get("error", ""), j)
j = req(user, currency="USD", payCur="SDG", opType="Financing instalment", benId=fid,
        lines=[dict(opNo="OP-1", instNo=1, month=d(0)[:7], due=8000, paidBefore=0, requested=8000, principal=7000)])
check("financing request", j.get("ok"), j)
c1 = j.get("id")
j = req(user, currency="USD", payCur="SDG", opType="Financing instalment", benId=fid,
        lines=[dict(opNo="OP-1", instNo=1, month=d(0)[:7], due=8000, paidBefore=0, requested=8000, principal=7000)])
check("duplicate warning", j.get("dup") is True, j)
j = req(cfo)
c_cfo = j.get("id")
check("cfo request", j.get("ok"), j)
check("cfo cannot approve own", not cfo.act("approve", id=c_cfo).get("ok"))

j = cfo.act("approve", id=c1)
check("approve", j.get("ok"), j)
c = next(x for x in cfo.call("/api/state")["cheques"] if x["id"] == c1)
check("approval rate saved (doc date)", c["appr"]["rateDate"] == d(-5) and float(c["appr"]["sdg"]) == 2360, c["appr"])
check("approval value 18,880,000", float(c["appr"]["funcVal"]) == 18880000, c["appr"])
check("no second approval under limit", c["status"] == "Approved", c["status"])
j = fin1.act("issue", id=c1, accountId=acc, no="1001", date=today)
check("voided number refused", not j.get("ok"), j)
j = fin1.act("issue", id=c1, accountId=acc, no="1002", date=today)
check("issue", j.get("ok"), j)
c = next(x for x in cfo.call("/api/state")["cheques"] if x["id"] == c1)
check("issue amount 19,200,000", float(c["payAmt"]) == 19200000, c.get("payAmt"))
check("issue FX difference 320,000", float(c["issue"]["fxDiff"]) == 320000, c["issue"])
check("issue rate saved", c["issue"]["rateDate"] == today, c["issue"])
check("receive", user.act("receive", id=c1).get("ok"))
check("deliver", user.act("deliver", id=c1, to="Mr X", date=today).get("ok"))
check("issuer cannot clear", not fin1.act("close", id=c1, status="Cleared").get("ok"))
check("clear", fin2.act("close", id=c1, status="Cleared").get("ok"))
c = next(x for x in cfo.call("/api/state")["cheques"] if x["id"] == c1)
check("clearing rate saved", c["closed"]["rateDate"] == today and float(c["closed"]["fxDiff"]) == 0, c["closed"])
check("post entry", fin1.act("postEntry", key="ISS-" + c1).get("ok"))
check("post entry twice refused", not fin1.act("postEntry", key="ISS-" + c1).get("ok"))

# second approval: related party
j = req(user, related=True)
c2 = j.get("id")
check("related request", j.get("ok"), j)
cfo.act("approve", id=c2)
c = next(x for x in cfo.call("/api/state")["cheques"] if x["id"] == c2)
check("goes to second approval", c["status"] == "Pending2", c["status"])
check("second approval", top.act("approve2", id=c2).get("ok"))

# return and settle
j = req(user)
c3 = j["id"]
cfo.act("approve", id=c3)
fin1.act("issue", id=c3, accountId=acc, no="1003", date=today)
user.act("receive", id=c3); user.act("deliver", id=c3, to="", date=today)
check("return needs reason", not fin2.act("close", id=c3, status="Returned").get("ok"))
check("return", fin2.act("close", id=c3, status="Returned", reason="insufficient funds").get("ok"))
check("settle returned", fin1.act("solve", id=c3, method="Transfer", note="TRX-1").get("ok"))

# user sees only own cheques; forgot password stays generic
us = user.call("/api/state")
check("user sees only own", all(x["requesterId"] == us["me"]["id"] for x in us["cheques"]), len(us["cheques"]))
j = S().call("/api/forgot", {"email": "nobody@example.com"})
check("forgot password: clear message while email is not set up", not j.get("ok") and "not set up" in j.get("error", ""), j)
print("\nFAILURES:", fails)
sys.exit(1 if fails else 0)
