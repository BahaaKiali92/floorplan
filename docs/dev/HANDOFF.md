# Handoff: where project-map stands (2026-10-13, v0.9.0)

Read `CLAUDE.md` (repository root) first for the layout and working rules. This file says what is done and what comes next.

## Status

- Version 0.9.0: Angular and Spring Boot (Java). All 229 checks in `./tests/run.sh` pass (with `TS_PATH` or npm access,
  `SHERIFF_PKG` for the Sheriff tests);
  Playwright UI tests in `tests/ui/` (Angular and `spring_test.py`).
- Spring Boot (0.5.0): map with kinds from annotations, HTTP endpoints and listeners, kind-based rules
  (`fromKinds`, `toKinds`, `kinds`, `exceptFrom`), class/package moves (package lines, imports, same-package use,
  tests move along, warnings for strings/YAML/package-private/component scan/other module), method-move analysis for
  beans (proxy annotations, interface methods, endpoints, singleton state). No JDK needed. Docs: `docs/4-SPRING-BOOT.md`.
- Features done: structure map, main map by CI + local branch report, SessionStart summary, `map:check` that
  fails only on new issues, bubble graph with drag-and-drop moves (imports rewritten, `git mv`, undo),
  method-move impact preview between services, CI templates (GitHub Actions, Azure Pipelines, GitLab).
- Measured effect: `docs/experiments/2026-10-12-with-without-map.md`.
- 0.6.0 = feedback from the first real Angular project (MinuteView, 2026-10-13), see CHANGELOG.md: gitignored docs/
  warning, no-CI mode, CRLF-safe CLAUDE.md writer, Windows notes, component-scoped services, near-miss hints, UI
  lifetime note, `/project-map update` + version check. Plus Angular style-guide rules, Angular 20 suffix-less files,
  and Sheriff as a rule source.
- 0.7.0: edit-check hook, fix suggestions + Fix buttons, PR comment, split map + cache, Nx + ArchUnit rules,
  experiments/run.mjs, graph redesign, Linux + Windows CI (first Windows run not yet seen: check the Actions tab).
- 0.9.0: everything from the external review plan: 14 new rule types, type-only imports, accepted list, budgets,
  errorFrom, why/docs, presets, extraction planner, change coupling, CODEOWNERS, dependents + related tests in the
  branch report, issues panel filter, keyboard, PNG/SVG export, workspace packages (Nx), one skill copy, LICENSE,
  CONTRIBUTING, issue templates, tags. Open-source runs: `docs/experiments/2026-10-13-open-source-runs.md`.
- 0.8.0: one shape per file kind in the graph; graph server hardened (Host/Origin checks, per-start token, CSP).
- Spring Boot: tested on petclinic, buckpal, Apache Fineract; not yet on a company project.

## Decisions so far

- Angular first, then Spring Boot (done in 0.5.0, one plugin that detects the framework). React/Vue after real-project tests.
- Name is still open ("project-map" is a working name; the GitHub repo is called project-play-map).
- `CLAUDE.md` section wording: Claude runs its normal checks (type check, tests, lint) **and in addition**
  `map:check` (the experiment showed Claude otherwise skipped the type check).
- Rules: prefer reading existing standard formats over copying rules from other Claude plugins.

## Competitive check (2026-10-12)

Nothing found that does the whole thing. Overlaps: codebase maps for Claude (Agent Runway, cc-codemaps,
Graphify, CodeDNA, GrapeRoot), placement warnings (Agent Runway), interactive read-only maps (Cartographer),
move-file import fixing (VS Code / WebStorm). Unique here: drag-to-move in the graph, method-move preview,
CI main map + branch report, check that fails only on new issues, Angular- and Spring-aware kinds.
Position it on those, not on "a map for Claude". Re-check the community catalog before publishing.

## Next steps (in this order)

1. **Final name** before announcing (repo "project-play-map", plugin "project-map"): check the community plugin
   catalog for collisions, then rename the repository and the marketplace name together.
2. **Run `experiments/run.mjs` on MinuteView** (5 tasks, 3 runs), and try the new preset + `typeImports: 'warn'`
   there: the interface-only imports were about half of its 43 issues. Put the numbers in docs/experiments.
3. **Company Spring Boot project** (multi-module, Maven or Gradle). Never commit company code to this repo.
4. React and Vue (about 1–2 weeks): `.vue` script blocks, JSX/TSX, Vite aliases, kinds for hooks / stores /
   composables, file-based routing warnings. nx-examples has React parts to test with.
5. Later: Kotlin, relative `.scss` import rewriting, classes used only as types (needs the TypeScript checker),
   eslint-plugin-boundaries / dependency-cruiser as rule sources.
