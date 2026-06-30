# Home Loan Calculator

A local-first, single-file web app for simulating home loan scenarios realistically:
multiple down-payment scenarios, yearly extra repayments, a repayment-holiday option, and
an apartment **sell-vs-keep** decision comparison. All calculations run in the browser —
no backend, no build step.

## Run

Open [index.html](index.html) in any browser. That's it.

The top bar shows an **engine validated ✓** badge once the in-page self-test confirms the
calculation engine reproduces the reference figures (see below).

## Validate the engine

The amortization math is validated against a real **Swedbank Estonia** export
(€400,000 / 15 years / 3% annuity → €2,762.33/month, €97,218.78 total interest):

```
node tests/engine.test.mjs
```

The test extracts the `<script id="engine">` block from `index.html` verbatim and runs it in
an isolated VM context, so there is no duplicated calculation code to drift. It asserts the
first three schedule rows match the Swedbank export **to the cent**.

To validate against full real exports from bank calculators (Swedbank and LHV), drop their
CSVs into `tests/fixtures/` (see [tests/fixtures/README.md](tests/fixtures/README.md)) and run:

```
node tests/fixtures.test.mjs
```

This infers each loan's parameters from the CSV itself, recomputes the entire schedule, and
diffs every row — flagging anything off by more than €0.01. The bundled Swedbank and LHV
exports (400k / 15y / 3%) currently match the engine on all 180 rows, dates included.

Key calculation detail: the monthly payment and running balance are tracked at **full
precision**; only display/CSV values are rounded. This is what reproduces Swedbank's exact
principal/interest split.

## Help for non-experts

A built-in **plain-English glossary** (the **❓ Glossary** button in the header) explains every
term on the page — loan/principal, LTV, DSTI, stress test, annuity, repayment holiday,
prepayment strategies, appreciation, break-even, and more — in everyday language with small
examples. The affordability figures (LTV, DSTI, stress) also have hover tooltips.

## Saving & sharing

- **Auto-save** — every change is persisted to `localStorage`, so closing/reopening or
  refreshing the page restores your exact state (all inputs and scenarios).
- **Copy link** — the toolbar button serializes the full state (UTF-8-safe, URL-safe base64)
  into the URL hash and copies a shareable/bookmarkable link to the clipboard (~0.5–2 KB).
- **Reset** — clears saved data and the URL, returning everything to defaults.

Load priority on open: a share-link hash (`#s=…`) wins, then saved `localStorage`, then defaults.

## Tabs

1. **Mortgage** — KPIs, compliance (LTV / DSTI / stress test), amortization schedule, CSV export.
2. **Scenario comparison** — all scenarios side by side, best value per row highlighted.
3. **Sell vs keep** — keep your apartment (rent + appreciation) vs sell it to fund a bigger
   down payment, at 2/5/10/15/20-year horizons, with break-even rent and appreciation.
4. **Extra repayments** — shorten-term vs reduce-payment strategies, interest saved, yearly balances.

## Country config system

The app is country-agnostic. Every country-specific rule (LTV/DSTI limits, stress floor,
rate defaults, CSV/date/number formats, regulatory notes) lives in one config object. The
engine and UI read from `activeCountry` and never hard-code country values.

Ships with **🇪🇪 Estonia**, **🇫🇮 Finland**, and **🇫🇷 France**. France is a different regime
(no statutory LTV cap, no stress test — the binding rule is the HCSF *taux d'effort* ≤ 35%
and a 25-year max term, with fixed-rate loans), which the same config shape handles. To add a
country, add one config object to the `COUNTRIES` array in the `<script id="engine">` block —
no engine or UI changes needed:

```js
const Latvia = {
  code: 'LV', name: 'Latvia', flag: '🇱🇻', currency: 'EUR', currencySymbol: '€',
  maxLTV: 0.90, /* ...all fields from the CountryConfig shape... */
  regulatoryNotes: [ /* ... */ ],
};
const COUNTRIES = [Estonia, Finland, Latvia];
```

## Disclaimer

For planning purposes only. All calculations assume a fixed interest rate and constant
monthly income. Verify all figures with your bank and a qualified financial advisor.

