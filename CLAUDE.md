# project-map: development guide for Claude

This repository develops **project-map**, a Claude Code skill (and plugin) for Angular and Spring Boot (Java) repositories: a structure map
Claude reads every session, a bubble-graph UI to move files/folders with import rewriting, method-move impact
analysis, branch reports, and a CI check that fails only on new structure issues.

## Layout

| Path | What |
|---|---|
| `skill/project-map/` | **Source of truth.** The skill users install (`SKILL.md`, `reference/*.md`, `scripts/`, `templates/`). |
| `skill/project-map/scripts/` | The tools, copied into target repos by `/project-map setup`. Node 18+, **zero dependencies**. |
| `plugin/` | Claude Code plugin wrapping the same skill. `plugin/skills/project-map` is a **generated copy**: never edit it, run `scripts/sync-plugin.sh`. |
| `.claude-plugin/marketplace.json` | Makes this repo a plugin marketplace (`/plugin marketplace add <owner>/<repo>`). |
| `docs/` | User docs: `1-SETUP.md`, `2-VALIDATION.md`, `3-FEATURES.md`, `4-SPRING-BOOT.md`; `experiments/` for measured results. |
| `sample-app/` | Tiny Angular-shaped app with seeded issues (type stubs instead of real Angular). Used by tests and docs. |
| `sample-spring-app/` | Small Spring Boot (Maven) app with seeded issues. Compiled in tests with `javac` against `tests/java-stubs/`. |
| `tests/run.sh` | End-to-end tests on temp copies of both samples (100 checks; Java moves are compiled with `javac` when installed). `tests/ui/*.py`: Playwright tests of the graph. |
| `scripts/` | `sync-plugin.sh`, `build-kit.sh` (→ `dist/project-map-kit.zip`). |
| `README-KIT.md` | README that goes into the zip kit. |

## Scripts (in `skill/project-map/scripts/`)

| File | Role |
|---|---|
| `generate-map.mjs` | Map generator (framework from config `framework`, else detected; Spring scanning in `java.mjs`). Modes: default (local map + branch report in `.project-map/`), `--main` (committed `docs/` map, CI only), `--check` (fail on issues new vs merge-base; `--strict`), `--session` (SessionStart hook output), `--json-stdout --json-out f` (internal: map of the merge-base tree). |
| `lib.mjs` | Config loading, tsconfig aliases, glob matching, `makeContext`. |
| `move.mjs` / `move-cli.mjs` | Move engine: companions, folder moves, import rewriting (relative, aliases, dynamic import, templateUrl/styleUrl), git mv, undo. |
| `analyze.mjs` / `analyze-cli.mjs` | Method-move analysis with the target project's own TypeScript language service. |
| `java.mjs` | Java parsing without a compiler: masking, package/imports/types/members, `JavaIndex`, kinds, endpoints, `scanSpring()`. |
| `java-move.mjs` | Java class/package moves: package lines, imports, same-package use, FQNs, tests along, warnings. |
| `java-analyze.mjs` | Method-move analysis for Spring beans (same plan shape as `analyze.mjs`). |
| `server.mjs` + `ui.html` | Local graph server (127.0.0.1) + D3 circle-packing UI (bundled `d3.min.js`). |
| `install-hooks.mjs` | Claude Code SessionStart hook in `.claude/settings.json` + git hooks; idempotent; `--remove`. |

## Working rules

- Edit `skill/project-map/` only. After any change: `./scripts/sync-plugin.sh`, then `./tests/run.sh`.
- Run tests: `./tests/run.sh` (needs network for `npm install` in the temp copy) or
  `TS_PATH=$(npm root -g)/typescript ./tests/run.sh`. All checks must pass before committing.
- UI changes: also run the Playwright tests (see `tests/ui/README.md`) and look at screenshots.
- Keep the tools dependency-free and Node 18 compatible. Use only `node:` built-ins.
- `SKILL.md` stays short (it's loaded on every invocation); put step-by-step detail in `reference/*.md`.
  In reference files write `<SKILL_DIR>`, never `${CLAUDE_SKILL_DIR}` (only substituted inside SKILL.md).
- The session hook must never fail or print noise: errors exit 0 silently; output stays factual and < 3,500 chars.
- Anything that writes to user code must preview first (dry run) and be undoable via git.
- Every user-visible change: update `docs/` (setup / validation / features), add a test in `tests/run.sh`, bump
  `version` in `plugin/.claude-plugin/plugin.json`.
- Release a kit: `./scripts/build-kit.sh` → `dist/project-map-kit.zip`.

## Known limits / ideas

See `docs/3-FEATURES.md` section 9, `docs/4-SPRING-BOOT.md` section 9 and `docs/experiments/`. Next big items: reading
boundary rules from Nx/Sheriff (and ArchUnit for Java), React/Vue, Kotlin, rewriting relative `.scss` imports on move.
