# 3 · Features

Everything the `project-map` skill can do, in detail. Examples are from Angular; Spring Boot (Java) works the same way,
with the differences in [4-SPRING-BOOT.md](4-SPRING-BOOT.md).

Contents:
1. [Skill commands](#1-skill-commands)
2. [The maps: main, local, branch report](#2-the-maps)
3. [The bubble graph](#3-the-bubble-graph)
4. [Moving files and folders](#4-moving-files-and-folders)
5. [Moving methods between services](#5-moving-methods-between-services)
6. [Command-line tools (without Claude)](#6-command-line-tools-without-claude)
7. [Local server API](#7-local-server-api)
8. [Privacy and safety](#8-privacy-and-safety)
9. [Limits and roadmap](#9-limits-and-roadmap)

---

## 1. Skill commands

Type these in Claude Code inside an Angular repository. (As a plugin: `/project-map:project-map …`.)

| Command | What it does | Changes code? |
|---|---|---|
| `/project-map setup` | One-time setup per repository: copies the tools, writes the config (after you confirm), npm scripts, `CLAUDE.md` section, first maps; asks about the automatic refresh (hooks) and your CI. Run again to update the tools. | adds files |
| `/project-map` or `/project-map map` | Refreshes the local map and branch report, then answers your question or summarizes: what this branch changed, issues it introduced or fixed, the structure, existing issues, surprising dependencies. Suggests move commands for misplaced files (doesn't run them). | refreshes `.project-map/` only |
| `/project-map ui [port]` | Starts the bubble graph in the background, gives you the link (default http://localhost:4321; next free port if taken). | no |
| `/project-map move <source> <target-folder>` | Dry run, shows the plan, then applies: files + companions moved, imports rewritten, map regenerated. Then type check and `map:check`. Paths relative to the app root; `.` = app root. | yes |
| `/project-map move-methods <task or details>` | Re-runs the method analysis, asks you about every decision/blocker, then on a new branch: moves methods + helpers + state, wires injection, updates callers/templates/tests, type check, unit tests, map check, summary. | yes, after your answers |

Claude also uses the skill **without a command** when you work in a repository that has `docs/PROJECT_MAP.md` and
it creates, moves, renames or deletes files: it puts new files where the map says, moves files with the move tool
(never by hand), and runs `npm run map` and `npm run map:check` afterwards. Questions like "where should a new
guard go?", "which features depend on customers?" or "what did this branch change?" also use it. Claude never
runs `npm run map:main` or edits `docs/` unless you ask: that's CI's job.

Examples:
```
/project-map
/project-map where should a new HTTP interceptor go?
/project-map ui 4400
/project-map move features/orders/ui/order-badge shared/ui
/project-map move-methods move exportCsv and exportPdf from OrdersService into a new OrderExportService in features/orders/data-access
```

## 2. The maps

### Two layers

| | Main map | Local map | Branch report |
|---|---|---|---|
| Files | `docs/PROJECT_MAP.md`, `docs/project-map.json` | `.project-map/PROJECT_MAP.md`, `.project-map/project-map.json` | `.project-map/BRANCH_CHANGES.md`, `.project-map/branch.json` |
| Shows | structure of main | your working tree right now | what your branch changed compared with main |
| Created by | `npm run map:main`, only CI after merges (and once at setup) | `npm run map`, hooks, the graph, `move-cli` | same as local |
| Committed | yes | never | never |
| Claude | loaded in every session via `CLAUDE.md` | read when needed | summary added at every session start (hook), file read when needed |

Only CI writes the main map, so feature branches never touch it: **no merge conflicts**, and merging/rebasing main
brings the current main map into your branch automatically. `.project-map/` contains its own `.gitignore`, so it never
shows up in `git status`.

### `PROJECT_MAP.md` (main and local have the same format)

| Section | Content |
|---|---|
| Header | app root, number of source and spec files, counts per kind (components, services, routes, guards, …) |
| Structure | every folder as an indented list: purpose and owner from the config, then what's inside: `components: order-card <app-order-card>; services: orders`. Big folders show counts instead of names (`maxFilesPerFolder`). |
| Routes | every route path with its target: lazy routes, lazy component, eager component or redirect, and the file defining it |
| Dependencies between areas | which area imports which (e.g. `features/orders → core, shared`) |
| Rules | each rule with severity and message |
| Violations | each violation with file, detail and rule |
| Main libraries | the most-used npm packages |

**Compact mode for large apps** (automatic above `compactAbove` = 400 files): the Structure section shows counts per
folder instead of file names, 3 levels deep (reduced automatically to stay under 250 lines), folders with more than
30 subfolders list their names on one line, and routes/violations/dependencies are capped with "…and N more (see the
.json)". Measured on a 4,400-file app: about 10 KB (~2,600 tokens) instead of 130 KB, built in about half a second.

### Branch report (`BRANCH_CHANGES.md`)

Compares your working tree (including uncommitted changes) with the **branch point** on main (`git merge-base`), so it
shows only your branch's work, never what others merged to main meanwhile. Sections: summary line, new rule issues
(these fail `map:check`), fixed rule issues, added / moved (grouped per folder) / deleted / modified files, new and
removed folders, new and removed dependencies between areas. It also says when main has newer commits you haven't
merged. Details of the comparison: [2-VALIDATION.md, A3](2-VALIDATION.md#a3-mapcheck-and-the-branch-report).

Speed: the map of the branch point is built once and cached per branch point (~2–5 s on 4,400 files the first time,
then ~0.5 s per run).

### Session-start summary for Claude

With the hook installed (`npm run map:hooks`), every Claude Code session (also after `/clear` and compaction) starts
with a few factual lines, for example:

```
Project map: branch report generated at session start.
Branch feature/demo compared with main at branch point 5f4bfdda.
Changes on this branch: 0 files added, 1 moved, 0 deleted, 2 modified.
Moved: features/customers/customer-list/customer-export.service.ts → features/customers/data-access/customer-export.service.ts
Rule issues introduced by this branch: 1; fixed: 1; existing on main: 1.
- features/settings/settings-page/settings-page.component.ts imports features/orders/data-access/orders.service.ts (features-are-isolated)
Main structure: docs/PROJECT_MAP.md. Branch details: .project-map/BRANCH_CHANGES.md. Current working-tree map: .project-map/PROJECT_MAP.md.
```

The hook never blocks or slows a session noticeably and never fails it (errors are silent).

### `project-map.json` (for tools)

`root`, `files` (path, kind, name, selector, resolved project imports), `routes`, `areas` (area dependencies),
`folders` and `rules` (from the config), `violations`. The graph is built from the local one plus the service list.

### How the generator reads the code

- Scans every `.ts` file under `root` (except `ignore` patterns).
- Kind from the file name (`*.component.ts`, `*.service.ts`, `*.routes.ts`, `*-routing.module.ts`, `*.guard.ts`, …).
- Selector from `selector: '…'` (components, directives), pipe name from `@Pipe({ name })`.
- Imports: `import … from`, `export … from`, side-effect `import '…'`, dynamic `import('…')`; resolved through
  relative paths, `index.ts`, and tsconfig `paths` aliases (tsconfig comments and trailing commas are fine).
- Routes: `path:` entries with `loadChildren`, `loadComponent`, `component` or `redirectTo`.

### Big repositories: split map and cache

- Above `splitAbove` files (default 1500; `split: true/false` forces it) the main map becomes an **overview**: a table of
  areas with purpose, size, main kinds, dependencies and issue count, plus one detail file per area in
  `project-map-areas/` next to the map (local: `.project-map/areas/`). Claude reads the overview every session and
  the detail file of the area it works in. Apache Fineract (5,476 classes): 8 KB overview instead of 25 KB.
- Parse results are cached per file in `.project-map/cache-*.json` (size + modification time), so only changed files
  are read again: Fineract 3.7 s cold, 1.1 s warm. Delete the cache any time; `PROJECT_MAP_NO_CACHE=1` turns it off.

## 3. The bubble graph

Start: `/project-map ui` or `npm run map:ui`, then open http://localhost:4321. Works in light and dark mode,
offline, desktop-sized browser windows (a narrow window stacks the panel below the graph).

The page is drawn like a survey map: folders are contour rings with elevation tints (deeper folders are darker),
files are coloured by kind like map symbols, and rule issues have a red dashed border. Light and dark mode follow the
system. The Barlow font is bundled (`scripts/project-map/fonts/`, SIL Open Font License), so the page makes no
requests outside your machine.

Every placement issue has a **Fix** button ("Fix: move to features/customers/data-access/"): it opens the usual move
preview for the folder the map suggests (an existing allowed folder that holds most of what the file uses or what
uses it). The command-line equivalent is `move-cli.mjs <file> --fix`.

### What you see

- **Bubbles in bubbles**: folders contain folders and files; the app root is the outer circle.
- **File shapes and colors** (so the kind reads without colour too):

  | Angular | Spring Boot | Shape |
  |---|---|---|
  | component | controller | rounded square, blue |
  | service | service, component | hexagon, green |
  | routes, module | listener | triangle |
  | guard, interceptor, resolver | | shield, purple |
  | pipe, directive | DTO, mapper | pill, teal |
  | store (state) | repository | cylinder |
  | model | entity | diamond |
  | config | config, application | octagon |
  | other | exception, other | small circle, gray |

  Legend bottom-left (it can be hidden).
- **Bubble size**: files imported by more files are a bit bigger.
- **Red ring**: the file breaks a rule. Folder labels show `N files · N issues`.
- **Services** (`@Injectable` classes with methods; in Spring also controllers and beans) keep their shape, drawn
  larger, and contain one bubble per method;
  private methods have a dashed outline.
- **Header**: breadcrumb, search, `N files · N issues · N new on branch`, Undo.
- **Side panel**: details of what's selected (see below).

### Navigate

| Action | Result |
|---|---|
| Click a folder | zoom in one level (clicks inside a big folder open that folder, not a deeper one) |
| Click a service | opens it: the method bubbles fill the view |
| Click a file | selects it: lines to what it imports (blue) and to files that import it (orange) |
| Click the background / press Esc | one level up |
| Click a breadcrumb item | jump to that level |
| Search box | type part of a path; ↑/↓ to choose, Enter to jump (folders open, files are selected, methods open their service) |
| Links in the side panel | jump to that file or folder |

### Side panel views

| Selected | Shows |
|---|---|
| nothing (app root) | branch section (vs main: added/moved/deleted/modified, new and fixed issues), all rule issues (click to jump), dependencies between areas, how-to |
| folder | path, purpose and owner (or a hint to add one), "Move to another folder…", issues inside, contents |
| file | kind and selector, folder purpose, "Move to another folder…", rule issues with messages, imports, imported by |
| service | class name, what it injects, list of methods with checkboxes (visibility, lines), "Move N selected to…", "Move file to another folder…", imported by |

## 4. Moving files and folders

`--create` lets the target folder be new (`move-cli.mjs x.ts features/billing --create`), and `--fix` moves a
misplaced file to the suggested folder (`move-cli.mjs <file> --fix`, then `--apply`).

Three ways in the graph:

1. **Drag** a file or folder bubble onto a folder bubble. The target gets a dashed blue outline; dropping on the
   folder it's already in does nothing.
2. **Drag onto a breadcrumb** item to move it into a parent level without zooming out.
3. **Pick up** for far-away targets: select it, press **Move to another folder…**, a blue banner appears; navigate
   anywhere (clicks, breadcrumb, search), select the target folder, press **Move … here**. Cancel or Esc to stop.

Only bubbles that are visible and near the current level can be dragged or used as targets (no accidental drops on
far-away or hidden folders).

Then:
- **Preview**: every file that moves (with companions) and every import that changes (old → new), plus warnings
  and the rule issues of what you move. **Cancel** or **Move files**.
- **Move**: git mv (history kept), imports rewritten, empty folders removed, local map and branch report refreshed
  (`docs/` is never touched); the graph reloads at the target with the moved item selected.
- **Toast**: `Moved N files · N imports rewritten · issues before → after` with **Undo**.
- **Undo** (toast or header button) reverses the last move, imports included, while the server runs. Several undos
  work in order.

Same engine from Claude (`/project-map move`) and from the terminal (`move-cli.mjs`). Details of what gets rewritten
and the safety checks: [2-VALIDATION.md, A5](2-VALIDATION.md#a5-safety-checks-for-file-and-folder-moves).

## 5. Moving methods between services

Goal: split a service by concern without copy-paste and without bugs from shared state.

### Select

Open a service (click its bubble). Select methods by clicking their bubbles (click again to deselect) or with the
checkboxes in the panel. Selected bubbles turn blue.

### Choose the target

| Way | Result |
|---|---|
| Drag a selected bubble onto another service bubble | move into that existing service (any `@Injectable`, even one without methods) |
| Drag onto a folder bubble or a breadcrumb folder | create a **new service** there: a dialog asks for the class name (suggested from the service and method names, e.g. `OrdersExportService`); file name follows Angular style (`order-export.service.ts`) |
| **Move N selected to…** in the panel | pick-up mode: navigate to any service ("Move N methods into X") or folder ("Create a new service here…") |

### The impact preview

Calculated by the TypeScript compiler of your project. Nothing changes in the code.

| Section | Meaning |
|---|---|
| Chips | methods, helpers moving along, call sites in N files, test files, blockers, decisions |
| Needs a decision first | blockers (red) and decisions (amber), each with options |
| Methods that move | signatures |
| Moves along automatically | private helpers and state used only by the selected methods |
| *Target* needs | services to inject; "already injected"; "no longer needed in source" |
| Callers to update | file:line with the code line; template calls marked `template` |
| Test mocks | spec files that mention the methods |
| Dependency direction | which service will depend on which after the move; circular dependency warning |
| Task for Claude | the full instruction text |

Buttons: **Copy task for Claude** (to the clipboard) and **Close**.

### Let Claude do it

```
/project-map move-methods <paste the task>
```
Claude re-runs the analysis on the current code, asks one question per decision, then edits on a new branch
(`refactor/move-<method>-to-<target>`), keeps the injection style of the source (`inject()` or constructor), updates
callers, templates and test mocks, and verifies with type check, unit tests (Karma or Jest detected), and
`map:check`. It doesn't commit unless you ask.

What every check means: [2-VALIDATION.md, A6](2-VALIDATION.md#a6-checks-in-the-method-move-analysis).

## 6. Command-line tools (without Claude)

All run from the repository root. Paths for `move-cli` and `analyze-cli` are relative to the app root.

```bash
# Maps
node scripts/project-map/generate-map.mjs                  # = npm run map: local map + branch report (.project-map/)
node scripts/project-map/generate-map.mjs --main           # = npm run map:main: main map in docs/ (CI on main)
node scripts/project-map/generate-map.mjs --check          # = npm run map:check: fail only on NEW issues vs main
node scripts/project-map/generate-map.mjs --check --strict # fail on every error issue
node scripts/project-map/generate-map.mjs --session        # what the SessionStart hook prints for Claude
#   options: --base <branch> (default: baseBranch from the config), --quiet, --config <file>
#   debugging the branch point map: PROJECT_MAP_DEBUG=1 node scripts/project-map/generate-map.mjs

# Hooks
node scripts/project-map/install-hooks.mjs                 # = npm run map:hooks (Claude + git)
node scripts/project-map/install-hooks.mjs --claude | --git | --remove

# Graph server
node scripts/project-map/server.mjs                         # = npm run map:ui, http://localhost:4321
node scripts/project-map/server.mjs --port 4400 --config project-map.config.mjs
#   D3: env D3_PATH, else the bundled scripts/project-map/d3.min.js, else node_modules/d3, else cdnjs

# Move files/folders
node scripts/project-map/move-cli.mjs <source> <target-folder>           # dry run
node scripts/project-map/move-cli.mjs <source> <target-folder> --apply   # do it (+ map regenerated)
node scripts/project-map/move-cli.mjs <source> <target-folder> --json    # machine-readable plan

# Methods
node scripts/project-map/analyze-cli.mjs --list                          # all services and their methods
node scripts/project-map/analyze-cli.mjs --source <x.service.ts> --methods a,b --target-file <y.service.ts>
node scripts/project-map/analyze-cli.mjs --source <x.service.ts> --methods a,b --target-folder <folder> --class NewService
#   add --json for the full analysis
```

Exit codes: [2-VALIDATION.md, A7](2-VALIDATION.md#a7-exit-codes).

Files in `scripts/project-map/`:

| File | Purpose |
|---|---|
| `generate-map.mjs` | builds the maps and the branch report, `--check` for CI, `--session` for the hook |
| `install-hooks.mjs` | installs/removes the Claude Code SessionStart hook and the git hooks |
| `server.mjs` + `ui.html` | the bubble graph |
| `move.mjs` | move engine (plan, apply, undo) |
| `analyze.mjs` | method analysis with the TypeScript compiler |
| `move-cli.mjs`, `analyze-cli.mjs` | command-line front ends |
| `lib.mjs` | shared helpers (config, aliases, globs) |
| `d3.min.js`, `d3.LICENSE.txt` | bundled D3 v7 (ISC license) for the graph |

## 7. Local server API

For scripting or debugging. The server listens on 127.0.0.1 only and protects the API against other websites open
in the same browser:

- requests with a `Host` other than `localhost`/`127.0.0.1`/`[::1]:<port>` get 403 (DNS rebinding);
- `/api/*` requests with a foreign `Origin` get 403 (CSRF);
- `/api/*` requests need the header `x-project-map-token`. The token is new on every start and is in the page
  (`<meta name="pm-token">`); read it from `GET /` when scripting.
- The page is served with a Content-Security-Policy and `X-Frame-Options: DENY`.

| Method & path | Body | Returns |
|---|---|---|
| `GET /` | | the graph page |
| `GET /vendor/d3.min.js` | | D3 |
| `GET /api/map` | | refreshes the local map; JSON with files, routes, areas, violations, folder purposes, services and methods, branch report, undo history |
| `POST /api/plan` | `{ source, target }` | file/folder move preview |
| `POST /api/move` | `{ source, target }` | applies the move (re-planned from disk), returns result + new map |
| `POST /api/undo` | | undoes the last move |
| `POST /api/methods/plan` | `{ source, methods: [], target: { file } \| { folder, className } }` | method-move analysis (no changes) |

## 8. Privacy and safety

- Runs locally. No network calls, no telemetry (the graph's fonts and D3 are bundled). The graph server binds to 127.0.0.1.
- Reads only your repository. Writes only: `.project-map/` (local), the files you move, `docs/PROJECT_MAP.md` and
  `docs/project-map.json` only with `--main`, and `.claude/settings.json` / `.git/hooks/*` only when you install the hooks.
- Every file move is previewed first; method moves never change code from the graph.
- Everything ends up as a normal git diff you review. Work on a branch.

## 9. Limits and roadmap

Current limits:
- Angular (TypeScript) and Spring Boot (Java). No Kotlin, React or Vue yet.
- Relative `@use`/`@import` inside moved `.scss` files are not rewritten (the preview warns).
- Template and test-mock detection for methods is text-based (can list a same-named method of another object).
- Undo history lives in the running graph server; after a restart use git. For long sessions run the server in your
  own terminal (`npm run map:ui`): started from Claude it is a background task that stops after a while.
- Rules: `noImport`, `placement`, and the style-guide types `publicApi`, `naming`, `oneDeclaration`, `companion`.
  Sheriff is read when the project uses it; Nx module boundaries are not read yet.
- Very large apps: the first method analysis can take a few seconds (the TypeScript program is built once, then reused).

Ideas for next versions:
- React and Vue.
- Read Nx module boundaries (Sheriff is supported since 0.6.0).
- Rewrite `.scss` relative imports on move.
- Graphify integration for deep "how is X connected to Y" questions.
