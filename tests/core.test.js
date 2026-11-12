// Run with:  node --test tests/
// Two kinds of test: small ones on the parsing rules, and "known answers" on the
// sample data. The known answers were worked out by hand from the CSVs before the
// tool existed (see submission/01_problem_and_questions.md, appendix).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const core = require('../prototype/fines-core.js');

const root = path.join(__dirname, '..');
const readCSV = (f) => core.parseCSV(fs.readFileSync(path.join(root, f), 'utf8'));
const sample = () => ({
  letters: readCSV('fine_letters.csv'), log: readCSV('fines_log.csv'), portal: readCSV('portal_export.csv'),
  vehicles: readCSV('vehicles.csv'), roster: readCSV('driver_roster.csv'),
});
const TODAY = '2026-10-06';
const byId = (r, id) => r.cases.find((c) => c.id === id);
const byNotice = (r, n) => r.cases.find((c) => c.notices.includes(n));
const hasFlag = (c, type, re) => c.flags.some((f) => f.type === type && (!re || re.test(f.text)));

/* ------------------------------------------------------------- parsing */

test('dates in all three formats, slashes read as day/month', () => {
  assert.equal(core.parseDate('8 Sep 2026'), '2026-09-08');
  assert.equal(core.parseDate('2026-09-09'), '2026-09-09');
  assert.equal(core.parseDate('09/10/2026'), '2026-10-09');
  assert.equal(core.parseDate('31/02/2026'), null);
  assert.equal(core.parseDate(''), null);
});

test('times as written on letters', () => {
  assert.equal(core.parseTime('8.44am'), '08:44');
  assert.equal(core.parseTime('12.33pm'), '12:33');
  assert.equal(core.parseTime('12.05am'), '00:05');
  assert.equal(core.parseTime('5.27pm'), '17:27');
  assert.equal(core.parseTime('0918'), '09:18');
  assert.equal(core.parseTime('2040'), '20:40');
  assert.equal(core.parseTime('08:25'), '08:25');
  assert.equal(core.parseTime('25:00'), null);
  assert.equal(core.parseTime('13.00pm'), null);
});

test('amounts with and without currency signs', () => {
  assert.equal(core.parseAmount('$70.00'), 70);
  assert.equal(core.parseAmount('S$50.00'), 50);
  assert.equal(core.parseAmount('70'), 70);
  assert.equal(core.parseAmount(''), null);
  assert.equal(core.parseAmount('seventy'), null);
});

test('log timestamps are UTC and move to Singapore time, including across midnight', () => {
  assert.deepEqual(core.parseLogTimestamp('2026-09-07T22:40Z'), { date: '2026-09-08', time: '06:40' });
  assert.deepEqual(core.parseLogTimestamp('2026-09-15T00:58Z'), { date: '2026-09-15', time: '08:58' });
  assert.deepEqual(core.parseLogTimestamp('2026-09-15T08:58+08:00'), { date: '2026-09-15', time: '08:58' });
  assert.equal(core.toUtcStamp('2026-09-08', '06:40'), '2026-09-07T22:40Z');
});

test('the old status column is split into "paid?" and "who pays?"', () => {
  assert.deepEqual(core.parseLogStatus('Paid (To be deducted from Driver Salary) '), { payment: 'paid', liability: 'Driver' });
  assert.deepEqual(core.parseLogStatus('Paid (company absorb)'), { payment: 'paid', liability: 'Company' });
  assert.deepEqual(core.parseLogStatus('Paid - deduct driver'), { payment: 'paid', liability: 'Driver' });
  assert.equal(core.parseLogStatus('PAID').liability, null);
  assert.equal(core.parseLogStatus('Pending payment').payment, 'unpaid');
  assert.equal(core.parseLogStatus('unpaid').payment, 'unpaid');
  assert.equal(core.parseLogStatus('Appealed').payment, 'appealed');
  assert.equal(core.parseLogStatus('3241287852').payment, 'paid');
});

test('CSV with quoted commas and a byte-order mark', () => {
  const rows = core.parseCSV('\uFEFFa,b\r\n1,"x, ""y"""\r\n\r\n');
  assert.deepEqual(rows.map(({ _row, ...r }) => r), [{ a: '1', b: 'x, "y"' }]);
});

test('files are recognised by their columns', () => {
  const s = sample();
  for (const k of Object.keys(s)) assert.equal(core.detectKind(s[k]), k);
});

