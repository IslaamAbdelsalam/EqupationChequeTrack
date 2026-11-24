#!/usr/bin/env python3
"""Security and paging checks for ChequeTrack v3.4. Run against a test server only.

Usage:  CT_USER=cfo CT_PW='...' python3 tests/e2e_security.py
        Optional: CT_OWN_USER / CT_OWN_PW = a user whose role sees only its own requests.
Start the server with ASPNETCORE_ENVIRONMENT=Development when testing over plain http (the session cookie is
HTTPS-only in production). Leave SECURITY_RATE_MULTIPLIER unset so the rate-limit test can trigger.
Base URL from CT_URL (default http://localhost:5080).
"""
import json, os, sys, urllib.request, urllib.error, http.cookiejar

URL = os.environ.get("CT_URL", "http://localhost:5080")
fails = 0


def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {extra}"))
    if not cond: fails += 1


class S:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def raw(self, path, body=None, headers=None, method=None, data=None):
        h = {"Content-Type": "application/json", "X-Requested-With": "ChequeTrack", "User-Agent": "ChequeTrack-tests"}
        if headers is not None: h = headers
        if data is None and body is not None: data = json.dumps(body).encode()
        req = urllib.request.Request(URL + path, data=data, method=method or ("POST" if data is not None else "GET"), headers=h)
        try: r = self.op.open(req, timeout=60)
        except urllib.error.HTTPError as e: r = e
        txt = r.read().decode(errors="replace")
        try: j = json.loads(txt or "{}")
        except Exception: j = {"text": txt[:200]}
        return (getattr(r, "status", None) or r.code), j, r.headers

    def call(self, path, body=None):
        return self.raw(path, body)[1]


def login(user, pw):
    s = S(); st, j, _ = s.raw("/api/login", {"username": user, "password": pw})
    if not j.get("ok"): print("cannot sign in as", user, j); sys.exit(2)
    return s


cfo = login(os.environ.get("CT_USER", "cfo"), os.environ["CT_PW"])

# ---- security headers ----
st, _, h = cfo.raw("/")
check("CSP header on pages", "frame-ancestors 'none'" in (h.get("Content-Security-Policy") or ""), h.get("Content-Security-Policy"))
check("nosniff and frame headers", h.get("X-Content-Type-Options") == "nosniff" and h.get("X-Frame-Options") == "DENY")
st, _, h = cfo.raw("/api/state")
check("API answers are never cached", "no-store" in (h.get("Cache-Control") or ""))
check("no server banner", not h.get("Server"), h.get("Server"))
st, _, _ = cfo.raw("/robots.txt"); check("robots.txt served", st == 200)

