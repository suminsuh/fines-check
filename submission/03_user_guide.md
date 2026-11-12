# Fines check: your Friday guide

**What it does.** You give it the week's letters, your fines log and the portal export. It tells you what we owe, what is heading to court, what to pay or answer first, and what each driver owes us. It also works out which letters are new fines and which are reminders for fines you already have, so nothing gets logged twice. It doesn't guess: anything it isn't sure about is put in front of you.

## Every Friday (about 15 minutes)

1. **Download the portal export** for our vans and save it as a CSV.
2. **Type the week's letters into the letters sheet** as you do now, and save it as a CSV.
3. **Open Fines check** by double-clicking `index.html` in the Fines check folder.
4. **Drag in all five files at once:**
   - the letters sheet
   - **last week's new fines log** (the first time only, your current fines log)
   - the portal export
   - the vehicles list
   - the roster

   Five green labels should appear.
5. **Set the report date** to the day you downloaded the portal export.
6. **Check the banner.** Green means the totals agree with the portal. If it's red, stop and see below.
7. **Work down "Do this first".** Top to bottom:
   - Requests to name a driver
   - Final notices
   - "Paid but still owing"
   - Overdue fines
   - Fines due this week
8. **Download "New fines log"** and save it in the shared folder. That file **is** your log from now on. Use it next week.
9. On payday, **send finance the payroll deduction list**.

## Settling "Needs your decision"

Open the **new fines log** in Excel, find the fine by its F-number, change the cell, then save as **CSV**. Next week the tool will pick up your change.

| If... | Do this |
|---|---|
| You know who was driving | Put their name in `driver` and type `Admin` in `driver_source`. |
| You've named the driver on the portal | Put the date in `driver_named_on`. The request disappears from the list. |
| The company should pay, not the driver | Type `Company` in `liable`. |
| A fine says "probably paid" and you've seen the receipt | Type `Paid` in `status`. Only then does it go on the payroll list. |
| A row is a reminder logged as a new fine | Delete that row. |
| A plate looks wrong | Check the paper letter. Fix it in the **letters sheet**, not in the log. |

## When it looks wrong

- **Red banner:** don't send any totals to anyone. Open "How the tool checked itself" to see which check failed. Usually a file is missing or is last week's.
- **A fine you've paid shows as owed:** the portal can take a few days to update. Find the receipt before paying again.
- **A driver is clearly wrong:** set the right one (see above). Never deduct from anyone's pay without the driver confirming.
- **Far more "New fine" letters than you actually received:** a date or time was probably typed differently. Check the letters sheet for that van.
- **"File does not look like any of the five files":** the file is probably saved as Excel (.xlsx) instead of CSV, or its top row of column names is missing.
- **Anything else:** take a screenshot and send it to the Ops Tools team (me, for now).

**Remember:** the tool never pays, emails or deducts anything. It only tells you. You stay in charge.
