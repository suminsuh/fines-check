# How this would be wrong

The tool is built to fail **visibly**. Almost every weakness below shows up in "Needs your decision" or in the self-checks rather than in the totals. The risks that remain are the ones where the tool is confidently wrong, and those are listed first.

## 1. Where it could give a wrong answer

Ordered by how much damage each would do.

### 1.1 The roster names the wrong person

- **What happens:** If drivers swapped vans and the roster wasn't updated, the tool names the rostered driver, and that looks certain. This is the one error that reaches someone's pay.
- **Evidence it happens:** In 4 of the 15 rows where the old log names a driver, the roster disagrees. I can't tell from the data whether the log or the roster is wrong.
- **Protection:**
  - Those 4 rows are not charged to anyone.
  - Nothing goes to payroll until the company has paid the fine.
  - Every payroll line shows how the driver was identified.
  - **Recommendation:** show each driver their line before payroll deducts it.

### 1.2 The portal export is stale or incomplete

- **What happens:** "What we owe" comes only from the portal, so the tool is only as current as the file.
  - Export it before a payment has cleared and the fine still shows as owed. The admin could then pay twice.
  - Export a filtered view and fines disappear from the list.
- **Protection:**
  - If the log says paid but the portal still lists the fine, the tool flags it as "Log says paid, portal says owing" with the advice "find the receipt first".
  - The banner shows the report date, and the file chip shows the row count. A sudden drop in count is the signal.

### 1.3 The +$15 / +$30 rule is wrong for some agency or offence

- **What happens:** I inferred this rule from the sample. It holds for every fine where both the original and a later amount are known separately (about a dozen), but that is still a pattern, not a published rule. For fines we only know about from a reminder, the "original" amount is worked out by subtracting the increase. If the rule is wrong, the driver's share is wrong.
- **Protection:**
  - Any amount that doesn't fit the pattern is flagged "not a normal reminder increase".
  - Changing the rule to $20 makes 3 tests fail, so a wrong rule won't slip through quietly.

### 1.4 Old fines being charged under today's policy

- **What happens:** The $1,845 "Ready for payroll" includes older fines where the old log said only "PAID" and never recorded whether the driver should pay. The tool applies the default rule (the driver on shift pays) to those too.
- **Protection:** This is a policy decision, not a calculation. Finance should look at that list before acting on it. It is marked "From old log status" or "Driver on shift pays the original fine", so it is clear which rows came from a decision and which from the rule.

### 1.5 The log's times are not UTC

- **What happens:** I assumed the "Z" means UTC. If it doesn't, every driver lookup from a log row shifts by 8 hours.
- **Evidence for the assumption:** 11 of the 12 log rows that also have a letter line up exactly once 8 hours are added. The twelfth is F-1456, one of the rows where the time was never filled in.
- **Protection:** If the conversion is turned off, 5 tests fail.

### 1.6 Two genuine offences on the same van, date, time and type

- **What happens:** These would be merged into one. That's very unlikely, and the notice numbers would still both be visible on the fine.

### 1.7 A typing error in the letter's time or date

- **What happens:** A reminder with a mistyped time doesn't match its fine, so it becomes a "new fine".
- **Why the total is still safe:** The portal row matches the original by notice number, so the reminder ends up flagged as "we have the letter but the portal doesn't list it". It shows up for review, and the amount owed is not double-counted.

### 1.8 Dates written month-first

- **What happens:** Slashed dates are read day/month, the Singapore convention. A US-style 03/09/2026 would be read as 3 September, silently.
- **Protection:** None automatic. The letters are typed in locally, so this is low risk, but it is worth knowing.

### 1.9 Wrong report date

- **What happens:** Everything marked "overdue" depends on the report date.
- **Protection:** The date is shown in the banner and defaults to today. The guide says to use the day the portal was exported.

## 2. Where it would break

