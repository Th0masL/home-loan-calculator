# Reference fixtures — real bank calculator exports

Drop the CSVs you exported here, grouped by bank:

```
tests/fixtures/swedbank/   ← Swedbank exports
tests/fixtures/lhv/        ← LHV exports
```

To reproduce each export with the engine I need the **input parameters** that produced it.
Easiest: encode them in the filename, e.g.

```
swedbank/annuity_400000_15y_3.0pct.csv
lhv/equal-principal_250000_20y_4.2pct.csv
```

Pattern: `<method>_<principal>_<termYears>y_<ratePct>pct.csv`
where `<method>` is `annuity` or `equal-principal`.

If a filename can't carry it all (start date, repayment holiday, extra payments,
benchmark vs total rate), add a `meta.json` next to the CSV:

```json
{
  "method": "annuity",
  "principal": 400000,
  "termYears": 15,
  "annualRatePct": 3.0,
  "startDate": "2026-07-22",
  "notes": "first payment date, any holiday/prepayments, etc."
}
```

Once the files are here, a comparison test will parse each CSV, recompute the schedule
from these inputs, and report any per-row deltas (flagging anything above €0.01).

## Note on schedule method

The engine currently implements **annuity** (constant total payment) schedules — that's what
the Swedbank reference in `tests/engine.test.mjs` validates. Bank calculators usually also
offer **equal-principal** (declining payment) schedules. If your exports include those, tell
me and I'll add an equal-principal mode to the engine so we can validate both.
