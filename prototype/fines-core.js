/*
 * fines-core.js
 *
 * The matching and money logic for the fines check. Nothing in here touches the
 * page, so the same file runs in the browser (index.html) and in the tests
 * (tests/core.test.js).
 *
 * The idea in one line: a fine is one offence (van + date + time + offence),
 * not one letter. Letters, log rows and portal rows all get attached to the
 * offence they belong to, and every number in the report is worked out from
 * that.
 */
(function (global) {
  'use strict';

  // Everything here is a business rule someone may want to change. The uplift
  // values are what the sample data shows (every reminder +$15, every final
  // notice +$30); confirm them with the agencies before relying on them.
  const POLICY = {
    utcOffsetHours: 8,
    reminderUplift: 15,
    finalUplift: 30,
    particularsDays: 14,
    dueSoonDays: 7,
    portalLagDays: 7,
    agencyByNoticePrefix: { H: 'HDB', L: 'LTA', U: 'URA', T: 'TP' },
  };

  /* ---------------------------------------------------------------- CSV */

  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const header = rows.shift().map((h) => h.trim());
    return rows
      .filter((r) => r.some((v) => v.trim() !== ''))
      .map((r, i) => {
        const o = { _row: i + 2 };
        header.forEach((h, j) => { o[h] = (r[j] == null ? '' : r[j]).trim(); });
        return o;
      });
  }

  function toCSV(rows, columns) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [columns.join(',')].concat(rows.map((r) => columns.map((c) => esc(r[c])).join(','))).join('\r\n') + '\r\n';
  }

  // Files are recognised by their columns, not their names, so it doesn't
  // matter what the admin calls them when she saves them.
  const FILE_KINDS = {
    letters: { label: 'Fine letters', needs: ['letter_type', 'notice_no', 'vehicle_no', 'offence_date', 'offence_time', 'amount', 'received_on'] },
    log: { label: 'Fines log', needs: ['log_id', 'notice_no', 'vehicle_no', 'offence_at', 'amount', 'status'] },
    portal: { label: 'Portal export', needs: ['notice_no', 'vehicle_no', 'offence_date', 'amount_payable', 'status'] },
    vehicles: { label: 'Vehicles', needs: ['vehicle_no', 'status'] },
    roster: { label: 'Driver roster', needs: ['date', 'vehicle_no', 'shift_start', 'shift_end', 'driver'] },
  };

  function detectKind(rows) {
    if (!rows.length) return null;
    const cols = Object.keys(rows[0]);
    const order = ['letters', 'log', 'portal', 'roster', 'vehicles'];
    return order.find((k) => FILE_KINDS[k].needs.every((c) => cols.includes(c))) || null;
  }

  /* -------------------------------------------------------- normalising */

  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function ymd(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }
  const dayNum = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
  const addDays = (iso, n) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
  const isSunday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay() === 0;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const human = (iso) => (iso ? +iso.slice(8, 10) + ' ' + MON[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4) : '?');

  // Accepts 2026-09-09, 09/09/2026 and 9 Sep 2026. Slashed dates are read as
  // day/month, which is how Singapore writes them.
  function parseDate(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return ymd(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})$/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    return null;
  }

  // Accepts 8.44am, 5.27pm, 08:25, 0918, 1303.
  function parseTime(s) {
    s = String(s || '').trim().toLowerCase().replace(/\s+/g, '');
    const ok = (h, mi) => (h <= 23 && mi <= 59 ? pad(h) + ':' + pad(mi) : null);
    let m = s.match(/^(\d{1,2})(?:[.:](\d{2}))?(am|pm)$/);
    if (m) {
      const h = +m[1];
      if (h < 1 || h > 12) return null;
      return ok((h % 12) + (m[3] === 'pm' ? 12 : 0), +(m[2] || 0));
    }
    m = s.match(/^(\d{1,2})[:.]?(\d{2})$/);
    return m ? ok(+m[1], +m[2]) : null;
  }

  function parseAmount(s) {
    const t = String(s || '').replace(/S\$|\$|,|\s/gi, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  // The log stores offence_at like 2026-08-27T04:52Z, which is UTC. Converting
  // to Singapore time matters: 22:40Z on 7 Sep is 06:40 on 8 Sep, a different
  // roster day. A timestamp with no zone is taken as already local.
  function parseLogTimestamp(s) {
    s = String(s || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!m) return null;
    if (m[4] == null) return { date: ymd(+m[1], +m[2], +m[3]), time: null };
    let zoneMin = POLICY.utcOffsetHours * 60;
    if (m[6] && m[6].toUpperCase() === 'Z') zoneMin = 0;
    else if (m[6]) {
      const z = m[6].replace(':', '');
      zoneMin = (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3, 5));
    }
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - zoneMin * 60000;
    const local = new Date(utc + POLICY.utcOffsetHours * 3600000).toISOString();
    return { date: local.slice(0, 10), time: local.slice(11, 16) };
  }

  function toUtcStamp(date, time) {
    if (!date) return '';
    if (!time) return date;
    const [h, mi] = time.split(':').map(Number);
    const utc = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, mi) - POLICY.utcOffsetHours * 3600000);
    return utc.toISOString().slice(0, 16) + 'Z';
  }

  const normPlate = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normText = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const sameOffence = (a, b) => !a || !b || normText(a) === normText(b);
  const sameName = (a, b) => normText(a) === normText(b);
  const digits = (s) => String(s || '').replace(/\D/g, '');

  function letterStage(type) {
    const t = normText(type);
    if (t.includes('particular')) return 'particulars';
    if (t.includes('final')) return 'final';
    if (t.includes('remind')) return 'reminder';
    return 'notice';
  }
  const STAGE_RANK = { notice: 1, reminder: 2, final: 3 };
  const STAGE_LABEL = { notice: 'Notice', reminder: 'Reminder', final: 'Final notice' };

  function agencyFrom(notice, note) {
    const fromNote = String(note || '').match(/^\s*(HDB|LTA|URA|TP)\b/i);
    if (fromNote) return fromNote[1].toUpperCase();
    const p = String(notice || '').trim().charAt(0).toUpperCase();
    return POLICY.agencyByNoticePrefix[p] || '';
  }

  // The status column in the old log mixes two things: whether the authority
  // was paid, and whether the driver should be charged. Split them apart.
  function parseLogStatus(status) {
    const s = normText(status);
    if (/^\d{6,}$/.test(s)) return { payment: 'paid', liability: null, odd: 'Status column holds a number (' + status + '), probably a payment reference. Treated as paid.' };
    if (s.includes('appeal')) return { payment: 'appealed', liability: null };
    if (/unpaid|pending payment|not paid/.test(s)) return { payment: 'unpaid', liability: null };
    if (s.includes('paid')) {
      const liability = /deduct/.test(s) ? 'Driver' : /absorb/.test(s) ? 'Company' : null;
      return { payment: 'paid', liability };
    }
    return { payment: 'unknown', liability: null, odd: 'Status "' + status + '" not recognised.' };
  }

  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  /* ------------------------------------------------------------- roster */

  function buildRoster(rows, problems) {
    const map = new Map();
    for (const r of rows) {
      const date = parseDate(r.date);
      const start = parseTime(r.shift_start);
      const end = parseTime(r.shift_end);
      if (!date || !start || !end) {
        problems.push({ file: 'Driver roster', row: r._row, text: 'Could not read date or shift times: ' + [r.date, r.shift_start, r.shift_end].join(' ') });
        continue;
      }
      const key = normPlate(r.vehicle_no) + '|' + date;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ start, end, driver: r.driver.trim() });
      if (!map.first || date < map.first) map.first = date;
      if (!map.last || date > map.last) map.last = date;
    }
    return map;
  }

  const isWorkshop = (name) => /workshop|servic|repair/i.test(name);
  const uniq = (xs) => Array.from(new Set(xs.filter(Boolean)));

  function rosterLookup(roster, plate, date, time) {
    const rows = roster.get(plate + '|' + date) || [];
    const shifts = rows.map((r) => r.driver + ' ' + r.start + '-' + r.end).join(', ');
    if (!rows.length) {
      if (!roster.first || date < roster.first || date > roster.last) {
        return { kind: 'none', candidates: [], text: 'The roster file does not cover ' + human(date) + (roster.first ? ' (it runs ' + human(roster.first) + ' to ' + human(roster.last) + '). Load a newer roster' : '') };
      }
      return { kind: 'none', candidates: [], text: isSunday(date) ? 'Sunday, and there is no roster on Sundays' : 'Van is not on the roster that day' };
    }
    if (rows.every((r) => isWorkshop(r.driver))) return { kind: 'workshop', candidates: [], text: 'Van was in the workshop that day' };
    const people = uniq(rows.filter((r) => !isWorkshop(r.driver)).map((r) => r.driver));
    if (!time) return { kind: 'no-time', candidates: people, text: 'No reliable offence time, so the shift cannot be checked (' + shifts + ')' };
    const hits = rows.filter((r) => r.start <= time && time <= r.end);
    if (hits.length === 1) {
      if (isWorkshop(hits[0].driver)) return { kind: 'workshop', candidates: [], text: 'Van was in the workshop at that time' };
      return { kind: 'single', driver: hits[0].driver, candidates: [hits[0].driver], text: 'Roster: ' + hits[0].driver + ' ' + hits[0].start + '-' + hits[0].end };
    }
    if (hits.length > 1) return { kind: 'overlap', candidates: uniq(hits.map((h) => h.driver)), text: 'Shift handover: ' + time + ' falls inside two shifts (' + shifts + ')' };
    return { kind: 'outside', candidates: people, text: time + ' is outside rostered hours (' + shifts + '). Did the driver take the van home?' };
  }

  /* --------------------------------------------------------- reconcile */

  function reconcile(input, today) {
    if (!parseDate(today)) throw new Error('Report date is missing or not a date: ' + today);
    const problems = [];
    const letters = input.letters || [];
    const log = input.log || [];
    const portal = input.portal || [];
    const vehicles = input.vehicles || [];
    const fleet = new Map(vehicles.map((v) => [normPlate(v.vehicle_no), v]));
    const roster = buildRoster(input.roster || [], problems);

    const cases = [];
    const byNotice = new Map();
    let nextNum = log.reduce((mx, r) => Math.max(mx, +(digits(r.log_id) || 0)), 0) + 1;
    const prefix = (log.find((r) => r.log_id) || { log_id: 'F-' }).log_id.replace(/\d+$/, '') || 'F-';

    function newCase(source) {
      const c = {
        id: '', source, plate: '', agency: '', offence: '', date: null, time: null, timeTrusted: false,
        notices: [], letters: [], log: null, logStatus: null, portal: null, flags: [],
      };
      cases.push(c);
      return c;
    }
    function addNotice(c, n) {
      n = String(n || '').trim().toUpperCase();
      if (!n || c.notices.includes(n)) return;
      c.notices.push(n);
      if (!byNotice.has(n)) byNotice.set(n, c);
    }
    const flag = (c, type, text) => {
    text = text.replace(/([?!])\./g, '$1').replace(/\.\./g, '.');
    if (!c.flags.some((f) => f.text === text)) c.flags.push({ type, text });
  };

    // 1. The log: every existing row is one fine.
    for (const row of log) {
      const c = newCase('log');
      c.id = row.log_id || prefix + nextNum++;
      c.log = row;
      c.logStatus = parseLogStatus(row.status);
      if (c.logStatus.odd) flag(c, 'data', c.logStatus.odd);
      c.plate = normPlate(row.vehicle_no);
      c.offence = row.offence;
      c.agency = (row.agency || agencyFrom(row.notice_no, row.note)).toUpperCase();
      const ts = parseLogTimestamp(row.offence_at);
      if (!ts) problems.push({ file: 'Fines log', row: row._row, text: c.id + ': cannot read offence_at "' + row.offence_at + '"' });
      c.date = ts ? ts.date : null;
      c.time = ts ? ts.time : null;
      // When offence_at is the same minute as logged_at, the form most likely
      // filled in "now". Keep the value but don't use it to pick a driver.
      // A saved new log carries an explicit time_reliable column, because Excel
      // tends to rewrite logged_at when the file is re-saved.
      const saved = normText(row.time_reliable);
      const same = saved ? saved === 'no' : digits(row.offence_at).slice(0, 12) === digits(row.logged_at).slice(0, 12) && digits(row.logged_at).length >= 12;
      c.timeTrusted = !!(ts && ts.time) && !same;
      if (same) flag(c, 'data', 'Offence time is identical to the time it was logged, so it was probably never filled in. Not used to pick a driver.');
      if (row.notice_no && byNotice.has(row.notice_no.toUpperCase())) {
        const other = byNotice.get(row.notice_no.toUpperCase());
        flag(c, 'duplicate', 'Same notice number as ' + other.id + '. Logged twice?');
        flag(other, 'duplicate', 'Same notice number as ' + c.id + '. Logged twice?');
      }
      addNotice(c, row.notice_no);
      String(row.all_notice_nos || '').split(/[;|]/).forEach((n) => addNotice(c, n));
    }

    // 2. Letters, oldest first, so the first copy of anything is the original.
    const letterRows = letters.slice().sort((a, b) => (parseDate(a.received_on) || '').localeCompare(parseDate(b.received_on) || '') || a._row - b._row);
    const letterInfo = [];
    for (const L of letterRows) {
      const info = {
        id: L.letter_id || 'row ' + L._row,
        stage: letterStage(L.letter_type),
        notice: String(L.notice_no || '').trim().toUpperCase(),
        plate: normPlate(L.vehicle_no),
        date: parseDate(L.offence_date),
        time: parseTime(L.offence_time),
        offence: L.offence,
        agency: (L.agency || agencyFrom(L.notice_no)).toUpperCase(),
        amount: parseAmount(L.amount),
        payBy: parseDate(L.pay_by),
        received: parseDate(L.received_on),
        raw: L,
      };
      if (!info.date) problems.push({ file: 'Fine letters', row: L._row, text: info.id + ': cannot read offence date "' + L.offence_date + '"' });
      if (!info.time && L.offence_time) problems.push({ file: 'Fine letters', row: L._row, text: info.id + ': cannot read offence time "' + L.offence_time + '"' });
      if (L.amount && info.amount == null) problems.push({ file: 'Fine letters', row: L._row, text: info.id + ': cannot read amount "' + L.amount + '"' });
      const base = info.stage === 'particulars' ? info.notice.replace(/-R$/, '') : info.notice;

      let c = byNotice.get(info.notice) || byNotice.get(base) || null;
      info.matchedBy = c ? 'notice number' : '';
      if (!c) {
        c = matchByDetails(cases, info);
        if (c) info.matchedBy = 'van, date and time';
      }
      const isNewCase = !c;
      if (!c) {
        c = newCase('letter');
        c.id = prefix + nextNum++;
        c.plate = info.plate;
        c.agency = info.agency;
        c.offence = info.offence;
      }
      const knownBefore = !isNewCase && (c.log || c.letters.some((x) => x.stage !== 'particulars'));
      const dupe = c.letters.find((x) => x.notice === info.notice && x.stage === info.stage);
      info.caseId = c.id;
      if (dupe) info.outcome = 'duplicate';
      else if (!fleet.has(info.plate) && fleet.size) info.outcome = 'not-fleet';
      else if (info.stage === 'particulars') info.outcome = 'particulars';
      else if (info.stage === 'notice') info.outcome = c.log ? 'already-logged' : knownBefore ? 'duplicate' : 'new';
      else info.outcome = knownBefore ? 'escalation-known' : 'escalation-unknown';
      info.duplicateOf = dupe ? dupe.id : '';
      letterInfo.push(info);
      if (dupe) continue;

      c.letters.push(info);
      addNotice(c, info.notice);
      addNotice(c, base);
      if (!c.offence) c.offence = info.offence;
      if (!c.agency) c.agency = info.agency;
      // The paper wins over the log. Note the difference so it can be fixed.
      if (info.date) {
        if (c.date && c.date !== info.date && c.log) flag(c, 'data', 'Log had offence date ' + human(c.date) + ', letter ' + info.id + ' says ' + human(info.date) + '. Using the letter.');
        c.date = info.date;
      }
      if (info.time) {
        if (c.time && c.time !== info.time && c.log && c.timeTrusted) flag(c, 'data', 'Log had offence time ' + c.time + ', letter ' + info.id + ' says ' + info.time + '. Using the letter.');
        if (!c.timeTrusted) c.flags = c.flags.filter((f) => !f.text.startsWith('Offence time is identical'));
        c.time = info.time;
        c.timeTrusted = true;
      }
    }

    // 3. Portal: the authorities' own list of what is unpaid today.
    const portalSeen = new Set();
    for (const p of portal) {
      const notice = String(p.notice_no || '').trim().toUpperCase();
      const row = {
        notice, plate: normPlate(p.vehicle_no), date: parseDate(p.offence_date),
        agency: String(p.agency || agencyFrom(notice)).toUpperCase(), amount: parseAmount(p.amount_payable), status: p.status, raw: p,
      };
      if (row.amount == null) problems.push({ file: 'Portal export', row: p._row, text: notice + ': cannot read amount "' + p.amount_payable + '"' });
      if (portalSeen.has(notice)) { problems.push({ file: 'Portal export', row: p._row, text: notice + ' appears twice in the portal export. Second copy ignored.' }); continue; }
      portalSeen.add(notice);

      let c = byNotice.get(notice) || null;
      if (c && c.portal) c = null;
      if (!c) {
        const near = cases.filter((x) => !x.portal && x.plate === row.plate && x.date === row.date && (!x.agency || x.agency === row.agency));
        const fits = near.filter((x) => amountFits(x, row.amount));
        if (near.length === 1) c = near[0];
        else if (fits.length === 1) c = fits[0];
        else if (near.length > 1) {
          const nc = newCase('portal');
          nc.id = prefix + nextNum++;
          flag(nc, 'review', 'Could belong to ' + near.map((x) => x.id).join(' or ') + ' (same van, date and agency). Check the notice on the portal.');
          c = nc;
        }
        if (c && c.portal == null && c.source !== 'portal' && c.notices.length && !c.notices.includes(notice)) {
          flag(c, 'info', 'Portal lists this fine as ' + notice + '. Our letters/log used ' + c.notices.join(', ') + '.');
        }
      }
      if (!c) {
        c = newCase('portal');
        c.id = prefix + nextNum++;
      }
      if (!c.plate) c.plate = row.plate;
      if (!c.agency) c.agency = row.agency;
      if (!c.date) c.date = row.date;
      c.portal = row;
      c.mainNotice = notice;
      addNotice(c, notice);
    }

    // 4. Work out the facts for each fine.
    for (const c of cases) derive(c, { fleet, roster, today, flag });
    findLoggedTwice(cases, flag);

    const actions = buildActions(cases, today);
    const summary = buildSummary(cases, portal, log, letterInfo, actions, today);
    const checks = buildChecks(cases, portal, log, letterInfo, problems);
    cases.sort((a, b) => (+digits(a.id) || 0) - (+digits(b.id) || 0));
    return { today, cases, letters: letterInfo, actions, summary, checks, problems, policy: POLICY };
  }

  function matchByDetails(cases, f) {
    if (!f.plate || !f.date) return null;
    const near = (c) => c.plate === f.plate && c.date === f.date && (!f.agency || !c.agency || c.agency === f.agency) && sameOffence(c.offence, f.offence);
    let hits = f.time ? cases.filter((c) => near(c) && c.time === f.time) : [];
    if (hits.length === 1) return hits[0];
    hits = cases.filter((c) => near(c) && (!c.timeTrusted || !f.time));
    return hits.length === 1 ? hits[0] : null;
  }

  function originalEstimates(c) {
    const est = [];
    for (const l of c.letters) {
      if (l.amount == null) continue;
      if (l.stage === 'notice') est.push({ from: l.id, value: l.amount });
      if (l.stage === 'reminder') est.push({ from: l.id + ' (reminder, less $' + POLICY.reminderUplift + ')', value: l.amount - POLICY.reminderUplift });
      if (l.stage === 'final') est.push({ from: l.id + ' (final notice, less $' + POLICY.finalUplift + ')', value: l.amount - POLICY.finalUplift });
    }
    const logAmt = c.log ? parseAmount(c.log.original_amount || c.log.amount) : null;
    if (logAmt != null) est.push({ from: 'log', value: logAmt });
    if (c.portal && /final/i.test(c.portal.status) && c.portal.amount != null) est.push({ from: 'portal (final notice, less $' + POLICY.finalUplift + ')', value: c.portal.amount - POLICY.finalUplift });
    return est;
  }

  function amountFits(c, amount) {
    if (amount == null) return true;
    const est = originalEstimates(c);
    if (!est.length) return true;
    return [0, POLICY.reminderUplift, POLICY.finalUplift].includes(amount - est[0].value);
  }

  function derive(c, ctx) {
    const { fleet, roster, today, flag } = ctx;
    const vehicle = fleet.get(c.plate);
    c.inFleet = !fleet.size || !!vehicle;
    c.spare = !!(vehicle && /spare/i.test(vehicle.status));
    if (!c.inFleet) {
      const near = Array.from(fleet.keys()).filter((p) => editDistance(p, c.plate) === 1);
      flag(c, 'plate', c.plate + ' is not one of our vans.' + (near.length ? ' Closest match: ' + near.join(', ') + '. Check the paper letter before changing it.' : ' Possibly not ours; check the paper letter.'));
    }
    if (!c.mainNotice) {
      const firstNotice = c.letters.find((l) => l.stage === 'notice');
      c.mainNotice = (c.log && c.log.notice_no) || (firstNotice && firstNotice.notice) || c.notices[0] || '';
    }

    // Stage and amounts
    let rank = 0;
    for (const l of c.letters) rank = Math.max(rank, STAGE_RANK[l.stage] || 0);
    if (c.portal && /final/i.test(c.portal.status)) rank = 3;
    if (!rank && c.log && c.log.stage) rank = STAGE_RANK[normText(c.log.stage).replace(' notice', '')] || 0;
    c.stage = ['', 'notice', 'reminder', 'final'][rank] || (c.log || c.portal ? 'notice' : '');

    const est = originalEstimates(c);
    c.original = est.length ? est[0].value : null;
    const distinct = uniq(est.map((e) => String(e.value)));
    if (distinct.length > 1) flag(c, 'data', 'Amounts do not line up: ' + est.map((e) => e.from + ' $' + e.value).join(', ') + '. Using $' + c.original + '.');
    if (c.portal) c.current = c.portal.amount;
    else {
      const latest = c.letters.filter((l) => l.amount != null).sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage])[0];
      c.current = latest ? latest.amount : c.original;
    }
    if (c.original == null && c.portal) flag(c, 'info', 'Original amount unknown (no letter or log entry). The portal amount may already include late charges.');
    c.lateCharge = c.original != null && c.current != null ? c.current - c.original : null;
    if (c.lateCharge != null && ![0, POLICY.reminderUplift, POLICY.finalUplift].includes(c.lateCharge)) {
      flag(c, 'data', 'Current amount $' + c.current + ' vs original $' + c.original + ' is not a normal reminder increase. Check the notice.');
    }

    // Deadline
    const withPayBy = c.letters.filter((l) => l.stage !== 'particulars' && l.payBy).sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || (b.received || '').localeCompare(a.received || ''));
    const noteDate = c.log && String(c.log.note || '').match(/pay by ([0-9A-Za-z /-]+?\d{4})/i);
    c.payBy = withPayBy.length ? withPayBy[0].payBy : (c.log && parseDate(c.log.pay_by)) || (noteDate ? parseDate(noteDate[1]) : null);
    const recs = c.letters.map((l) => l.received).filter(Boolean).sort();
    c.received = recs[0] || null;

    // Payment: the portal decides. If the portal lists it, we owe it.
    const logPay = c.logStatus ? c.logStatus.payment : null;
    if (c.portal) {
      c.payment = /appeal/i.test(c.portal.status) ? 'appeal' : 'owed';
      if (logPay === 'paid') {
        flag(c, 'paid-but-owed', 'Log says paid' + (c.log.note ? ' ("' + c.log.note + '")' : '') + ', but the portal still lists $' + c.portal.amount + ' as ' + c.portal.status + '. The payment probably did not go through.');
      }
    } else if (logPay === 'paid') {
      c.payment = 'paid';
    } else if (!c.inFleet) {
      c.payment = 'not-fleet';
    } else {
      c.payment = 'not-on-portal';
      const recent = c.received && dayNum(today) - dayNum(c.received) <= POLICY.portalLagDays;
      if (logPay === 'appealed') flag(c, 'not-on-portal', 'Appeal is no longer on the portal. Check the outcome and record it.');
      else if (c.log) flag(c, 'not-on-portal', 'Log says unpaid, but the portal does not list it. It was probably paid or cancelled. Check the portal, then mark it Paid.');
      else if (c.letters.some((l) => l.stage !== 'particulars')) {
        flag(c, 'not-on-portal', recent
          ? 'Letter arrived recently. The portal may not show it yet. Check again next week.'
          : 'We have the letter but the portal does not list it. Someone may already have paid it (a driver?). Check before paying.');
      }
    }

    // Driver: only named when exactly one roster shift covers a trusted time.
    const logDriver = c.log ? String(c.log.driver || '').trim() : '';
    const adminSet = c.log && /admin/i.test(c.log.driver_source || '');
    const r = c.inFleet && c.date ? rosterLookup(roster, c.plate, c.date, c.timeTrusted ? c.time : null) : null;
    c.roster = r;
    c.driver = '';
    c.driverSource = '';
    c.candidates = [];
    if (adminSet && logDriver) {
      c.driver = logDriver;
      c.driverSource = 'Admin';
      c.driverWhy = 'Set by admin' + (r ? '. ' + r.text : '');
    } else if (r && r.kind === 'single') {
      if (logDriver && !sameName(logDriver, r.driver)) {
        c.candidates = uniq([r.driver, logDriver]);
        c.driverWhy = 'Log says ' + logDriver + ', roster says ' + r.driver;
        flag(c, 'driver', 'Log names ' + logDriver + ', but the roster has ' + r.driver + ' on ' + c.plate + ' at ' + c.time + ' on ' + human(c.date) + '. Confirm before anyone is charged.');
      } else {
        c.driver = r.driver;
        c.driverSource = 'Roster';
        c.driverWhy = r.text;
      }
    } else if (r) {
      c.candidates = uniq(r.candidates.concat(logDriver ? [logDriver] : []));
      c.driverWhy = r.text + (c.spare ? ' (spare van, no fixed driver)' : '');
      if (r.kind !== 'workshop') flag(c, 'driver', 'Driver unknown: ' + c.driverWhy + '.' + (c.candidates.length ? ' Possible: ' + c.candidates.join(', ') + '.' : ''));
      if (r.kind === 'workshop' && logDriver) flag(c, 'driver', 'Log names ' + logDriver + ', but the van was in the workshop that day.');
    }

    // Who pays. Late charges are always the company's: they come from our
    // own delay, not from the driving.
    const explicit = c.log && /^(driver|company)$/i.test(c.log.liable || '') ? c.log.liable[0].toUpperCase() + c.log.liable.slice(1).toLowerCase() : null;
    const fromStatus = c.logStatus ? c.logStatus.liability : null;
    if (/furnish|particulars/i.test(c.offence)) { c.liable = 'Company'; c.liableWhy = 'Penalty for not naming the driver in time'; }
    else if (explicit) { c.liable = explicit; c.liableWhy = 'Set in log'; }
    else if (fromStatus) { c.liable = fromStatus; c.liableWhy = 'From old log status'; }
    else if (r && r.kind === 'workshop') {
      c.liable = 'Company';
      c.liableWhy = 'Van in workshop';
      flag(c, 'info', 'Van was in the workshop when this happened. Company pays, or claim it back from the workshop.');
    }
    else if (c.driver) { c.liable = 'Driver'; c.liableWhy = 'Driver on shift pays the original fine'; }
    else { c.liable = 'To decide'; c.liableWhy = 'Driver not known'; }

    if (c.liable === 'Driver' && !c.driver) {
      flag(c, 'driver', 'Marked "deduct from driver", but no driver can be confirmed. Nobody should be charged until this is settled.');
      c.liable = 'To decide';
      c.liableWhy = 'Deduct was intended, driver not confirmed';
    }
    if (c.liable === 'Driver' && r && r.kind === 'workshop') flag(c, 'driver', 'Marked to deduct from a driver, but the van was in the workshop.');

    const ded = normText(c.log ? c.log.deduction_status : '');
    c.deduction = '';
    if (c.liable === 'Driver') {
      if (ded.includes('deducted')) c.deduction = 'Deducted';
      else if (ded.includes('waiv')) c.deduction = 'Waived';
      else if (ded.includes('sent')) c.deduction = 'Sent to payroll';
      else if (ded.includes('disput')) c.deduction = 'Disputed';
      else if (c.payment === 'appeal') c.deduction = 'On hold (appeal)';
      else if (c.payment === 'not-on-portal') c.deduction = 'On hold (check payment)';
      // Only recover money the company has actually paid out. A fine that is
      // still owed could yet be appealed, cancelled or found to be someone else's.
      else if (c.payment === 'owed') c.deduction = 'After we pay';
      else c.deduction = 'To deduct';
    } else if (ded.includes('deducted')) {
      c.deduction = 'Deducted';
      flag(c, 'driver', 'Money was deducted from a driver, but this fine is ' + (c.liable === 'Company' ? 'marked as company-paid' : 'not confirmed against a driver') + '. Check whether it should be refunded.');
    } else if (c.liable === 'Company' && ded.includes('pending')) {
      flag(c, 'data', 'Marked "company absorb" but the deduction column says Pending. Treated as company-paid.');
    }
    c.particularsDone = c.log ? String(c.log.driver_named_on || '').trim() : '';
  }

  // A reminder that was typed in as a brand-new fine: same van, same offence,
  // amount is an older fine plus a reminder/final increase, and the logged
  // offence time can't be trusted. Flag it; never merge it silently.
  function findLoggedTwice(cases, flag) {
    for (const c of cases) {
      if (!c.log || c.timeTrusted || c.letters.length || c.portal || c.original == null) continue;
      let best = null;
      for (const o of cases) {
        if (o === c || o.plate !== c.plate || !sameOffence(o.offence, c.offence) || o.agency !== c.agency) continue;
        const diff = o.original == null ? null : c.original - o.original;
        if ((diff === POLICY.reminderUplift || diff === POLICY.finalUplift) && (o.date || '') <= (c.date || '')) {
          if (!best || (o.date || '') > (best.o.date || '')) best = { o, diff };
        }
      }
      if (best) {
        const { o, diff } = best;
        flag(c, 'duplicate', 'Probably the ' + (diff === POLICY.reminderUplift ? 'reminder' : 'final notice') + ' for ' + o.id + ' ($' + o.original + ' + $' + diff + ') typed in as a new fine. Check, and delete this row if so.');
        c.possibleDuplicateOf = o.id;
      }
    }
    const seen = new Map();
    for (const c of cases) {
      if (!c.timeTrusted || !c.date) continue;
      const k = [c.plate, c.date, c.time, normText(c.offence)].join('|');
      if (seen.has(k)) {
        flag(c, 'duplicate', 'Same van, date, time and offence as ' + seen.get(k).id + '. Probably the same fine twice.');
        flag(seen.get(k), 'duplicate', 'Same van, date, time and offence as ' + c.id + '. Probably the same fine twice.');
      } else seen.set(k, c);
    }
  }

  /* ----------------------------------------------------------- outputs */

  function buildActions(cases, today) {
    const out = [];
    const t = dayNum(today);
    for (const c of cases) {
      for (const l of c.letters.filter((x) => x.stage === 'particulars')) {
        if (c.particularsDone) continue;
        const byLaw = l.received ? addDays(l.received, POLICY.particularsDays) : null;
        const deadline = [byLaw, l.payBy].filter(Boolean).sort()[0] || null;
        const who = c.driver
          ? 'Name ' + c.driver + ' on the portal (' + c.driverWhy + ').'
          : 'Find out who had ' + c.plate + ' on ' + human(c.date) + ' at ' + (c.time || '?') + '. ' + (c.driverWhy || '') + '.' + (c.candidates.length ? ' Possible: ' + c.candidates.join(', ') + '.' : '');
        const text = (who + ' Not replying is a separate offence.').replace(/([?!])\./g, '$1').replace(/\.\./g, '.');
        out.push({ priority: 1, kind: 'Name the driver', deadline, caseId: c.id, notice: l.notice, plate: c.plate, amount: null, text });
      }
      if (c.payment === 'owed' && c.stage === 'final') {
        out.push({ priority: 2, kind: 'Final notice: court summons next', deadline: c.payBy, caseId: c.id, notice: c.mainNotice, plate: c.plate, amount: c.current,
          text: c.letters.length
            ? (c.payBy && dayNum(c.payBy) < t
              ? 'Pay $' + c.current + ' today. The final notice date (' + human(c.payBy) + ') has passed, so a summons may already be on its way. Ring the agency if it does not clear on the portal.'
              : 'Pay $' + c.current + ' by ' + (c.payBy ? human(c.payBy) : 'the date on the letter') + '.')
            : c.log
              ? 'Pay $' + c.current + '. Logged on ' + (parseDate(String(c.log.logged_at).split(/[ T]/)[0]) ? human(parseDate(String(c.log.logged_at).split(/[ T]/)[0])) : c.log.logged_at) + ' but never paid, and the final notice letter has not reached us. Print it from the portal.'
              : 'Pay $' + c.current + '. We never received any letter for this one. Print it from the portal.' });
        continue;
      }
      if (c.flags.some((f) => f.type === 'paid-but-owed')) {
        out.push({ priority: 3, kind: 'Log says paid, portal says owing', deadline: c.payBy, caseId: c.id, notice: c.mainNotice, plate: c.plate, amount: c.current, text: 'Find the receipt. If there is none, pay $' + c.current + ' again and hold any driver deduction.' });
        continue;
      }
      if (c.payment !== 'owed') continue;
      if (!c.payBy) {
        out.push({ priority: 4, kind: 'No letter on file', deadline: null, caseId: c.id, notice: c.mainNotice, plate: c.plate, amount: c.current, text: 'On the portal but we have no letter. Check the due date on the portal and pay $' + c.current + '.' });
      } else if (dayNum(c.payBy) < t) {
        out.push({ priority: 4, kind: 'Overdue', deadline: c.payBy, caseId: c.id, notice: c.mainNotice, plate: c.plate, amount: c.current, text: 'Pay $' + c.current + ' now. The next letter adds $' + (c.stage === 'notice' ? POLICY.reminderUplift : POLICY.finalUplift - POLICY.reminderUplift) + '.' });
      } else if (dayNum(c.payBy) - t <= POLICY.dueSoonDays) {
        out.push({ priority: 5, kind: 'Due this week', deadline: c.payBy, caseId: c.id, notice: c.mainNotice, plate: c.plate, amount: c.current, text: 'Pay $' + c.current + ' by ' + human(c.payBy) + '.' });
      }
    }
    out.forEach((a) => { a.daysLeft = a.deadline ? dayNum(a.deadline) - t : null; });
    out.sort((a, b) => a.priority - b.priority || (a.deadline || '0000').localeCompare(b.deadline || '0000'));
    return out;
  }

  const sum = (xs) => Math.round(xs.reduce((s, x) => s + (x || 0), 0) * 100) / 100;

  function buildSummary(cases, portal, log, letters, actions, today) {
    const owed = cases.filter((c) => c.payment === 'owed');
    const appeal = cases.filter((c) => c.payment === 'appeal');
    const final = owed.filter((c) => c.stage === 'final');
    const oldLogOpen = log.filter((r) => parseLogStatus(r.status).payment === 'unpaid');
    const driverCases = cases.filter((c) => c.liable === 'Driver');
    const byDriver = {};
    for (const c of driverCases) {
      const d = (byDriver[c.driver] = byDriver[c.driver] || { driver: c.driver, toDeduct: 0, afterPay: 0, deducted: 0, waived: 0, onHold: 0, cases: [] });
      const amt = c.original || 0;
      if (c.deduction === 'Deducted') d.deducted += amt;
      else if (c.deduction === 'Waived') d.waived += amt;
      else if (c.deduction === 'To deduct' || c.deduction === 'Sent to payroll') d.toDeduct += amt;
      else if (c.deduction === 'After we pay') d.afterPay += amt;
      else d.onHold += amt;
      d.cases.push(c.id);
    }
    const letterCounts = {};
    letters.forEach((l) => { letterCounts[l.outcome] = (letterCounts[l.outcome] || 0) + 1; });
    const particulars = actions.filter((a) => a.kind === 'Name the driver');
    return {
      today,
      owedTotal: sum(owed.map((c) => c.current)),
      owedCount: owed.length,
      appealTotal: sum(appeal.map((c) => c.current)),
      appealCount: appeal.length,
      finalTotal: sum(final.map((c) => c.current)),
      finalCount: final.length,
      lateCharges: sum(owed.map((c) => (c.lateCharge > 0 ? c.lateCharge : 0))),
      portalTotal: sum(portal.map((p) => parseAmount(p.amount_payable))),
      portalCount: portal.length,
      oldLogOpenTotal: sum(oldLogOpen.map((r) => parseAmount(r.amount))),
      oldLogOpenCount: oldLogOpen.length,
      particularsOpen: particulars.length,
      particularsOverdue: particulars.filter((a) => a.daysLeft != null && a.daysLeft < 0).length,
      overdueCount: actions.filter((a) => a.daysLeft != null && a.daysLeft < 0 && a.amount != null).length,
      recovery: {
        deducted: sum(driverCases.filter((c) => c.deduction === 'Deducted').map((c) => c.original)),
        toDeduct: sum(driverCases.filter((c) => c.deduction === 'To deduct' || c.deduction === 'Sent to payroll').map((c) => c.original)),
        afterPay: sum(driverCases.filter((c) => c.deduction === 'After we pay').map((c) => c.original)),
        waived: sum(driverCases.filter((c) => c.deduction === 'Waived').map((c) => c.original)),
        onHold: sum(driverCases.filter((c) => /hold|disput/i.test(c.deduction)).map((c) => c.original)),
        toDecide: sum(cases.filter((c) => c.liable === 'To decide' && c.payment !== 'not-fleet').map((c) => c.original)),
        toDecideCount: cases.filter((c) => c.liable === 'To decide' && c.payment !== 'not-fleet').length,
        companyLate: sum(cases.filter((c) => c.payment === 'owed' || c.payment === 'paid').map((c) => (c.lateCharge > 0 ? c.lateCharge : 0))),
        byDriver: Object.values(byDriver).sort((a, b) => b.toDeduct + b.afterPay - (a.toDeduct + a.afterPay)),
      },
      letterCounts,
      reviewCount: cases.filter((c) => c.flags.some((f) => f.type !== 'info')).length,
    };
  }

  // Checks the tool runs on itself. If any of these fail, the totals are not
  // safe to send to anyone.
  function buildChecks(cases, portal, log, letters, problems) {
    const checks = [];
    const portalCases = cases.filter((c) => c.portal);
    const portalSum = sum(portal.map((p) => parseAmount(p.amount_payable)));
    const caseSum = sum(portalCases.map((c) => c.portal.amount));
    const uniquePortal = new Set(portal.map((p) => String(p.notice_no).trim().toUpperCase())).size;
    checks.push({ ok: portalCases.length === uniquePortal && Math.abs(portalSum - caseSum) < 0.005,
      text: 'Every portal notice is matched to exactly one fine (' + portalCases.length + ' of ' + uniquePortal + ', $' + caseSum.toFixed(2) + ' of $' + portalSum.toFixed(2) + ').' });
    const owedSum = sum(cases.filter((c) => c.payment === 'owed' || c.payment === 'appeal').map((c) => c.current));
    checks.push({ ok: Math.abs(owedSum - portalSum) < 0.005, text: '"What we owe" equals the portal total ($' + owedSum.toFixed(2) + ' vs $' + portalSum.toFixed(2) + ').' });
    const logIds = new Set(cases.filter((c) => c.log).map((c) => c.id));
    checks.push({ ok: logIds.size === log.length, text: 'Every row of the old log is carried into the new log (' + logIds.size + ' of ' + log.length + ').' });
    checks.push({ ok: letters.every((l) => l.outcome), text: 'Every letter is accounted for (' + letters.length + ' letters).' });
    checks.push({ ok: problems.length === 0, text: problems.length ? problems.length + ' value(s) could not be read. See the list below.' : 'Every date, time and amount could be read.' });
    return checks;
  }

  const REGISTER_COLUMNS = [
    'log_id', 'notice_no', 'vehicle_no', 'offence_at', 'offence', 'amount', 'driver', 'status', 'deduction_status', 'handled_by', 'note', 'logged_at',
    'agency', 'offence_local', 'time_reliable', 'all_notice_nos', 'stage', 'current_amount', 'late_charge', 'portal_status', 'pay_by',
    'liable', 'driver_source', 'driver_named_on', 'letters', 'check',
  ];

  function registerRows(result) {
    return result.cases.map((c) => ({
      log_id: c.id,
      notice_no: c.mainNotice,
      vehicle_no: c.plate,
      offence_at: toUtcStamp(c.date, c.time),
      offence: c.offence,
      amount: c.original == null ? '' : c.original.toFixed(2),
      driver: c.driver,
      status: { paid: 'Paid', appeal: 'Appealed' }[c.payment] || (c.logStatus && c.logStatus.payment === 'appealed' ? 'Appealed' : 'Unpaid'),
      deduction_status: c.deduction,
      handled_by: c.log ? c.log.handled_by : '',
      note: c.log ? c.log.note : '',
      logged_at: c.log ? c.log.logged_at : result.today,
      agency: c.agency,
      offence_local: (c.date || '') + (c.time ? ' ' + c.time : ''),
      time_reliable: c.time ? (c.timeTrusted ? 'yes' : 'no') : '',
      all_notice_nos: c.notices.join(';'),
      stage: STAGE_LABEL[c.stage] || '',
      current_amount: c.current == null ? '' : c.current.toFixed(2),
      late_charge: c.lateCharge == null ? '' : c.lateCharge.toFixed(2),
      portal_status: c.portal ? c.portal.status : 'Not on portal',
      pay_by: c.payBy || '',
      liable: c.liable === 'To decide' ? '' : c.liable,
      driver_source: c.driverSource,
      driver_named_on: c.particularsDone,
      letters: c.letters.map((l) => l.id).join(';'),
      check: c.flags.filter((f) => f.type !== 'info').map((f) => f.text).join(' | '),
    }));
  }

  function payrollRows(result) {
    return result.cases
      .filter((c) => c.liable === 'Driver' && (c.deduction === 'To deduct' || c.deduction === 'Sent to payroll'))
      .sort((a, b) => a.driver.localeCompare(b.driver) || (a.date || '').localeCompare(b.date || ''))
      .map((c) => ({
        driver: c.driver, fine_ref: c.id, notice_no: c.mainNotice, vehicle_no: c.plate, offence_local: (c.date || '') + ' ' + (c.time || ''),
        offence: c.offence, amount_to_deduct: (c.original || 0).toFixed(2), how_driver_was_found: c.driverWhy, status: c.deduction,
        fine_paid_by_company: c.payment === 'paid' ? 'Yes' : 'Not yet',
      }));
  }
  const PAYROLL_COLUMNS = ['driver', 'fine_ref', 'notice_no', 'vehicle_no', 'offence_local', 'offence', 'amount_to_deduct', 'how_driver_was_found', 'status', 'fine_paid_by_company'];

  const ACTION_COLUMNS = ['priority', 'kind', 'deadline', 'daysLeft', 'caseId', 'notice', 'plate', 'amount', 'text'];

  const api = {
    POLICY, FILE_KINDS, parseCSV, toCSV, detectKind, parseDate, parseTime, parseAmount, parseLogTimestamp, toUtcStamp,
    normPlate, letterStage, parseLogStatus, rosterLookup, buildRoster, reconcile, registerRows, payrollRows,
    REGISTER_COLUMNS, PAYROLL_COLUMNS, ACTION_COLUMNS, STAGE_LABEL,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.FinesCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
