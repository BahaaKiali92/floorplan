# Experiment: Claude Code with and without the project map (2026-10-12)

## Setup

- Two identical copies of `sample-app/` (29 files, 2 seeded rule issues: a feature importing another feature, and
  `customer-export.service.ts` in the wrong folder).
- **Without map**: plain repository, no `CLAUDE.md`.
- **With map**: after setup (tools, config, main map, `CLAUDE.md` section, SessionStart hook).
- Headless Claude Code (`claude -p`, same model and settings, one run per task and condition), prompt =
  task + "Work directly in this repository. Don't ask questions; make reasonable choices yourself. Don't commit."
- Evaluation: files created/moved, `map:check` against the starting state with the same rules for both, `tsc`.

Tasks:
1. Service that exports the customer list as CSV + "Download CSV" button in the customer list.
2. Reusable loading-spinner component, shown in the order list while loading.
3. HTTP interceptor adding `X-Correlation-Id` (UUID), registered in the app.
4. New lazy-loaded `/invoices` page loading `GET /api/invoices` into a table.

## Results

| Task | Without map | With map |
|---|---|---|
| 1 CSV export | extended the **misplaced** `customer-list/customer-export.service.ts` in place (existing rule issue kept) | **moved it to `data-access/` with the move tool** (rule issue fixed, imports rewritten, git history kept); same result in a second run |
| 2 Spinner | `shared/ui/spinner/`; also edited the type stubs to make tsc pass | `shared/ui/loading-spinner/` |
| 3 Interceptor | `core/http/correlation-id.interceptor.ts`, registered in `app.config.ts` | identical |
| 4 Invoices | `features/invoices/` with `data-access/`, `invoice-list/`, `invoices.routes.ts`, lazy route | identical structure |
| New rule issues | 0 | 0 (task 1: 1 fixed) |
| Turns / cost / time (sum of 4) | 21 turns · $0.37 · 78 s | 17 turns · $0.32 · 71 s |

## Findings

1. **Structure**: in a small, consistent project Claude already infers good placement from neighbouring code, so tasks
   2–4 came out the same. The map made a difference where the existing code was a *bad* example (task 1): with the
   map Claude recognised the misplaced service and fixed it; without, it copied the mistake. Expect the gap to grow
   with project size and inconsistency, where neighbouring code is a less reliable guide.
2. **Efficiency**: slightly fewer turns and ~13% lower cost with the map (n = 1 per task; treat as a hint, not a result).
3. **Side effect found and fixed**: with the first `CLAUDE.md` wording ("before finishing, `map:check` must pass")
   Claude ran `map:check` *instead of* the type check in all with-map runs, while all without-map runs type-checked.
   The section now says: run the normal checks (type check, tests, lint) **and in addition** `map:check`, which checks
   structure only. Re-run of tasks 1, 2, 4: all three ran or attempted the type check and reported what they couldn't
   verify.
4. Remaining `tsc` errors in some runs come from the sample's minimal Angular type stubs (`input()`, `@angular/common`
   aren't stubbed), not from the generated code.

## Next experiments worth doing

- A real company Angular project (hundreds of files, inconsistent folders), 5+ tasks, 3 runs each.
- Tasks that need cross-feature knowledge ("reuse the existing date pipe", "which service already calls /api/x?").
- Measure: files placed per the rules, reused vs duplicated code, turns, cost, review comments.