| Situation | What happens | What the user sees |
|---|---|---|
| The authority changes the export columns | The file isn't recognised | "does not look like any of the five files" |
| A date, time or amount can't be read | That value is skipped | A red self-check and a list of the exact rows |
| The vehicles file is out of date (new van) | Real fines are flagged "not one of our vans" | They show in review with the closest plate. They are never re-assigned automatically. |
| The roster file ends before the offence date | No driver is named | "The roster file does not cover 5 Oct 2026. Load a newer roster." |
| The new log is re-saved in Excel | Excel rewrites the dates | Handled. A `time_reliable` column means unreliable times stay unreliable. There is a test for this. |
| Two people edit the new log the same week | Last save wins | Nothing. There is no audit trail. This is the main thing I would fix next (see build log). |

## 3. What I checked

1. **Answers first, code second.** Before building anything, I worked through the CSVs by hand with throwaway scripts (`analysis/`). I wrote down the answers: the six final notices, the four reminders with new numbers, the two duplicate scans, F-1450, the three "paid online" fines, the four wrong drivers and the UTC shift. Those became the "known answer" tests.
2. **33 automated tests**, in three groups:
   - **Parsing.** Every date, time and amount format that appears in the files.
   - **Known answers on the sample.** For example, "what we owe" equals the portal total, and nobody is charged without a roster match.
   - **Month two:**
     - Reloading the new log gives the same answer and no new fines.
     - A driver chosen by the admin stays chosen the following week.
     - Recording that the driver was named removes that request from the action list.
     - A fine that drops off the portal shows as "probably paid", not silently closed.
     - Re-saving in Excel doesn't break anything.
3. **Checking the tests can fail.** I broke two rules on purpose: the UTC conversion (5 tests failed) and the size of the reminder increase (3 failed). Then I put them back.
4. **Self-checks shown on every run.** The checks are:
   - Every portal notice matched to exactly one fine, to the cent.
   - "What we owe" equal to the portal total.
   - Every old log row carried forward.
   - Every letter accounted for.
   - Every value readable.
5. **The page itself.** I loaded the sample in a headless Edge browser and checked the rendered output and a screenshot against the figures above.

What I did **not** check: real users, real exports, a portal export taken on a different day, or how fast the portal updates after a payment.

## 4. How the user would know something is off

- **A red banner** means a self-check failed. The guide says not to send totals to anyone until it's green.
- **"Not loaded" chips** mean a file is missing, and the banner says the results are incomplete.
- **The letters breakdown should match the pile of paper.** If "New fine" is much higher than the number of new letters on her desk, matching has failed somewhere.
- **"Time unreliable" labels** and **"how the driver was found"** on every driver line make the reasoning visible, so a wrong name can be challenged.
- **"Needs your decision"** lists everything the tool refused to guess. If it's empty in a messy week, that is suspicious in itself.

## 5. AI inside the solution

There is no AI model inside the tool, by choice. Every number here can end up in someone's payslip or in front of a court, so every step has to be explainable line by line and give the same answer every time. Matching on van, date, time and offence is a lookup, not a judgement.

Where a model would earn its place is **reading the paper letters**. Turning a scanned letter into a row of `fine_letters.csv` is the part of the admin's Friday this tool doesn't remove. If I added that, I would test it like this:

- **A labelled set.** Take 100 or more real scanned letters (all agencies and all letter types, some of them poor scans). Have them typed in by hand and double-checked, and use that as the answer key.
- **Field-level accuracy, not "looks right".** Measure the error rate separately for the plate, notice number, date, time and amount. A wrong plate or date is far worse than a wrong location, so set a target per field.
- **Use the reconciliation as a second check.** A misread letter usually fails to match the portal, so it lands in "we have the letter but the portal doesn't list it". Track how often model-read letters land there compared with hand-typed ones.
- **Confidence on screen.** Show low-confidence fields highlighted for a person to confirm, and never let the model fill in a plate that isn't in the fleet.
- **Re-run the labelled set** whenever the model or prompt changes, and keep a log of the results.
