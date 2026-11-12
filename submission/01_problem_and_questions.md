# 1. Problem statement

**What is broken.** The fines log records letters, not offences. One offence typically generates several letters: a notice, a reminder under a new number at a higher amount, sometimes a request to name the driver, then a final notice. Because nothing links them, the log cannot reliably say what is owed, who is liable, or what has been recovered.

**Who it affects.** The manager lacks an accurate view of exposure: the log shows $1,455 outstanding, the portal $5,135, including six final notices, two logged months ago. Drivers bear the cost of guesswork: four of fifteen named drivers were not on that van. Finance cannot track recovery: only $105 of $1,025 marked for deduction is confirmed.

**How we would know it is fixed.** The weekly total reconciles to the portal, every deduction traces to the roster, no known fine reaches final notice, and the admin's task takes under an hour.

---

# 2. Questions I would have asked

The questions are grouped by the decision they affect. Each states why I am asking, the answer I assumed, how that assumption shaped the build, and the risk if the assumption turns out to be wrong.

## A. Sources of truth

### Q1. Is the authorities' portal the definitive record of what we owe, and can it be exported weekly?

- **Why I am asking:** Letters are an incomplete feed. Three fines on the portal have no corresponding letter, one of which (U392609H5, $100) is already at final notice. Five others reached us only as a reminder or final notice, which means the original letter was lost.
- **Assumption:** Yes. The portal is authoritative and the admin can export it every Friday. I treated the export date, 6 Oct 2026, as "today".
- **Impact on the build:** The tool reconciles everything against the portal. Letters serve as supporting detail, not as the primary record.
- **Risk if wrong:** High. If the portal lags behind the letters, recently issued fines would appear to be missing.

### Q2. When a reminder is issued under a new notice number, does the portal retain the original number?

- **Why I am asking:** The reminder for the 20 Aug offence on GBD4491E carries L520164H8, while the portal lists the same offence as L675137H6.
- **Assumption:** Yes. The portal keeps the original number, and reminders are issued under new ones.
- **Impact on the build:** Fines are matched on vehicle, offence date and time, and offence type rather than notice number. Amounts confirm the stage, since a reminder is consistently the original plus $15 and a final notice the original plus $30. This is how F-1450 ($165) was identified as the reminder for F-1400 ($150) and therefore a duplicate. The admin had flagged it herself with the note "reminder?".
- **Risk if wrong:** Medium. Two genuinely separate offences on the same van at the same minute would be merged. This is unlikely, and the tool flags such cases for review.

### Q3. Where are salary deductions actually made, and can payroll confirm them?

- **Why I am asking:** Finance wants to know how much has been recovered, but the log's "Deducted" column appears to be the admin's own record rather than payroll's. Only two rows are marked as deducted.
- **Assumption:** Deductions are made in payroll. The log reflects intent, not confirmation.
- **Impact on the build:** The tool produces a per-driver deduction list for payroll and tracks each item as sent, confirmed or disputed. Recovery figures count only confirmed items.
- **Risk if wrong:** High. I would also ask HR whether drivers have given written consent to these deductions. Without consent, the recoverable amount may be close to zero regardless of the data.

## B. Liability and policy

### Q4. When a fine increases because a letter was not actioned in time, who bears the increase?

- **Why I am asking:** Roughly $330 of the current portal balance consists of late charges, not original penalties.
- **Assumption:** The driver is liable for the original amount and the company absorbs any increase.
- **Impact on the build:** Each fine is split into an original amount, attributable to the driver, and a late charge, attributable to the company. Charging a driver $160 for a $130 offence because of internal delays would be difficult to defend.
- **Risk if wrong:** Low. This is a policy setting and can be changed in one place.

### Q5. What is the rule for when the company absorbs a fine and when the driver pays?

- **Why I am asking:** The log applies the two inconsistently. Comparable offences are sometimes absorbed and sometimes deducted, and four rows marked "company absorb" still show a deduction as pending.
- **Assumption:** Drivers pay for speeding, bus lane and parking offences committed during their own shift. The company absorbs fines incurred while the van was in the workshop, not rostered, or where the driver cannot be identified.
- **Impact on the build:** The tool applies this default rule consistently and allows the admin to override it with a recorded reason.
- **Risk if wrong:** Medium. The rule is simple to change, but any deductions already made under the wrong rule would need to be reversed.

### Q6. To what extent can the roster be relied on to identify the driver?

- **Why I am asking:** The roster is incomplete in predictable ways. Split shifts overlap between 12:30 and 13:00. Some offences occurred at 20:40, 21:05 and 06:40, outside rostered hours. There is no roster for Sundays, and the spare van GBC7735C rarely appears at all. The log already names the wrong driver in 4 of 15 cases, usually the van's regular driver when a relief driver was on duty. In one case (F-1448) the van was in the workshop.
- **Assumption:** The roster is reliable for offences within a single shift. Outside that, the driver cannot be determined from the data.
- **Impact on the build:** The tool assigns a driver only when exactly one roster entry matches. Otherwise it lists the candidates and leaves the decision to the admin.
- **Risk if wrong:** High. An incorrect assignment results in a deduction from the wrong employee's pay. I would also ask whether drivers take vans home overnight, as this would account for the after-hours offences.

