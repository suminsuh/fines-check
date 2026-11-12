import re
import pandas as pd
from datetime import datetime, timedelta

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 30)
pd.set_option("display.max_rows", 500)
pd.set_option("display.max_colwidth", 60)

D = "C:/Users/aiinapp/hackathons/PRISM/"
L = pd.read_csv(D + "fine_letters.csv", dtype=str).fillna("")
G = pd.read_csv(D + "fines_log.csv", dtype=str).fillna("")
P = pd.read_csv(D + "portal_export.csv", dtype=str).fillna("")
V = pd.read_csv(D + "vehicles.csv", dtype=str).fillna("")
R = pd.read_csv(D + "driver_roster.csv", dtype=str).fillna("")


def plate(s):
    return re.sub(r"\s+", "", s).upper()


def sg_checksum(p):
    m = re.fullmatch(r"([A-Z]{1,3})(\d{1,4})([A-Z])", p)
    if not m:
        return None
    pre, num, chk = m.groups()
    pre = pre[-2:] if len(pre) == 3 else pre.rjust(2, "@")
    vals = [0 if c == "@" else ord(c) - 64 for c in pre] + [int(c) for c in num.rjust(4, "0")]
    s = sum(v * w for v, w in zip(vals, [9, 4, 5, 4, 3, 2]))
    return "AZYXUTSRPMLKJHGEDCB"[s % 19] == chk


