// Validates the mortgage engine in index.html against a real Swedbank Estonia
// export. The engine <script id="engine"> block is extracted verbatim and run in
// an isolated VM context — zero duplication of the calculation code.
//
//   Run:  node tests/engine.test.mjs
//
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!m) { console.error('Could not find <script id="engine"> in index.html'); process.exit(1); }

const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const E = ctx.LoanEngine;

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? '✓' : '✗'} ${label}: got ${got}${ok ? '' : `, expected ${want}`}`);
  ok ? pass++ : fail++;
}

// ---- Reference: €400,000 / 15y / 3% annuity (Swedbank Estonia) ----
const rows = E.amortize(400000, 3, 180, 0, [], 'shorten_term', 0, null, 'DD.MM.YYYY');

check('monthly payment (display)', E.round2(E.monthlyPayment(400000, 3, 180)), 2762.33);

const ref = [
  { i: 0, open: 400000.00, prin: 1762.33, int: 1000.00 },
  { i: 1, open: 398237.67, prin: 1766.73, int: 995.59 },
  { i: 2, open: 396470.94, prin: 1771.15, int: 991.18 },
];
for (const row of ref) {
  check(`month ${row.i + 1} opening balance`, E.round2(rows[row.i].openingBalance), row.open);
  check(`month ${row.i + 1} principal`, E.round2(rows[row.i].principalPayment), row.prin);
  check(`month ${row.i + 1} interest`, E.round2(rows[row.i].interestPayment), row.int);
}

const totals = E.scheduleTotals(rows);
check('total interest', E.round2(totals.totalInterest), 97218.78);
check('schedule length (months)', rows.length, 180);

// ---- Sanity: shorten_term prepayment ends the loan early ----
const extra = E.buildExtraPayments(
  { enabled: true, mode: 'fixed_yearly', fixedYearlyAmount: 20000, paymentMonth: 12, strategy: 'shorten_term', feePct: 0 },
  180, new Date('2026-06-22T00:00:00'));
const prepayRows = E.amortize(400000, 3, 180, 0, extra, 'shorten_term', 0, null, 'DD.MM.YYYY');
check('prepayment shortens term', prepayRows.length < 180, true);
check('prepayment lowers total interest', E.scheduleTotals(prepayRows).totalInterest < totals.totalInterest, true);

// ---- Sanity: repayment holiday raises total interest ----
const holRows = E.amortize(400000, 3, 180, 12, [], 'shorten_term', 0, null, 'DD.MM.YYYY');
check('holiday adds interest', E.scheduleTotals(holRows).totalInterest > totals.totalInterest, true);
check('holiday months are interest-only', holRows[0].principalPayment === 0 && holRows[0].isHolidayMonth, true);

// ---- Compliance checks ----
const ltv = E.checkLTV(340000, 400000, 0.85, 0.90, false);   // 85% exactly -> ok/warning, not fail
check('LTV 85% not a fail', ltv.status !== 'fail', true);
const ltvFail = E.checkLTV(360000, 400000, 0.85, 0.90, false); // 90% > 85% -> fail
check('LTV 90% fails standard', ltvFail.status, 'fail');
const ltvGuar = E.checkLTV(360000, 400000, 0.85, 0.90, true);  // 90% with guarantee -> not fail
check('LTV 90% ok with guarantee', ltvGuar.status !== 'fail', true);

const dsti = E.checkDSTI(1000, 0, 3500, 0.50);
check('DSTI ~28.6% ok', dsti.status, 'ok');

// ---- France config: HCSF taux d'effort regime (no LTV cap, no stress test) ----
check('France registered', E.COUNTRIES.some(c => c.code === 'FR'), true);
check('France maxDSTI 35%', E.France.maxDSTI, 0.35);
check('France no stress test', E.France.hasStressTest, false);
check('France max term 25y', E.France.maxTermYears, 25);
check('France no guarantee scheme', E.France.maxLTVWithGuarantee == null, true);
// France stress = contract rate (no floor) when hasStressTest is false
const frStress = E.checkStress(270000, 3.34, 240, 0, 4500, E.France.stressRateFloor, E.France.maxDSTI, E.France.hasStressTest);
check('France stress rate = contract rate', frStress.stressRate, 3.34);
// Worked example: €300k / 20y / 3.34% fixed ≈ €1,715/mo (Perplexity's ~€1,733 was approximate)
check('France worked example monthly', E.round2(E.monthlyPayment(300000, 3.34, 240)), 1715.32);

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
