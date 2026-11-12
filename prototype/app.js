/* app.js: page wiring only. All the logic lives in fines-core.js. */
(function () {
  'use strict';
  const core = window.FinesCore;
  const $ = (id) => document.getElementById(id);
  const loaded = {};
  let result = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n == null ? '<span class="muted">?</span>' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (iso) => (iso ? +iso.slice(8, 10) + ' ' + MON[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4) : '');
  const caseLink = (id) => '<a href="#case-' + esc(id) + '" data-case="' + esc(id) + '">' + esc(id) + '</a>';

  function localToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function deadlineText(iso, daysLeft) {
    if (!iso) return '<span class="muted">not known</span>';
    if (daysLeft < 0) return '<span class="late">' + -daysLeft + ' day' + (daysLeft === -1 ? '' : 's') + ' overdue</span><br><span class="muted">' + fmtDate(iso) + '</span>';
    if (daysLeft === 0) return '<span class="late">today</span>';
    if (daysLeft <= 7) return '<span class="soon">in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '</span><br><span class="muted">' + fmtDate(iso) + '</span>';
    return fmtDate(iso);
  }

  /* ------------------------------------------------------------ loading */

  async function addFiles(fileList) {
    for (const f of Array.from(fileList)) {
      const text = await f.text();
      const rows = core.parseCSV(text);
      const kind = core.detectKind(rows);
      if (!kind) { alert(f.name + ' does not look like any of the five files. Check it is a CSV with its header row.'); continue; }
      if (loaded[kind] && loaded[kind].name !== f.name && !confirm('You already loaded a ' + core.FILE_KINDS[kind].label + ' file (' + loaded[kind].name + '). Replace it with ' + f.name + '?')) continue;
      loaded[kind] = { name: f.name, rows };
    }
    showChips();
    run();
  }

  function showChips() {
    $('chips').innerHTML = Object.keys(core.FILE_KINDS).map((k) => {
      const f = loaded[k];
      return f
        ? '<span class="chip ok">' + esc(core.FILE_KINDS[k].label) + ': ' + esc(f.name) + ' (' + f.rows.length + ' rows)</span>'
        : '<span class="chip miss">' + esc(core.FILE_KINDS[k].label) + ': not loaded</span>';
    }).join('');
  }

  function run() {
    if (!loaded.log || !loaded.portal) {
      $('results').classList.add('hidden');
      return;
    }
    const input = {};
    Object.keys(core.FILE_KINDS).forEach((k) => { input[k] = loaded[k] ? loaded[k].rows : []; });
    try {
      result = core.reconcile(input, $('today').value);
    } catch (e) {
      alert('Something went wrong: ' + e.message);
      return;
    }
    render();
    $('results').classList.remove('hidden');
  }

  /* ---------------------------------------------------------- rendering */

  function render() {
    const s = result.summary;
    const allOk = result.checks.every((c) => c.ok);
    const missing = Object.keys(core.FILE_KINDS).filter((k) => !loaded[k]).map((k) => core.FILE_KINDS[k].label);
    $('banner').innerHTML = (missing.length ? '<div class="banner bad">Not loaded: ' + esc(missing.join(', ')) + '. Results below are incomplete.</div>' : '') +
      (allOk
        ? '<div class="banner ok">Report for ' + fmtDate(result.today) + '. Totals agree with the portal export.</div>'
        : '<div class="banner bad">Report for ' + fmtDate(result.today) + '. Some checks failed (see "How the tool checked itself"). Don\'t send these totals until that is sorted out.</div>');

    $('cards').innerHTML = [
      card('We owe the authorities', money(s.owedTotal + s.appealTotal), (s.owedCount + s.appealCount) + ' fines on the portal' + (s.appealCount ? ', ' + money(s.appealTotal) + ' of it under appeal' : '')),
      card('At final notice', money(s.finalTotal), s.finalCount + ' fine' + (s.finalCount === 1 ? '' : 's') + '. Court summons is the next step', s.finalCount ? 'red' : ''),
      card('Requests to name a driver', String(s.particularsOpen), s.particularsOverdue + ' past the 14-day deadline', s.particularsOverdue ? 'red' : ''),
      card('Late charges in what we owe', money(s.lateCharges), 'extra paid only because letters were not actioned in time', s.lateCharges ? 'amber' : ''),
      card('What the old log said we owed', money(s.oldLogOpenTotal), s.oldLogOpenCount + ' rows marked unpaid or pending'),
    ].join('');

    $('checks').innerHTML = result.checks.map((c) => '<li class="' + (c.ok ? 'ok' : 'bad') + '">' + esc(c.text) + '</li>').join('');
    $('problems').innerHTML = result.problems.length
      ? '<details open><summary>' + result.problems.length + ' value(s) the tool could not read</summary><ul>' +
        result.problems.map((p) => '<li>' + esc(p.file) + ', row ' + p.row + ': ' + esc(p.text) + '</li>').join('') + '</ul></details>'
      : '';

    renderActions();
    renderLetters();
    renderReview();
    renderRecovery();
    renderCases();
  }

  function card(title, big, sub, cls) {
    return '<div class="card ' + (cls || '') + '"><div class="sub">' + esc(title) + '</div><div class="big">' + big + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function renderActions() {
    const rows = result.actions;
    $('actions').innerHTML = '<tr><th>What</th><th>Fine</th><th>Van</th><th>Notice</th><th class="num">Amount</th><th>Deadline</th><th>What to do</th></tr>' +
      (rows.length ? rows.map((a) => '<tr><td><span class="tag p' + a.priority + '">' + esc(a.kind) + '</span></td><td>' + caseLink(a.caseId) + '</td><td>' + esc(a.plate) + '</td><td>' + esc(a.notice) +
        '</td><td class="num">' + (a.amount == null ? '' : money(a.amount)) + '</td><td>' + deadlineText(a.deadline, a.daysLeft) + '</td><td>' + esc(a.text) + '</td></tr>').join('')
        : '<tr><td colspan="7" class="muted">Nothing urgent.</td></tr>');
  }

  const LETTER_OUTCOMES = {
    new: ['New fine', 'Not seen before. Added to the new log.'],
    'escalation-known': ['Reminder for a fine we already have', 'Not a new fine, even though the notice number is new. In the old process these got logged twice.'],
    'escalation-unknown': ['Reminder or final notice for a fine we never logged', 'The first letter never made it into the log. Usually means it went missing.'],
    particulars: ['Request to name the driver', 'Has a deadline of its own. See "Do this first".'],
    'already-logged': ['Already in the log', 'Another copy of a notice that is already logged. Nothing to type in.'],
    duplicate: ['Duplicate copy', 'Same letter scanned twice. Ignored.'],
    'not-fleet': ['Plate is not one of our vans', 'Check the paper letter. See "Needs your decision".'],
  };

  function renderLetters() {
    const counts = result.summary.letterCounts;
    $('letterSummary').innerHTML = '<table><tr><th class="num">Letters</th><th>Turned out to be</th><th>What it means</th></tr>' +
      Object.keys(LETTER_OUTCOMES).filter((k) => counts[k]).map((k) => '<tr><td class="num"><strong>' + counts[k] + '</strong></td><td>' + esc(LETTER_OUTCOMES[k][0]) + '</td><td class="muted">' + esc(LETTER_OUTCOMES[k][1]) + '</td></tr>').join('') +
      '<tr><td class="num"><strong>' + result.letters.length + '</strong></td><td colspan="2"><strong>Total letters loaded</strong></td></tr></table>';
    $('letters').innerHTML = '<tr><th>Letter</th><th>Type</th><th>Notice</th><th>Van</th><th>Offence</th><th>Received</th><th>Turned out to be</th><th>Fine</th></tr>' +
      result.letters.map((l) => '<tr><td>' + esc(l.id) + '</td><td>' + esc(l.raw.letter_type) + '</td><td>' + esc(l.notice) + '</td><td>' + esc(l.plate) + '</td><td>' + esc(fmtDate(l.date) + ' ' + (l.time || '')) +
        '</td><td>' + esc(fmtDate(l.received)) + '</td><td>' + esc(LETTER_OUTCOMES[l.outcome][0]) + (l.duplicateOf ? ' of ' + esc(l.duplicateOf) : '') + (l.matchedBy ? '<br><span class="muted">matched by ' + esc(l.matchedBy) + '</span>' : '') +
        '</td><td>' + caseLink(l.caseId) + '</td></tr>').join('');
  }

  const REVIEW_ORDER = ['paid-but-owed', 'driver', 'duplicate', 'plate', 'not-on-portal', 'review', 'data'];
  const REVIEW_LABEL = {
    'paid-but-owed': 'Paid, but still owing', driver: 'Who was driving?', duplicate: 'Logged twice?', plate: 'Not our van?',
    'not-on-portal': 'Not on the portal', review: 'Check on portal', data: 'Log data looks wrong',
  };

  function renderReview() {
    const items = result.cases
      .map((c) => ({ c, flags: c.flags.filter((f) => f.type !== 'info') }))
      .filter((x) => x.flags.length)
      .map((x) => ({ ...x, rank: Math.min(...x.flags.map((f) => REVIEW_ORDER.indexOf(f.type))) }))
      .sort((a, b) => a.rank - b.rank || a.c.id.localeCompare(b.c.id));
    $('review').innerHTML = '<tr><th>Issue</th><th>Fine</th><th>Van</th><th>When</th><th class="num">Amount</th><th>Details</th></tr>' +
      (items.length ? items.map(({ c, flags, rank }) => '<tr><td><span class="tag ' + (rank <= 1 ? 'p2' : 'p4') + '">' + esc(REVIEW_LABEL[REVIEW_ORDER[rank]]) + '</span></td><td>' + caseLink(c.id) + '</td><td>' + esc(c.plate) +
        '</td><td>' + esc(fmtDate(c.date) + ' ' + (c.time || '')) + '</td><td class="num">' + money(c.current) + '</td><td><ul class="flags">' + flags.map((f) => '<li>' + esc(f.text) + '</li>').join('') + '</ul></td></tr>').join('')
        : '<tr><td colspan="6" class="muted">Nothing to review.</td></tr>');
  }

  function renderRecovery() {
    const r = result.summary.recovery;
    $('recoveryCards').innerHTML = [
      card('Confirmed deducted', money(r.deducted), 'marked Deducted in the log. Ask payroll to confirm.'),
      card('Ready for payroll', money(r.toDeduct), 'we have paid these; driver confirmed by the roster'),
      card('Due once we pay', money(r.afterPay), 'driver confirmed, fine not paid yet'),
      card('Waived', money(r.waived), 'decided not to charge'),
      card('Can\'t charge anyone yet', money(r.toDecide), r.toDecideCount + ' fines where the driver is unclear', r.toDecideCount ? 'amber' : ''),
    ].join('');
    $('drivers').innerHTML = '<tr><th>Driver</th><th class="num">Ready for payroll</th><th class="num">Due once we pay</th><th class="num">Deducted</th><th class="num">Waived</th><th class="num">On hold</th><th>Fines</th></tr>' +
      r.byDriver.map((d) => '<tr><td>' + esc(d.driver) + '</td><td class="num">' + money(d.toDeduct) + '</td><td class="num">' + money(d.afterPay) + '</td><td class="num">' + money(d.deducted) + '</td><td class="num">' + money(d.waived) +
        '</td><td class="num">' + money(d.onHold) + '</td><td>' + d.cases.map(caseLink).join(', ') + '</td></tr>').join('');
  }

  const PAY_LABEL = { owed: 'Owed', appeal: 'Under appeal', paid: 'Paid', 'not-on-portal': 'Not on portal', 'not-fleet': 'Not our van?' };

  function renderCases() {
    $('cases').innerHTML = '<tr><th>Fine</th><th>Notice no(s)</th><th>Van</th><th>When</th><th>Offence</th><th>Stage</th><th class="num">Original</th><th class="num">Now</th><th>Status</th><th>Pay by</th><th>Driver</th><th>Who pays</th><th>Deduction</th><th>Notes</th></tr>' +
      result.cases.map((c) => '<tr id="case-' + esc(c.id) + '" data-search="' + esc([c.id, c.plate, c.notices.join(' '), c.driver, c.candidates.join(' '), c.offence].join(' ').toLowerCase()) + '">' +
        '<td>' + esc(c.id) + '</td><td>' + c.notices.map(esc).join('<br>') + '</td><td>' + esc(c.plate) + (c.spare ? '<br><span class="muted">spare</span>' : '') + '</td>' +
        '<td>' + esc(fmtDate(c.date)) + '<br>' + esc(c.time || '') + (c.date && !c.timeTrusted ? ' <span class="muted">(time unreliable)</span>' : '') + '</td>' +
        '<td>' + esc(c.offence) + '<br><span class="muted">' + esc(c.agency) + '</span></td><td>' + esc(core.STAGE_LABEL[c.stage] || '') + '</td>' +
        '<td class="num">' + money(c.original) + '</td><td class="num">' + money(c.current) + (c.lateCharge > 0 ? '<br><span class="late">+' + money(c.lateCharge) + ' late</span>' : '') + '</td>' +
        '<td>' + esc(PAY_LABEL[c.payment] || c.payment) + (c.portal ? '<br><span class="muted">' + esc(c.portal.status) + '</span>' : '') + '</td><td>' + esc(fmtDate(c.payBy)) + '</td>' +
        '<td>' + (c.driver ? esc(c.driver) + '<br><span class="muted">' + esc(c.driverSource) + '</span>' : c.candidates.length ? '<span class="muted">' + esc(c.candidates.join(' or ')) + '?</span>' : '<span class="muted">unknown</span>') + '</td>' +
        '<td>' + esc(c.liable) + '<br><span class="muted">' + esc(c.liableWhy) + '</span></td><td>' + esc(c.deduction) + '</td>' +
        '<td>' + (c.flags.length ? '<ul class="flags">' + c.flags.map((f) => '<li' + (f.type === 'info' ? ' class="muted"' : '') + '>' + esc(f.text) + '</li>').join('') + '</ul>' : '') + '</td></tr>').join('');
    applyFilter();
  }

  function applyFilter() {
    const q = $('filter').value.trim().toLowerCase();
    document.querySelectorAll('#cases tr[data-search]').forEach((tr) => { tr.style.display = !q || tr.dataset.search.includes(q) ? '' : 'none'; });
  }

  /* --------------------------------------------------------- downloads */

  function download(name, text) {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ------------------------------------------------------------- events */

  $('today').value = localToday();
  $('today').addEventListener('change', run);
  $('filter').addEventListener('input', applyFilter);
  const drop = $('drop');
  drop.addEventListener('click', () => $('picker').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('picker').click(); });
  $('picker').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.target !== drop && !drop.contains(e.target)) addFiles(e.dataTransfer.files); });

  function loadSample() {
    const data = window.SAMPLE_DATA;
    if (!data) { alert('sample-data.js is missing from the folder.'); return; }
    Object.keys(data.files).forEach((k) => { loaded[k] = { name: data.names[k] + ' (sample)', rows: core.parseCSV(data.files[k]) }; });
    $('today').value = data.reportDate;
    showChips();
    run();
  }
  $('sample').addEventListener('click', loadSample);
  if (/[?&#]sample\b/.test(location.search + location.hash)) loadSample();

  document.addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.case;
    if (!id) return;
    e.preventDefault();
    $('filter').value = '';
    applyFilter();
    const tr = document.getElementById('case-' + id);
    if (!tr) return;
    document.querySelectorAll('tr.hl').forEach((x) => x.classList.remove('hl'));
    tr.classList.add('hl');
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('dlRegister').addEventListener('click', () => download('fines-log-' + result.today + '.csv', core.toCSV(core.registerRows(result), core.REGISTER_COLUMNS)));
  $('dlPayroll').addEventListener('click', () => download('payroll-deductions-' + result.today + '.csv', core.toCSV(core.payrollRows(result), core.PAYROLL_COLUMNS)));
  $('dlActions').addEventListener('click', () => download('actions-' + result.today + '.csv', core.toCSV(result.actions, core.ACTION_COLUMNS)));

  showChips();
})();
