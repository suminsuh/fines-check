import pandas as pd
from datetime import date, timedelta
exec(open("C:/Users/aiinapp/hackathons/PRISM/analysis/explore.py").read().split('print("=== VEHICLES')[0])

P["amt"] = P.amount_payable.astype(float)
print("portal total", P.amt.sum(), "n", len(P))
print(P.groupby("status").amt.agg(["count", "sum"]))
print(P.groupby("vehicle_no").amt.agg(["count", "sum"]).sort_values("sum", ascending=False))
print(P.groupby("agency").amt.agg(["count", "sum"]))

G["a"] = pd.to_numeric(G.amount, errors="coerce")
st = G.status.str.strip().str.lower()
G["bucket"] = "other"
G.loc[st.str.contains("paid") & ~st.str.contains("unpaid|pending"), "bucket"] = "paid"
G.loc[st.str.contains("unpaid|pending payment"), "bucket"] = "open"
G.loc[st.str.contains("appeal"), "bucket"] = "appeal"
print(G.groupby("bucket").a.agg(["count", "sum"]))
print("log open total vs portal total:", G[G.bucket == "open"].a.sum(), P.amt.sum())

drv = G.status.str.lower().str.contains("deduct")
print("marked 'deduct driver':", drv.sum(), G[drv].a.sum())
print(G[drv].groupby("deduction_status").a.agg(["count", "sum"]))
print("named driver among deduct rows:", (G[drv].driver != "").sum())
absorb = G.status.str.lower().str.contains("absorb")
print("absorb rows deduction:", G[absorb].deduction_status.value_counts().to_dict())

# escalation: original amount from log/letter vs portal
pairs = [("H631210B8", 40), ("L296268D4", 130), ("H562282M5", 35), ("H538841J9", 70), ("U797768M7", 70),
         ("L301045H0", 130), ("L429620J1", 70), ("L675137H6", 70)]
inc = sum(P.set_index("notice_no").amt[n] - o for n, o in pairs)
print("escalation on logged items", inc)

# roster gaps
R["d"] = R.date.map(pdate)
alld = pd.date_range("2026-06-01", "2026-09-30").date
missing = [d for d in alld if d not in set(R.d)]
print("roster missing days:", [(d, d.strftime("%a")) for d in missing])
print("weekday of roster days:", pd.Series([d.strftime("%a") for d in sorted(set(R.d))]).value_counts().to_dict())
print("WORKSHOP rows:", R[R.driver == "WORKSHOP"][["date", "vehicle_no"]].values.tolist())
print("GBC7735C roster rows:", (R.plate == "GBC7735C").sum())
print("offences by type (letters):", L.offence.value_counts().to_dict())
print("letters by plate:", L.plate.value_counts().to_dict())
for d in ["2026-10-02", "2026-10-06"]:
    print(d, date.fromisoformat(d).strftime("%a"))
print("max received", L.received_on.max(), "max logged", G.logged_at.max())
print("received lag days:", (pd.to_datetime(L.received_on) - pd.to_datetime(L.d.astype(str))).dt.days.describe())
