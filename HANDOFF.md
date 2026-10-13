# Handoff: where project-map stands (2026-10-13)

Read `CLAUDE.md` first for the layout and working rules. This file says what is done and what comes next.

## Status

- Version 0.4.0, Angular only. All 53 checks in `./tests/run.sh` pass; Playwright UI tests in `tests/ui/`.
- Features done: structure map, main map by CI + local branch report, SessionStart summary, `map:check` that
  fails only on new issues, bubble graph with drag-and-drop moves (imports rewritten, `git mv`, undo),
  method-move impact preview between services, CI templates (GitHub Actions, Azure Pipelines, GitLab).
- Measured effect: `docs/experiments/2026-10-12-with-without-map.md`.
- Not yet tested on a large real-world Angular project.

## Decisions so far

- Angular first; other frameworks only after the Angular version has proven itself on real projects.
- Name is still open ("project-map" is a working name; the GitHub repo is called project-play-map).
- `CLAUDE.md` section wording: Claude runs its normal checks (type check, tests, lint) **and in addition**
  `map:check` (the experiment showed Claude otherwise skipped the type check).
- Rules: prefer reading existing standard formats over copying rules from other Claude plugins.

## Competitive check (2026-10-12)

Nothing found that does the whole thing. Overlaps: codebase maps for Claude (Agent Runway, cc-codemaps,
Graphify, CodeDNA, GrapeRoot), placement warnings (Agent Runway), interactive read-only maps (Cartographer),
move-file import fixing (VS Code / WebStorm). Unique here: drag-to-move in the graph, method-move preview,
CI main map + branch report, check that fails only on new issues, Angular-aware kinds.
Position it on those, not on "a map for Claude". Re-check the community catalog before publishing.

## Next steps (in this order)

1. **Test on real company Angular projects** (one large, one messy). Note every problem; fix one per session.
   Never commit company code to this repo.
2. **Publishing prep:** LICENSE file, real author in `plugin/.claude-plugin/plugin.json`, GitHub Actions running
   `tests/run.sh`, `claude plugin validate --strict`, final name.
3. **Read Nx module boundaries and Sheriff configs** as rule sources (about half a day each).
4. **React and Vue** (about 1–2 weeks): `.vue` script-block imports, JSX, Vite aliases, kinds for hooks /
   stores / composables, warn that moves change routes in Next.js / Nuxt (file-based routing).
   Method moves stay Angular-only for now.
5. Later: eslint-plugin-boundaries / dependency-cruiser rules, relative `.scss` import rewriting, Spring Boot.
