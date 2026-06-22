// Compares the engine against real bank-calculator CSV exports in tests/fixtures/.
//
//   Run:  node tests/fixtures.test.mjs
//
// Bank exports are messy and inconsistent, so the parser is deliberately tolerant:
//   - delimiter is auto-detected (; , tab, | or even the € sign, as Coop Pank uses)
//   - columns are mapped BY HEADER NAME, not position, so reordered columns
//     (e.g. Coop Pank lists Interest before Principal) are handled correctly
//   - numbers are parsed in any locale ("400 000.00", "400,000.00", "400000", "400 000,00")
//   - loan parameters come from a metadata block if present, else are inferred
//     (principal = first balance, rate = month-1 interest / balance * 12, term = row count)
//
// The engine then recomputes the whole schedule and every row is diffed; anything off
// by more than €0.01 is a failure. A meta.json next to a CSV overrides any field.
//
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- load the engine straight out of index.html (no duplicated math) ---
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!m) { console.error('Could not find <script id="engine"> in index.html'); process.exit(1); }
const ctx = { console }; ctx.globalThis = ctx;
vm.createContext(ctx); vm.runInContext(m[1], ctx);
const E = ctx.LoanEngine;

const TOL = 0.01;
let totalFail = 0, fixturesSeen = 0;

// --- locale-tolerant number parse ---
function parseNum(s) {
  if (s == null) return NaN;
  let t = String(s).replace(/[€$£\s%]/g, '').trim();
  if (t === '' || t === '--' || t === '-') return NaN;
  const hasDot = t.includes('.'), hasComma = t.includes(',');
  if (hasDot && hasComma) {
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else t = t.replace(/,/g, '');                                                            // 1,234.56
  } else if (hasComma) {
    if (/,\d{1,2}$/.test(t)) t = t.replace(',', '.'); // 1234,56 -> decimal comma
    else t = t.replace(/,/g, '');                     // 1,234   -> thousands comma
  }
  return parseFloat(t);
}
function parseDate(s) {
  const mm = String(s).trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (!mm) return null;
  return new Date(Number(mm[3]), Number(mm[2]) - 1, Number(mm[1]));
}

// --- map a single header label to a column role (precedence matters) ---
function roleOf(name) {
  const s = name.toLowerCase();
  if (/date/.test(s)) return 'date';
  if (/period|month|\bnr\b|\bno\b/.test(s)) return 'period';
  if (/balance/.test(s)) return 'balance';      // "Principal balance" -> balance
  if (/principal/.test(s)) return 'principal';  // "Principal payment" -> principal
  if (/interest/.test(s)) return 'interest';
  if (/total/.test(s)) return 'total';
  return null;
}
// --- when a header has no delimiter (Coop Pank), recover column order by scanning ---
function rolesFromConcatHeader(line) {
  const s = line.toLowerCase();
  const probes = [['date', /date/], ['period', /period|month/], ['balance', /balance/],
    ['principal', /principal/], ['interest', /interest/], ['total', /total/]];
  const found = [];
  for (const [role, re] of probes) { const mm = re.exec(s); if (mm) found.push({ role, idx: mm.index }); }
  found.sort((a, b) => a.idx - b.idx);
  return found.map(f => f.role);
}

function detectDelimiter(dataLines) {
  const cands = ['€', '\t', ';', '|', ','];
  let best = null, bestCount = 1;
  for (const d of cands) {
    const counts = dataLines.map(l => l.split(d).length);
    const consistent = counts.every(c => c === counts[0]);
    if (consistent && counts[0] >= 4 && counts[0] > bestCount) { best = d; bestCount = counts[0]; }
  }
  return best;
}

function parseFixture(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const isData = l => /^\d/.test(l) && !/^total/i.test(l);
  const dataLines = lines.filter(isData);
  const delim = detectDelimiter(dataLines) || ';';

  // metadata block: "key: value" lines that are neither header, data nor total
  const meta = {};
  for (const l of lines) {
    if (isData(l) || /^total/i.test(l)) continue;
    const kv = l.match(/^([A-Za-z][A-Za-z ./]*?)\s*:\s*(.+)$/);
    if (!kv) continue;
    const k = kv[1].toLowerCase().trim(), v = kv[2].trim();
    if (/loan amount/.test(k)) meta.principal = parseNum(v);
    else if (/^interest/.test(k)) meta.annualRatePct = parseNum(v);
    else if (/period/.test(k)) { const num = parseNum(v); meta.termMonths = /month/i.test(v) ? Math.round(num) : Math.round(num * 12); }
    else if (/schedule type|payment type/.test(k)) meta.method = /annuit/i.test(v) ? 'annuity' : v.toLowerCase();
  }

  // header line: the non-data line richest in role keywords
  let headerLine = null, bestRoles = 0;
  for (const l of lines) {
    if (isData(l)) continue;
    const rc = ['date', 'balance', 'principal', 'interest', 'total', 'period'].filter(k => l.toLowerCase().includes(k)).length;
    if (rc > bestRoles) { bestRoles = rc; headerLine = l; }
  }
  let roles;
  const headerCells = headerLine ? headerLine.split(delim) : [];
  if (headerCells.length >= 4) roles = headerCells.map(roleOf);
  else roles = rolesFromConcatHeader(headerLine || '');

  // parse data rows by role
  const rows = dataLines.map(l => {
    const cells = l.split(delim);
    const r = {};
    roles.forEach((role, i) => { if (role) r[role] = cells[i]; });
    return {
      date: r.date ? r.date.trim() : null,
      openingBalance: parseNum(r.balance),
      principal: parseNum(r.principal),
      interest: parseNum(r.interest),
      total: parseNum(r.total),
    };
  });

  // grab numbers from the last "Total" row for a totals cross-check
  const totalLine = [...lines].reverse().find(l => /^total/i.test(l));
  const totalNums = totalLine ? totalLine.split(delim).map(parseNum).filter(n => !isNaN(n)) : [];

  return { rows, meta, totalNums, delim, roles };
}

