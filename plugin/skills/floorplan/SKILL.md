---
name: floorplan
description: Floorplan for Angular and Spring Boot (Java) repositories - a structure map Claude reads for every task, rules for where code lives and what may use what (built-in, presets, and the project's own CLAUDE.md rules), an interactive bubble graph to move files, classes and packages with imports rewritten, and a CI check that fails only on new issues. Use for "/floorplan setup | update | rules | map | ui | move | move-methods", for questions about where code belongs or which areas depend on each other, and whenever you create, move, rename or delete files in a repo that has docs/FLOORPLAN.md (or docs/PROJECT_MAP.md).
---

# Floorplan

This skill's folder is `${CLAUDE_SKILL_DIR}`. In the reference guides, `<SKILL_DIR>` means exactly this path.
It holds `scripts/` (the tools, with a bundled copy of D3), `templates/` and `reference/` (step-by-step guides).
In the repository, the tools live in `scripts/floorplan/` after setup. Always run them from the repository root
(for Spring Boot: the folder with `pom.xml` / `build.gradle` and `floorplan.config.mjs`).

Arguments: `$ARGUMENTS`

## Pick the subcommand

| First word of the arguments | Do this |
|---|---|
| `setup` | Read `${CLAUDE_SKILL_DIR}/reference/setup.md` and follow it. Only when the user asked for setup. |
| `update` | Read `${CLAUDE_SKILL_DIR}/reference/update.md` and follow it (new tool version into this repository, also from the older "project-map" name). |
| `rules` | Read `${CLAUDE_SKILL_DIR}/reference/rules.md` and follow it (turn the rules in the project's CLAUDE.md into checks). |
| `map` or nothing | The **map** section below. |
| `ui` | Read `${CLAUDE_SKILL_DIR}/reference/ui.md` and follow it. Only when the user asked for it. |
| `move` | Read `${CLAUDE_SKILL_DIR}/reference/move.md` and follow it. |
| `move-methods` | Read `${CLAUDE_SKILL_DIR}/reference/move-methods.md` and follow it. |

If the skill was loaded without a slash command (you decided it is relevant), follow **Working in a mapped repo** below.

If `scripts/floorplan/generate-map.mjs` is missing in the repository for anything other than `setup`,
tell the user to run `/floorplan setup` first and stop.

Version check (any subcommand except `setup` and `update`): compare `${CLAUDE_SKILL_DIR}/scripts/VERSION` with
`scripts/floorplan/VERSION` in the repository. If the repository has `scripts/project-map/` instead (set up before the
rename), use the tools there for this request and suggest `/floorplan update` (it migrates). If the skill is newer, say
so in one line and suggest `/floorplan update`, then continue with the request.

If the map, the check or the session summary says CLAUDE.md changed since the Floorplan rules were derived, mention it
and offer `/floorplan rules` (don't run it unasked: it rewrites `floorplan.claude-rules.json`).

The framework is `framework` in `floorplan.config.mjs` (`angular` or `spring`). Commands are the same for both:

| What | Command (Angular projects also have the npm script in brackets) |
|---|---|
| Local map + branch report | `node scripts/floorplan/generate-map.mjs` (`npm run map`) |
| Rule check, only new issues fail | `node scripts/floorplan/generate-map.mjs --check` (`npm run map:check`) |
| Main map in docs/ (CI only) | `node scripts/floorplan/generate-map.mjs --main` (`npm run map:main`) |
| Plan moving cross-area imports to shared code | `node scripts/floorplan/generate-map.mjs --plan-extract <rule> [--to shared]` (changes nothing) |
| Files in different areas that change together (git history) | `node scripts/floorplan/cochange.mjs` |
| CODEOWNERS from folder owners in the config | `node scripts/floorplan/codeowners.mjs` (preview), `--write` |

For "how do we untangle X", "what should move to shared", "which files are misplaced" questions, use the extraction
planner and the change coupling report, and present their numbers; don't move anything without being asked.

## map

Two layers: `docs/FLOORPLAN.md` is the structure of **main** (committed, regenerated only by CI after merges).
`.floorplan/` is local and never committed: `FLOORPLAN.md` (current working tree) and `BRANCH_CHANGES.md`
(what this branch changed compared with main: files added/moved/deleted/modified, new and fixed rule issues).

1. Run the local map command. It never touches `docs/`.
2. Read `.floorplan/BRANCH_CHANGES.md`, and `docs/FLOORPLAN.md` (or `.floorplan/FLOORPLAN.md` for the
   current working tree).
3. Answer the user's question. Without a specific question, summarize: what this branch changed, rule issues it
   introduced or fixed, then the overall structure, existing rule issues and surprising area dependencies.
   `BRANCH_CHANGES.md` also lists the unchanged files that use the changed ones and the command for the related tests:
   mention both when the user is about to verify or open a pull request.
4. For a misplaced file, suggest the fix as a dry-run command:
   `node scripts/floorplan/move-cli.mjs <source> <target-folder>`. Don't apply it unless asked.
5. Never run the main map command or edit `docs/FLOORPLAN.md` unless the user explicitly asks (CI's job; first setup is the exception).

## Working in a mapped repo

When `docs/FLOORPLAN.md` exists and you create, move, rename or delete files:
- Put new files where the folder (package) purposes and rules in the map say they belong.
- If a hook reports that a file you wrote breaks a rule, fix it right away, following its "How to fix" line (for a
  misplaced file: `node scripts/floorplan/move-cli.mjs <file> --fix`, dry run, then `--apply`). Rules marked
  "from CLAUDE.md" are the team's own conventions: treat their warnings as things to fix, not noise.
- Move files with `node scripts/floorplan/move-cli.mjs <source> <target-folder>` (dry run), then the same with `--apply`.
  Never move files by hand. Angular: the tool also moves `.html/.scss/.spec.ts` and rewrites every import.
  Spring: it changes package declarations, rewrites imports (also implicit same-package use) and moves the tests along.
- Afterwards run the local map and the rule check (it fails only on issues this branch introduced) **in addition
  to** the usual verification (type check or compile, tests): the check covers structure and the CLAUDE.md rules,
  not behaviour. Fix rule issues by changing the code, not by changing a rule, unless the user asks.
- `docs/FLOORPLAN.md` shows main; your branch's changes are in `.floorplan/BRANCH_CHANGES.md`.
