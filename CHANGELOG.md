# Changelog

## 1.0.0 (2026-10-13): Floorplan

- **New name: Floorplan** (was project-map). Command `/floorplan`, config `floorplan.config.mjs`, tools in
  `scripts/floorplan/`, map `docs/FLOORPLAN.md`, local folder `.floorplan/`, plugin `floorplan@floorplan`.
  Repositories set up with the old name keep working (old config name and map paths are found);
  `/floorplan update` migrates them.
- **CLAUDE.md is the source of truth**: `/floorplan rules` turns the rules written in the project's CLAUDE.md files
  into checks (`floorplan.claude-rules.json`, committed, with the source line of every rule). They are reported as
  warnings (`claudeMdSeverity: 'error'` for errors); a built-in, preset or config rule CLAUDE.md contradicts is
  switched off; statements that can't be checked are listed. When CLAUDE.md changes, the map, the check and the
  session summary say the rules need a refresh. Floorplan never edits the rules part of CLAUDE.md.
- New rule types `pattern` (code must not contain) and `requirePattern` (code must contain), comments ignored.
- **Clearer issues**: repository path with line number (`src/app/x.component.ts:12`), the rule and where it comes from
  (preset, config, or `CLAUDE.md:42` with the quote), what is wrong, why, and **how to fix it** (concrete steps or the
  command), in the console, the map, the branch report, `map:check`, the PR comment, the edit hook and the graph.
  The console shows 3 issues per rule plus a count; the map lists all.
- Plugin ready for the marketplace: README in the plugin, `claude plugin validate --strict` clean, skill frontmatter
  accepted by claude.ai uploads; setup can commit the skill into the repository for cloud sessions.

## 0.9.0 (2026-10-13)

Rules
- New rule types: `layers`, `noCycles` (area or file level; reports only the weakest imports of each cycle),
  `noPackage` (npm packages, deep imports, Java packages), `maxSize`, `maxFanIn`, `lazyBoundary`, `orphanTests`,
  `purpose`, `owners`, `unused`, `singleFileFolders` (with a Fix), `relativeImports`, `routed`; Spring:
  `fieldInjection`, `proxyAnnotations` (`@Transactional`/`@Async`/`@Cacheable` on private, final or static methods).
- Imports used only as types (interfaces and type aliases, also through barrel files, and `import type`):
  `typeImports: 'error' | 'warn' | 'ignore'` globally or per rule. Templates use `'warn'`.
- `accepted`: documented exceptions with a reason; listed, never counted; stale entries are reported.
- `budget`: allowed number of issues per rule; follows main's count down (ratchet).
- Per rule: `errorFrom` (warning until a date), `why` and `docs` (shown in reports, the edit check and the graph).
- Presets: `angular-feature-sliced`, `angular-nx`, `spring-layered`, `spring-hexagonal` (`presets: [...]`).

Planning and reports
- Extraction planner: `generate-map.mjs --plan-extract <rule> [--to shared]` simulates moving the imported files (with
  what they pull along) and reports fixed and added issues for every rule, plus the move commands.
- `cochange.mjs`: files in different areas that change together in git history.
- `codeowners.mjs`: CODEOWNERS section from the folder owners in the config.
- Branch report: unchanged files that use the changed ones, and the command for the related tests (Jest, Vitest,
  `ng test --include`, Maven, Gradle); also in the session summary.

Graph
- Rule issues panel: filter by rule and severity, why/docs, accepted exceptions; folder-level issues on folders.
- Keyboard: Tab through shapes, Enter opens, Escape goes up, `/` searches; ARIA labels.
- "Save image": the current view as PNG or SVG.

Project
- One copy of the skill (`plugin/skills/project-map`; `skill/` and `sync-plugin.sh` removed), LICENSE (MIT), author,
  CONTRIBUTING and issue templates, merged README with screenshots and test badge, version tags, `docs/dev/HANDOFF.md`.

## 0.8.0 (2026-10-13)

- Graph: every file kind has its own shape in the bubble layout (component/controller = rounded square,
  service = hexagon, guard = shield, routes/listener = triangle, store/repository = cylinder, model/entity = diamond,
  pipe/directive/DTO = pill, config = octagon). Services and controllers keep their shape when they show their methods.
  The legend shows the shapes.
- Security: the graph server rejects unknown `Host` headers (DNS rebinding) and foreign `Origin`s, and every API call
  needs a token that is new on each start (CSRF). The page gets a Content-Security-Policy and `X-Frame-Options: DENY`.

## 0.7.0 (2026-10-13)

- Edit check: a PostToolUse hook tells Claude right after it writes a file that breaks a rule, with the fix
  (about 0.2 s; installed by `install-hooks.mjs`, skip with `--no-edit-check`).
- Fixes: every placement issue gets a suggested folder; "Fix" buttons in the graph; `move-cli.mjs <file> --fix`;
  `--create` for new target folders.
- Pull-request comment from CI (GitHub, Azure DevOps, GitLab): moves, new folders, area dependencies, new and fixed
  rule issues (`--check --pr-comment <file>`).
- Big repositories: split map (overview + one file per area) and a per-file parse cache.
- Rule sources: Nx `@nx/enforce-module-boundaries` and ArchUnit package/layer rules.
- `experiments/run.mjs`: with/without-map comparison on your own repository.
- Graph redesign ("survey map": contour rings, elevation tints, map-legend colours, bundled Barlow font, no external
  requests), legend can be hidden, sentence-case panels.
- Tests on Linux and Windows in GitHub Actions (`.github/workflows/test.yml`).

## 0.6.0 (2026-10-13)

Feedback from the first real Angular project:
- `--main` warns when the map path is ignored by git (e.g. a repo that ignores `docs/`); setup checks it and proposes
  another folder. Reports and CI templates use the configured paths (`generate-map.mjs --outputs`).
- No-CI mode: `ci: false` in the config; the CLAUDE.md section says who regenerates the main map. `--main` warns when
  run on a branch.
- `claude-md.mjs` writes the CLAUDE.md section: keeps CRLF and BOM, replaces its own (marked) or an older section,
  CI or no-CI wording. Replaces the template files.
- Windows: `.gitattributes` in this repo, `core.fileMode` note.
- Placement rules accept component-scoped services (in a component's `providers`, same folder), and have `except`.
- Near-miss hints: `must be in **/utils (folder "util/": did you mean "utils/"?)`.
- Graph server lifetime: the UI guide recommends your own terminal for long sessions.
- `/project-map update` and a version check (`scripts/project-map/VERSION`).

Angular:
- Kinds from decorators and types for Angular 20+ file names without suffixes (`user-profile.ts`).
- Style-guide rule types: `publicApi`, `naming`, `oneDeclaration`, `companion` (spec next to code).
- Sheriff: if `sheriff.config.ts` and `@softarc/sheriff-core` exist, Sheriff's encapsulation and dependency-rule
  violations are part of the map, the graph, the branch report and the new-issues-only check.

## 0.5.0 (2026-10-13)

- Spring Boot (Java): map, kind-based rules, class/package moves, method-move analysis between beans.

## 0.4.0 (2026-10-12)

- Angular: map, rules, bubble graph with moves, method-move preview, main map by CI + branch report.