def pdate(s):
    s = s.strip()
    for f in ("%d %b %Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, f).date()
        except ValueError:
            pass
    return None


def ptime(s):
    s = s.strip().lower()
    m = re.fullmatch(r"(\d{1,2})[.:](\d{2})\s*(am|pm)", s)
    if m:
        h, mi, ap = int(m[1]), int(m[2]), m[3]
        h = h % 12 + (12 if ap == "pm" else 0)
        return f"{h:02d}:{mi:02d}"
    m = re.fullmatch(r"(\d{1,2}):?(\d{2})", s)
    if m:
        return f"{int(m[1]):02d}:{m[2]}"
    return None


def amt(s):
    s = re.sub(r"[S$,\s]", "", s)
    return float(s) if s else None


print("=== VEHICLES checksum ===")
V["chk"] = V.vehicle_no.map(sg_checksum)
print(V)
fleet = set(V.vehicle_no)

L["plate"] = L.vehicle_no.map(plate)
L["d"] = L.offence_date.map(pdate)
L["t"] = L.offence_time.map(ptime)
L["amt"] = L.amount.map(amt)
L["in_fleet"] = L.plate.isin(fleet)
L["chk"] = L.plate.map(sg_checksum)
print("\n=== LETTERS parsed ===")
print(L[["letter_id", "letter_type", "agency", "notice_no", "plate", "d", "t", "offence", "amt", "pay_by", "received_on", "in_fleet", "chk"]])

print("\nletter types:", L.letter_type.value_counts().to_dict())
print("dup notice nos in letters:")
print(L[L.notice_no.duplicated(keep=False)][["letter_id", "notice_no", "letter_type", "received_on"]])
L["key"] = L.plate + "|" + L.d.astype(str) + "|" + L.t.fillna("")
print("\ndup offence keys in letters:")
print(L[L.key.duplicated(keep=False)].sort_values("key")[["letter_id", "notice_no", "letter_type", "key", "amt"]])

# LOG
G["utc"] = pd.to_datetime(G.offence_at.str.replace("Z", ""), format="%Y-%m-%dT%H:%M")
G["sgt"] = G.utc + timedelta(hours=8)
G["key"] = G.vehicle_no + "|" + G.sgt.dt.date.astype(str) + "|" + G.sgt.dt.strftime("%H:%M")
G["offence_eq_logged"] = G.offence_at.str.replace("T", " ").str.replace("Z", "") == G.logged_at
print("\n=== LOG ===")
print(G[["log_id", "notice_no", "vehicle_no", "sgt", "amount", "driver", "status", "deduction_status", "note", "logged_at", "offence_eq_logged"]])
print("status values:", G.status.str.strip().value_counts().to_dict())
print("deduction values:", G.deduction_status.value_counts().to_dict())

# PORTAL
P["d"] = P.offence_date.map(pdate)
print("\nportal status:", P.status.value_counts().to_dict(), "total", P.amount_payable.astype(float).sum())

# Cross ref by notice no
Lnos = set(L.notice_no)
Gnos = set(G.notice_no) - {""}
Pnos = set(P.notice_no)
print("\n=== PORTAL notice in letters? in log? ===")
P["in_letters"] = P.notice_no.isin(Lnos)
P["in_log"] = P.notice_no.isin(Gnos)
P["vd"] = P.vehicle_no + "|" + P.d.astype(str)
L["vd"] = L.plate + "|" + L.d.astype(str)
G["vd"] = G.vehicle_no + "|" + G.sgt.dt.date.astype(str)
G["vd_utc"] = G.vehicle_no + "|" + G.utc.dt.date.astype(str)
P["letters_by_vd"] = P.vd.map(lambda k: ",".join(L[L.vd == k].letter_id + ":" + L[L.vd == k].notice_no))
P["log_by_vd"] = P.vd.map(lambda k: ",".join(G[G.vd == k].log_id + ":" + G[G.vd == k].notice_no + ":" + G[G.vd == k].status.str.strip()))
print(P[["notice_no", "vehicle_no", "agency", "d", "amount_payable", "status", "in_letters", "in_log", "letters_by_vd", "log_by_vd"]])

print("\n=== LOG entries 'paid' but on portal ===")
paid = G[G.status.str.lower().str.contains("paid") & ~G.status.str.lower().str.contains("unpaid|pending")]
print(paid[paid.notice_no.isin(Pnos)][["log_id", "notice_no", "status", "deduction_status", "note"]])

print("\n=== LOG entries open but NOT on portal ===")
openg = G[~G.index.isin(paid.index)]
print(openg[~openg.notice_no.isin(Pnos)][["log_id", "notice_no", "vehicle_no", "sgt", "amount", "status", "note", "vd"]])

print("\n=== LETTERS not in log by notice, and not on portal ===")
for _, r in L.iterrows():
    print(r.letter_id, r.letter_type[:14].ljust(14), r.notice_no.ljust(12), r.plate, r.d, r.t, "log:", r.notice_no in Gnos,
          "logvd:", ",".join(G[G.vd == r.vd].log_id), "portal:", r.notice_no in Pnos, "portalvd:", ",".join(P[P.vd == r.vd].notice_no + "/" + P[P.vd == r.vd].amount_payable))

# Roster
R["plate"] = R.vehicle_no.map(plate)
R["d"] = R.date.map(pdate)
print("\nroster date range", R.d.min(), R.d.max(), "rows", len(R))
print("roster drivers:", R.driver.value_counts().to_dict())
print("shift patterns:", (R.shift_start + "-" + R.shift_end).value_counts().to_dict())
print("roster plates not in fleet:", set(R.plate) - fleet)
cnt = R.groupby("d").plate.nunique()
print("days with <12 vans:", cnt[cnt < 12].to_dict())
dd = R.groupby(["d", "plate"]).size()
print("multi rows per van-day:", (dd > 1).sum())


def who(p, d, t):
    rows = R[(R.plate == p) & (R.d == d)]
    if rows.empty:
        return "NO ROSTER ROW"
    hits = rows[(rows.shift_start <= t) & (rows.shift_end >= t)] if t else rows
    if hits.empty:
        return "OUTSIDE SHIFT (" + ";".join(rows.driver + " " + rows.shift_start + "-" + rows.shift_end) + ")"
    return ";".join(hits.driver)


print("\n=== Driver lookup letters ===")
for _, r in L.iterrows():
    print(r.letter_id, r.plate, r.d, r.t, "->", who(r.plate, r.d, r.t))
print("\n=== Driver lookup log: SGT vs UTC vs logged driver ===")
for _, r in G.iterrows():
    print(r.log_id, r.vehicle_no, r.sgt, "| sgt->", who(r.vehicle_no, r.sgt.date(), r.sgt.strftime("%H:%M")),
          "| utc->", who(r.vehicle_no, r.utc.date(), r.utc.strftime("%H:%M")), "| logged:", r.driver)