/* --------------------------------------------------- sample: known answers */

const R = core.reconcile(sample(), TODAY);

test('self-checks all pass on the sample', () => {
  for (const c of R.checks) assert.ok(c.ok, c.text);
  assert.equal(R.problems.length, 0);
});

test('what we owe equals the portal, and the six final notices are found', () => {
  assert.equal(R.summary.owedTotal + R.summary.appealTotal, 5135);
  assert.equal(R.summary.finalCount, 6);
  assert.equal(R.summary.finalTotal, 595);
  const finals = R.cases.filter((c) => c.payment === 'owed' && c.stage === 'final').map((c) => c.mainNotice).sort();
  assert.deepEqual(finals, ['H221805E2', 'H952175J9', 'L301045H0', 'L429620J1', 'U171086K1', 'U392609H5']);
  assert.equal(R.summary.oldLogOpenTotal, 1455);
});

test('a reminder with a new notice number joins the fine already in the log', () => {
  const c = byId(R, 'F-1436');
  assert.ok(c.notices.includes('L520164H8'), 'reminder SCAN-003 attached');
  assert.ok(c.notices.includes('L675137H6'), 'portal number attached');
  assert.equal(c.original, 70);
  assert.equal(c.current, 85);
  assert.equal(c.lateCharge, 15);
  for (const id of ['SCAN-003', 'SCAN-006', 'SCAN-017', 'SCAN-036']) {
    assert.equal(R.letters.find((l) => l.id === id).outcome, 'escalation-known', id);
  }
});

test('letters scanned twice are counted once', () => {
  assert.equal(R.letters.find((l) => l.id === 'SCAN-050').duplicateOf, 'SCAN-041');
  assert.equal(R.letters.find((l) => l.id === 'SCAN-027').duplicateOf, 'SCAN-023');
});

test('F-1450 is flagged as the reminder for F-1400 typed in as a new fine', () => {
  const c = byId(R, 'F-1450');
  assert.equal(c.possibleDuplicateOf, 'F-1400');
});

test('"paid online 28 Sep" fines that are still on the portal are caught', () => {
  const caught = R.cases.filter((c) => hasFlag(c, 'paid-but-owed')).map((c) => c.id).sort();
  assert.deepEqual(caught, ['F-1432', 'F-1433', 'F-1448']);
});

test('drivers named in the log but not on the roster are not charged', () => {
  for (const id of ['F-1406', 'F-1413', 'F-1430']) {
    const c = byId(R, id);
    assert.equal(c.driver, '', id);
    assert.ok(hasFlag(c, 'driver', /roster has/), id);
  }
  assert.ok(hasFlag(byId(R, 'F-1448'), 'driver', /workshop/));
});

test('UTC fix: F-1449 is 06:40 on 8 Sep, before the shift, so no driver', () => {
  const c = byId(R, 'F-1449');
  assert.equal(c.date, '2026-09-08');
  assert.equal(c.time, '06:40');
  assert.equal(c.roster.kind, 'outside');
  assert.equal(c.driver, '');
});

test('shift handover overlap is left to a person', () => {
  const c = byNotice(R, 'U916472B7');
  assert.equal(c.roster.kind, 'overlap');
  assert.deepEqual(c.candidates.sort(), ['Eswaran K', 'Kumar R']);
  assert.equal(c.liable, 'To decide');
});

test('both driver-particulars requests are top of the list, and overdue', () => {
  const p = R.actions.filter((a) => a.kind === 'Name the driver');
  assert.equal(p.length, 2);
  assert.ok(R.actions.slice(0, 2).every((a) => a.kind === 'Name the driver'));
  const easy = p.find((a) => a.plate === 'GBD7374M');
  assert.match(easy.text, /Ivan Koh/);
  const hard = p.find((a) => a.plate === 'GBC7735C');
  assert.match(hard.text, /Find out who had GBC7735C/);
  assert.ok(p.every((a) => a.daysLeft < 0));
});

test('a final notice we never had a letter for is still on the action list', () => {
  const a = R.actions.find((x) => x.notice === 'U392609H5');
  assert.ok(a);
  assert.match(a.text, /never received any letter/);
});

