# Contributing

The most useful contribution right now: **tell how it worked on a real project.** Open an issue with the
"Real-project report" template. Never paste company code; describe the shape of the project instead.

## Reports from real projects

Helpful details:

- Framework and size: Angular version (standalone / NgModules, Nx, Sheriff), or Spring Boot (Maven/Gradle, modules,
  package by feature or by layer); roughly how many source files.
- What `/floorplan setup` proposed and what you changed (a preset? which rules did you switch off, and why?).
- False positives: a rule issue that isn't one. Include the rule, the kind of import or file, and why it is fine.
- What Claude did differently with the map, good or bad.
- Timing: `time node scripts/floorplan/generate-map.mjs` on your repository (first run and second run).

## Bugs

Use the "Bug" template: the command, what you expected, what happened, `scripts/floorplan/VERSION`, Node version and
OS. For a wrong move or analysis, a minimal example (a few files in `sample-app/` or `sample-spring-app/`) helps most.

## Code

- The skill and tools live in `plugin/skills/floorplan/`; the tools are plain Node 18 ES modules with no
  dependencies. Keep it that way.
- Run `./tests/run.sh` before every commit (see `CLAUDE.md` for options). UI changes: also the Playwright tests in
  `tests/ui/` and a look at the screenshots.
- Every user-visible change: docs in `docs/`, a test in `tests/run.sh`, a line in `CHANGELOG.md`, the version in
  `plugin/.claude-plugin/plugin.json` and `plugin/skills/floorplan/scripts/VERSION`.
- New rule types: add them to `runRules()` in `generate-map.mjs`, document them in `docs/3-FEATURES.md` (rule types),
  and add a seeded example to a sample app or a temporary fixture in `tests/run.sh`.