function compareFixture(label, csvPath) {
  fixturesSeen++;
  const { rows, meta, totalNums, delim, roles } = parseFixture(readFileSync(csvPath, 'utf8'));
  if (!rows.length) { console.log(`\n— ${label}: no data rows parsed, skipped`); return; }

  // parameters: metadata > inferred
  const first = rows[0].date ? parseDate(rows[0].date) : null;
  let p = {
    principal: meta.principal != null ? meta.principal : rows[0].openingBalance,
    annualRatePct: meta.annualRatePct != null ? meta.annualRatePct : (rows[0].interest / rows[0].openingBalance) * 12 * 100,
    termMonths: meta.termMonths != null ? meta.termMonths : rows.length,
    startDate: first ? E.addMonths(first, -1) : null,
    method: meta.method || (() => {
      const spread = a => Math.max(...a) - Math.min(...a);
      return spread(rows.map(r => r.total)) < spread(rows.map(r => r.principal)) ? 'annuity' : 'equal-principal';
    })(),
  };
  // optional override
  const sideMeta = join(dirname(csvPath), 'meta.json');
  if (existsSync(sideMeta)) {
    const o = JSON.parse(readFileSync(sideMeta, 'utf8'));
    if (o.principal != null) p.principal = o.principal;
    if (o.annualRatePct != null) p.annualRatePct = o.annualRatePct;
    if (o.termYears != null) p.termMonths = Math.round(o.termYears * 12);
    if (o.method) p.method = o.method;
    if (o.startDate) p.startDate = new Date(o.startDate + 'T00:00:00');
  }

  const dateInfo = first ? 'start ' + E.formatDate(p.startDate, 'DD.MM.YYYY') : 'no dates (period-based)';
  console.log(`\n— ${label}`);
  console.log(`  format  : delimiter '${delim === '\t' ? '\\t' : delim}', columns [${roles.join(', ')}]`);
  console.log(`  inferred: ${E.round2(p.principal)} / ${(p.termMonths / 12).toFixed(2)}y / ${p.annualRatePct.toFixed(4)}% / ${p.method} / ${dateInfo}`);

  if (p.method !== 'annuity') {
    console.log(`  ⚠ schedule is "${p.method}" — engine only implements annuity, comparison skipped.`);
    return;
  }

  const calc = E.amortize(p.principal, p.annualRatePct, p.termMonths, 0, [], 'shorten_term', 0, p.startDate, 'DD.MM.YYYY');

  let worst = 0, worstAt = '', mismatches = 0, dateMismatches = 0;
  const n = Math.min(calc.length, rows.length);
  for (let i = 0; i < n; i++) {
    const c = calc[i], r = rows[i];
    const d = Math.max(
      Math.abs(E.round2(c.openingBalance) - r.openingBalance),
      Math.abs(E.round2(c.principalPayment) - r.principal),
      Math.abs(E.round2(c.interestPayment) - r.interest),
      Math.abs(E.round2(c.scheduledPayment) - r.total),
    );
    if (d > worst) { worst = d; worstAt = `month ${i + 1}`; }
    if (d > TOL) {
      mismatches++;
      if (mismatches <= 3) {
        console.log(`  ✗ month ${i + 1}: bank[bal ${r.openingBalance} prin ${r.principal} int ${r.interest} tot ${r.total}]`);
        console.log(`              engine[bal ${E.round2(c.openingBalance)} prin ${E.round2(c.principalPayment)} int ${E.round2(c.interestPayment)} tot ${E.round2(c.scheduledPayment)}]`);
      }
    }
    if (r.date && c.date !== r.date) dateMismatches++;
  }
  if (calc.length !== rows.length) { mismatches++; console.log(`  ✗ row count: bank ${rows.length}, engine ${calc.length}`); }

  const calcTot = E.scheduleTotals(calc);
  const ti = E.round2(calcTot.totalInterest);
  if (totalNums.length && !totalNums.some(x => Math.abs(x - ti) <= TOL)) {
    mismatches++;
    console.log(`  ✗ total interest ${ti} not found in bank total row [${totalNums.join(', ')}]`);
  }

  totalFail += mismatches;
  if (mismatches === 0) {
    console.log(`  ✓ ${n} rows match to the cent (max delta €${worst.toFixed(4)}${worst > 0 ? ' at ' + worstAt : ''}, dates ${first ? (dateMismatches ? dateMismatches + ' off' : 'all match') : 'n/a'}, total interest €${ti})`);
  } else {
    console.log(`  → ${mismatches} mismatch(es), max delta €${worst.toFixed(4)} at ${worstAt}`);
  }
}

// --- discover and run every fixture ---
const root = join(__dirname, 'fixtures');
for (const bank of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())) {
  const dir = join(root, bank.name);
  for (const f of readdirSync(dir).filter(f => /\.csv$/i.test(f))) {
    compareFixture(`${bank.name}/${f}`, join(dir, f));
  }
}

if (!fixturesSeen) { console.log('No fixtures found under tests/fixtures/. Add CSVs and re-run.'); process.exit(0); }
console.log(`\n${totalFail === 0 ? '✅ ALL FIXTURES MATCH' : '❌ ' + totalFail + ' MISMATCH(ES)'}`);
process.exit(totalFail === 0 ? 0 : 1);