## C. Legal deadlines

### Q7. Who responds to "Request for driver particulars" letters, and how is the deadline calculated?

- **Why I am asking:** Failing to respond is an offence in its own right and is likely the more serious court risk. It has happened before (F-1451). Two requests are currently open. One is straightforward, as Ivan Koh was rostered on GBD7374M at the time. The other concerns a speeding offence on the spare van on 3 Sep, a day on which no driver is rostered to it.
- **Assumption:** The admin responds via the portal within 14 days of receiving the letter.
- **Impact on the build:** These requests are ranked above final notices in the action list, with the roster match shown alongside.
- **Risk if wrong:** High. If the deadline runs from the letter date rather than the date received, both requests may already be overdue.

## D. Data quality

### Q8. What happened to the payments recorded as "paid online 28 Sep"?

- **Why I am asking:** All three fines marked this way are still outstanding on the portal ($235). One of them is also pending deduction from Darren Lim.
- **Assumption:** The payments either failed or were made against incorrect notice numbers.
- **Impact on the build:** A fine is counted as paid only when it no longer appears on the portal or has a receipt reference. Cases where the log says paid but the portal still lists the fine are reported separately, because the driver is charged while the fine continues to escalate.
- **Risk if wrong:** Low. If the payments did go through, these fines will drop off the portal at the next export.

### Q9. Are letters bearing plates outside our fleet (SMK4471T, GBK9325C, GBD4791E) transcription errors or misdirected?

- **Why I am asking:** GBK9325C differs from GBK9025C by one digit, and GBD4791E from GBD4491E by one digit. None of the three appears on the portal under our fleet.
- **Assumption:** Two are likely typing errors. SMK4471T is a private-car plate and probably not ours.
- **Impact on the build:** Plates are never corrected automatically. The tool suggests the closest fleet vehicle and places the letter on a short list to be checked against the original paper.
- **Risk if wrong:** Medium. An automatic correction could attach a fine to the wrong vehicle and therefore the wrong driver.

### Q10. Are the log's timestamps in UTC, and how are they entered?

- **Why I am asking:** Every log time ends in "Z", and every row aligns with its letter only after adding eight hours. Seven rows have an offence time identical to their logged time, which suggests the form defaulted to the current time. I verified one of these (F-1456), and it is wrong: the letter states 9 Sep and the log records 20 Sep.
- **Assumption:** The timestamps are UTC. Rows where the offence time equals the logged time are unreliable.
- **Impact on the build:** All times are converted to Singapore time before matching against the roster. No driver is suggested where the offence time is suspect. For example, 22:40 UTC on 7 Sep is 06:40 on 8 Sep locally, which falls on a different roster day.
- **Risk if wrong:** High. Matching on the wrong day would assign fines to the wrong drivers across the board.

---

# Appendix: evidence behind the statements above

| Finding | Evidence |
|---|---|
| Log open total vs portal | Log rows marked Unpaid or Pending payment add up to $1,455. The portal shows 56 notices totalling $5,135. Part of the gap is September post not yet logged; the rest is listed below. |
| Final notices (6, $595) | L301045H0 and L429620J1 were already in the log. H952175J9, U171086K1 and H221805E2 only arrived as a reminder or final notice. U392609H5 never arrived at all. |
| Reminders with new numbers | SCAN-003, 006, 017 and 036 are all reminders for fines already in the log, so they would have been logged twice. |
| Duplicate letters | SCAN-041 and SCAN-050 are the same letter scanned twice, as are SCAN-023 and SCAN-027. SCAN-044 is a second copy of a fine logged on 2 Sep. |
| Fixed reminder increases | A reminder is the original +$15 (70→85, 35→50, 40→55, 130→145, 150→165). A final notice is the original +$30. |
| Wrong driver in log | F-1406 (rostered: Marcus Yeo), F-1413 (Kumar R), F-1430 (Hafiz Salleh), F-1448 (van in workshop). |
| Driver can't be determined automatically | Split-shift overlap (SCAN-004, 029), after hours (SCAN-011, 021, F-1449), Sundays (F-1414), spare van with no roster entry (SCAN-009, 015, 022, 024, 032, 047). |
| Recovery | 13 rows marked "deduct" total $1,025, and only 5 of them name a driver. Rows marked Deducted: F-1404 ($35) and F-1423 ($70). |
| Contradictory statuses | "Company absorb" with deduction Pending (F-1403, 1408, 1421, 1431). A payment reference typed into the status column (F-1405). "Deduct" alongside Waived (F-1430, 1448). |
| Suspect offence times | F-1401, 1414, 1421, 1429, 1443, 1450 and 1456 have offence time equal to logged time. |
| Log says open, portal doesn't list it | F-1442, 1443, 1444, 1445 and 1450. These are probably paid somewhere the log doesn't know about, so the log is wrong in both directions. |
| `registered_holder` is not the driver | Raymond Lee is the holder of four vans but also handles fines. Treat this column as the van's custodian, not as who to charge. |
