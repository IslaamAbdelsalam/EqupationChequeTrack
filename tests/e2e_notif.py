#!/usr/bin/env python3
"""End-to-end API test for the notifications (v3.3): change pulse, seen marker, messages reaching the right people.

Usage:  python3 tests/e2e_notif.py   (on the database left by `tests/e2e_v3.py`, which creates the test users)
Base URL from CT_URL (default http://localhost:5080). Test passwords only.
"""
import json, os, sys, urllib.request, urllib.error, http.cookiejar

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

    def pulse(self):
        return self.call("/api/pulse").get("pulse")


def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(extra)[:300]))
    if not cond:
        fails += 1


def login(u):
    s = S()
    j = s.call("/api/login", {"username": u, "password": PW})
    check("login " + u, j.get("ok"), j)
    return s


anon = S()
j = anon.call("/api/pulse")
check("pulse needs sign-in", j.get("_status") == 401, j)

cfo, fin = login("cfo"), login("fin")
p0 = cfo.pulse()
check("pulse answers when signed in", bool(p0) and ":" in p0, p0)
st = cfo.call("/api/state")
check("state carries the same pulse", st.get("pulse") == p0, (st.get("pulse"), p0))
check("state carries the server time", len(st.get("now", "")) == 16 and st["now"][:10] == st.get("today"), st.get("now"))
check("me has a seen marker field", "notifSeen" in st.get("me", {}), st.get("me"))

# own view only: language and seen marker do not wake the other screens
lang = st["me"].get("lang", "en")
check("set language ok", cfo.act("setLang", lang=lang).get("ok"))
check("private action keeps the pulse", cfo.pulse() == p0, (cfo.pulse(), p0))
j = cfo.act("seenNotifs")
check("seenNotifs ok", j.get("ok") and len(j.get("at", "")) == 16, j)
check("seen marker saved", cfo.call("/api/state")["me"]["notifSeen"] == j.get("at"))
check("seen marker keeps the pulse", cfo.pulse() == p0, (cfo.pulse(), p0))

# a refused action does not move it
j = cfo.act("approve", id="CHQ-9999")
check("refused action refused", not j.get("ok"), j)
check("refused action keeps the pulse", cfo.pulse() == p0, (cfo.pulse(), p0))

# a message on a request moves it, and reaches Finance as unread
chq = st["cheques"][0]["id"] if st.get("cheques") else None
check("a request exists to write on", chq is not None)
j = cfo.act("comment", id=chq, kind="Query", to="finance", text="Please check the bank letter before issuing.")
check("message saved", j.get("ok"), j)
p1 = fin.pulse()
check("saved change moves the pulse", p1 and p1 != p0, (p0, p1))
fs = fin.call("/api/state")
check("Finance's state carries the new pulse", fs.get("pulse") == p1, (fs.get("pulse"), p1))
m = [x for x in fs.get("comments", []) if x["chequeId"] == chq and x["text"].startswith("Please check the bank letter")]
check("Finance sees the message as unread", m and m[-1]["read"] is False and m[-1]["to"] == "finance", m)
cm = [x for x in cfo.call("/api/state").get("comments", []) if x["chequeId"] == chq and x["text"].startswith("Please check the bank letter")]
check("the writer has it as read", cm and cm[-1]["read"] is True, cm)
j = fin.act("readComments", id=chq)
check("Finance opens the request", j.get("ok"), j)
check("reading keeps the pulse", fin.pulse() == p1, (fin.pulse(), p1))
m = [x for x in fin.call("/api/state").get("comments", []) if x["chequeId"] == chq and x["text"].startswith("Please check the bank letter")]
check("then it is read", m and m[-1]["read"] is True, m)

print("\nFAILURES:", fails)
sys.exit(1 if fails else 0)
