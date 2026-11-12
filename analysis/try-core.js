const fs = require('fs');
const path = require('path');
const core = require('../prototype/fines-core.js');
const root = path.join(__dirname, '..');
const read = (f) => core.parseCSV(fs.readFileSync(path.join(root, f), 'utf8'));
const input = {
  letters: read('fine_letters.csv'), log: read('fines_log.csv'), portal: read('portal_export.csv'),
  vehicles: read('vehicles.csv'), roster: read('driver_roster.csv'),
};
const r = core.reconcile(input, process.argv[2] || '2026-10-06');
const { byDriver, ...rec } = r.summary.recovery;
console.log(JSON.stringify({ ...r.summary, recovery: rec }, null, 1));
console.log(byDriver);
console.log(r.checks);
console.log(r.problems);
console.log('\nACTIONS');
r.actions.forEach((a) => console.log(a.priority, a.kind.padEnd(34), a.deadline, a.daysLeft, a.caseId, a.notice, a.plate, a.amount, '|', a.text));
console.log('\nLETTERS');
r.letters.forEach((l) => console.log(l.id, l.stage.padEnd(11), l.outcome.padEnd(18), l.caseId, l.matchedBy, l.duplicateOf));
console.log('\nCASES');
r.cases.forEach((c) => console.log(c.id, c.plate, c.date, c.time, c.timeTrusted ? '' : '(t?)', c.mainNotice, c.stage, c.original, c.current, c.lateCharge, c.payment, '| drv:', c.driver || '-', '|', c.liable, c.deduction, '\n   ', c.flags.map((f) => f.type + ': ' + f.text).join('\n    ')));