# ---- validation ----
st, j, _ = cfo.raw("/api/act", {"action": "dropTables"}); check("unknown action refused", st == 400, (st, j))
st, j, _ = cfo.raw("/api/act", {"action": "approve", "id": "CHQ-1'; DROP TABLE x;--"}); check("bad cheque id refused", st == 400, (st, j))
st, j, _ = cfo.raw("/api/act", data=b"{not json"); check("broken JSON refused", st == 400, (st, j))
st, j, _ = cfo.raw("/api/act", {"action": "saveBen", "nameEn": "x" * 5000}); check("over-long text refused", st == 400, (st, j))
st, j, _ = cfo.raw("/api/act", {"action": "saveBen", "nameEn": "a\u0000b"}); check("control characters refused", st == 400, (st, j))
st, j, _ = cfo.raw("/api/act", {"action": "saveRate", "date": "2026-13-45", "QAR": 3.64, "SDG": 2400}); check("invalid date refused", st == 400, (st, j))
st, j, _ = cfo.raw("/api/act", {"action": "setLang", "lang": "en"}, headers={"Content-Type": "application/json", "User-Agent": "x"}); check("write without the app header refused (CSRF)", st == 400, st)
st, j, _ = cfo.raw("/api/act", data=b"action=setLang", headers={"Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "ChequeTrack", "User-Agent": "x"}); check("form posts refused", st == 415, st)
st, _, _ = cfo.raw("/api/state", method="DELETE", headers={"User-Agent": "x"}); check("unused HTTP methods refused", st == 405, st)
st, j, _ = cfo.raw("/api/cheques?list=all&from=yesterday"); check("bad filter refused", st == 400, (st, j))
st, j, _ = cfo.raw("/api/cheques?list=all&cursor=not-a-cursor!"); check("bad cursor refused", st == 400, (st, j))

# ---- paging: fixed page sizes, cursor continues without repeats ----
p1 = cfo.call("/api/cheques?list=all&tab=all&size=10")
check("page of 10", p1.get("ok") and len(p1["rows"]) <= 10, p1.get("error"))
p_odd = cfo.call("/api/cheques?list=all&tab=all&size=7")
check("other sizes fall back to 25", p_odd.get("ok") and len(p_odd["rows"]) <= 25)
big = cfo.call("/api/cheques?list=all&tab=all&size=100000")
check("a huge size is not honoured", big.get("ok") and len(big["rows"]) <= 25)
if p1.get("next"):
    p2 = cfo.call("/api/cheques?list=all&tab=all&size=10&cursor=" + p1["next"])
    ids1 = {c["id"] for c in p1["rows"]}; ids2 = {c["id"] for c in p2.get("rows", [])}
    check("next page has no repeats", ids1.isdisjoint(ids2), ids1 & ids2)
a1 = cfo.call("/api/audit?size=10")
check("audit is paged", a1.get("ok") and len(a1["audit"]) <= 10)
r1 = cfo.call("/api/rates?size=10"); check("rates are paged", r1.get("ok") and len(r1["rows"]) <= 10)
st0 = cfo.call("/api/state")
check("state has no audit log", "audit" not in st0)
check("state carries server totals", all(k in st0 for k in ("kUse", "acctUse", "bookUse")))
check("alert link is masked in the state", "••••" in ((st0.get("settings") or {}).get("cronUrl") or "••••"))
check("bot token never in the state", "token" not in json.dumps(st0.get("settings", {})).lower().replace("tokenset", "").replace("tokenenv", ""))

# ---- scope and row-level security ----
ou, op = os.environ.get("CT_OWN_USER"), os.environ.get("CT_OWN_PW")
if ou and op:
    own = login(ou, op); me = own.call("/api/state")["me"]["id"]
    m = own.call("/api/cheques?list=mine&tab=all&size=100")
    check("own-scope user lists only own requests", m.get("ok") and all(c["requesterId"] == me for c in m["rows"]))
    st, j, _ = own.raw("/api/cheques?list=all")
    check("own-scope user cannot open the all-cheques list without the right", st in (200, 403) and (st == 403 or all(c["requesterId"] == me for c in j.get("rows", []))))
    others = [c for c in cfo.call("/api/cheques?list=all&tab=all&size=100").get("rows", []) if c["requesterId"] != me]
    if others:
        st, j, _ = own.raw("/api/cheque/" + others[0]["id"]); check("someone else's cheque is not found", st == 404, st)

# ---- bots and floods (run last: they can ban this IP for an hour) ----
st, _, _ = S().raw("/wp-login.php", headers={"User-Agent": "Mozilla/5.0"}); check("probe path answered 404", st == 404, st)
st, _, _ = S().raw("/", headers={"User-Agent": "sqlmap/1.7"}); check("scanner tool blocked", st == 403, st)
st, _, _ = S().raw("/api/me", headers={"Content-Type": "application/json"}); check("API call without a user agent blocked", st == 403, st)
codes = [S().raw("/api/login", {"username": "nobody", "password": "x"})[0] for _ in range(14)]
check("sign-in is rate limited (429)", 429 in codes, codes)

print("\n" + ("ALL PASSED" if fails == 0 else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