test('plates not in the fleet are flagged with a suggestion, never changed', () => {
  const c1 = R.cases.find((c) => c.plate === 'GBK9325C');
  assert.ok(hasFlag(c1, 'plate', /GBK9025C/));
  assert.equal(R.cases.find((c) => c.plate === 'SMK4471T').payment, 'not-fleet');
  assert.ok(!R.cases.some((c) => c.plate === 'GBD4791E' && c.liable === 'Driver'));
});

test('letter corrects a bad log date (F-1456: log 20 Sep, letter 9 Sep)', () => {
  const c = byId(R, 'F-1456');
  assert.equal(c.date, '2026-09-09');
  assert.ok(hasFlag(c, 'data', /20 Sep 2026/));
});

test('nobody is charged without a roster match or an admin decision, and never for late charges', () => {
  for (const c of R.cases.filter((x) => x.liable === 'Driver')) {
    assert.ok(c.driver, c.id + ' has a driver');
    assert.ok(c.driverSource === 'Roster' || c.driverSource === 'Admin', c.id);
  }
  for (const row of core.payrollRows(R)) {
    const c = byId(R, row.fine_ref);
    assert.equal(Number(row.amount_to_deduct), c.original, row.fine_ref);
    assert.equal(c.payment, 'paid', row.fine_ref + ' only listed once we have paid');
  }
});

test('recovered from drivers matches the two rows marked Deducted', () => {
  assert.equal(R.summary.recovery.deducted, 105);
});

/* ----------------------------------------------------- month two: re-use */

function rerunWithRegister(result, input, edit) {
  let rows = core.registerRows(result);
  if (edit) rows = edit(rows);
  const csv = core.toCSV(rows, core.REGISTER_COLUMNS);
  return core.reconcile({ ...input, log: core.parseCSV(csv) }, TODAY);
}

test('loading the new log back in gives the same answer and no new fines', () => {
  const input = sample();
  const r2 = rerunWithRegister(R, input);
  assert.equal(r2.cases.length, R.cases.length);
  assert.equal(r2.summary.owedTotal, R.summary.owedTotal);
  assert.equal(r2.summary.finalCount, R.summary.finalCount);
  assert.ok(r2.letters.every((l) => ['already-logged', 'duplicate', 'escalation-known', 'particulars', 'not-fleet'].includes(l.outcome)),
    'every letter is recognised as known the second time');
  for (const c of r2.checks) assert.ok(c.ok, c.text);
  assert.deepEqual(r2.cases.map((c) => c.id), R.cases.map((c) => c.id));
});

test('re-saving the new log in Excel (dates rewritten) does not make bad times look good', () => {
  const excelish = (iso) => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/); return m ? +m[3] + '/' + +m[2] + '/' + m[1] + (m[4] ? ' ' + +m[4] + ':' + m[5] : '') : iso; };
  const r2 = rerunWithRegister(R, sample(), (rows) => rows.map((r) => ({ ...r, logged_at: excelish(r.logged_at), pay_by: excelish(r.pay_by) })));
  assert.equal(byId(r2, 'F-1401').timeTrusted, false);
  assert.equal(byId(r2, 'F-1401').driver, '');
  assert.equal(byId(r2, 'F-1450').possibleDuplicateOf, 'F-1400');
  assert.equal(r2.summary.owedTotal, R.summary.owedTotal);
  assert.equal(byId(r2, 'F-1438').payBy, byId(R, 'F-1438').payBy);
});

test('an admin decision on the driver sticks next week', () => {
  const target = byNotice(R, 'U916472B7').id;
  const r2 = rerunWithRegister(R, sample(), (rows) => rows.map((r) => (r.log_id === target ? { ...r, driver: 'Kumar R', driver_source: 'Admin' } : r)));
  const c = byId(r2, target);
  assert.equal(c.driver, 'Kumar R');
  assert.equal(c.liable, 'Driver');
});

test('once the driver has been named, the request leaves the action list', () => {
  const target = byNotice(R, 'L433452J5').id;
  const r2 = rerunWithRegister(R, sample(), (rows) => rows.map((r) => (r.log_id === target ? { ...r, driver_named_on: '2026-10-06' } : r)));
  assert.equal(r2.actions.filter((a) => a.kind === 'Name the driver').length, 1);
});

test('a fine that drops off the portal next week is shown as probably paid, not silently closed', () => {
  const input = sample();
  input.portal = input.portal.filter((p) => p.notice_no !== 'H224460B3');
  const r2 = rerunWithRegister(R, input);
  const c = byNotice(r2, 'H224460B3');
  assert.equal(c.payment, 'not-on-portal');
  assert.ok(hasFlag(c, 'not-on-portal', /probably paid/));
  assert.equal(r2.summary.owedTotal + r2.summary.appealTotal, 5100);
});

test('once the admin marks a dropped-off fine as Paid, it goes on the payroll list', () => {
  const input = sample();
  input.portal = input.portal.filter((p) => p.notice_no !== 'H224460B3');
  const r2 = rerunWithRegister(R, input);
  const id = byNotice(r2, 'H224460B3').id;
  assert.ok(!core.payrollRows(r2).some((p) => p.fine_ref === id));
  const r3 = rerunWithRegister(r2, input, (rows) => rows.map((r) => (r.log_id === id ? { ...r, status: 'Paid' } : r)));
  const line = core.payrollRows(r3).find((p) => p.fine_ref === id);
  assert.ok(line);
  assert.equal(line.driver, 'Chandran S');
  assert.equal(line.amount_to_deduct, '35.00');
});

/* -------------------------------------------------- made-up edge cases */

const tiny = (over) => ({
  vehicles: [{ vehicle_no: 'GBA1234A', status: 'Active' }],
  roster: [
    { date: '01/10/2026', vehicle_no: 'GBA 1234 A', shift_start: '08:00', shift_end: '18:00', driver: 'Alice' },
  ],
  log: [], letters: [], portal: [], ...over,
});
const letter = (o) => ({ letter_id: 'X', letter_type: 'Notice', agency: 'LTA', notice_no: 'L1', vehicle_no: 'GBA1234A', offence_date: '1 Oct 2026', offence_time: '10:00',
  offence: 'Stopping in a no-stopping zone', amount: '$70.00', pay_by: '20 Oct 2026', received_on: '2026-10-03', ...o });

test('an offence after the roster ends says so, instead of "not on the roster"', () => {
  const r = core.reconcile(tiny({ letters: [letter({ offence_date: '5 Oct 2026' })] }), '2026-10-06');
  assert.match(r.cases[0].driverWhy, /roster file does not cover 5 Oct 2026/);
  assert.equal(r.cases[0].liable, 'To decide');
});

test('portal row that could belong to two fines is not guessed', () => {
  const r = core.reconcile(tiny({
    letters: [letter({ letter_id: 'A', notice_no: 'L1', offence_time: '10:00' }), letter({ letter_id: 'B', notice_no: 'L2', offence_time: '15:00' })],
    portal: [{ notice_no: 'L9', vehicle_no: 'GBA1234A', agency: 'LTA', offence_date: '01/10/2026', amount_payable: '70.00', status: 'Outstanding' }],
  }), '2026-10-06');
  const p = r.cases.find((c) => c.portal);
  assert.equal(p.letters.length, 0);
  assert.ok(hasFlag(p, 'review', /Could belong to/));
});

test('reminder arriving before the original creates one fine, and the original then joins it', () => {
  const r = core.reconcile(tiny({
    letters: [
      letter({ letter_id: 'R', letter_type: 'Reminder', notice_no: 'L2', amount: '85', received_on: '2026-10-02' }),
      letter({ letter_id: 'N', notice_no: 'L1', amount: '70', received_on: '2026-10-04' }),
    ],
  }), '2026-10-06');
  assert.equal(r.cases.length, 1);
  assert.equal(r.cases[0].original, 70);
  assert.equal(r.cases[0].stage, 'reminder');
});

test('an amount that is not a normal reminder increase is flagged', () => {
  const r = core.reconcile(tiny({
    letters: [letter({ notice_no: 'L1', amount: '70' })],
    portal: [{ notice_no: 'L1', vehicle_no: 'GBA1234A', agency: 'LTA', offence_date: '01/10/2026', amount_payable: '92.00', status: 'Outstanding' }],
  }), '2026-10-06');
  assert.ok(hasFlag(r.cases[0], 'data', /not a normal reminder increase/));
});

test('a self-check fails loudly if the portal file has a row the tool cannot read', () => {
  const r = core.reconcile(tiny({
    portal: [{ notice_no: 'L1', vehicle_no: 'GBA1234A', agency: 'LTA', offence_date: '01/10/2026', amount_payable: 'n/a', status: 'Outstanding' }],
  }), '2026-10-06');
  assert.ok(r.checks.some((c) => !c.ok));
});
