# 2 · Validation

Two meanings of "validation", both covered here:

- **Part A: the checks the tool runs on your code**: structure rules, `map:check`, the safety checks before a
  file move, and the checks in the method-move analysis.
- **Part B: validating the installation**: a 15-minute walkthrough on the included `sample-app/` with the exact
  results you should see. Do this on the new laptop before using a company project.

Spring Boot: the rule fields for kinds (`fromKinds`, `toKinds`, `kinds`, `exceptFrom`), the warnings of a Java move,
the Spring decisions of the method analysis and a walkthrough with `sample-spring-app/` are in
[4-SPRING-BOOT.md](4-SPRING-BOOT.md).

Contents:
- A1. [Overview of all checks](#a1-overview-of-all-checks)
- A2. [Structure rules](#a2-structure-rules)
- A3. [`map:check` and the branch report](#a3-mapcheck-and-the-branch-report)
- A4. [Where rule issues appear](#a4-where-rule-issues-appear)
- A5. [Safety checks for file and folder moves](#a5-safety-checks-for-file-and-folder-moves)
- A6. [Checks in the method-move analysis](#a6-checks-in-the-method-move-analysis)
- A7. [Exit codes](#a7-exit-codes)
- B. [Validate the installation with the sample app](#b-validate-the-installation-with-the-sample-app)

---

## A1. Overview of all checks

| Check | When it runs | What it catches | Blocks? |
|---|---|---|---|
| Structure rules | every `npm run map` / `map:main` / `map:check`, graph load | files in the wrong folder, forbidden imports | listed everywhere |
| New-issues check | `npm run map:check` (pull requests in CI) | rule issues this branch **introduced** compared with main | new `error` issues fail; existing ones don't |
| Branch report | `npm run map`, session start, git hooks | what the branch added, moved, deleted, modified; new and fixed issues | informs, never blocks |
| Move pre-checks | before every file/folder move (graph, `/project-map move`, `move-cli`) | moving into itself, already there, name collision, missing source/target | refuses the move |
| Move warnings | in the move preview | `.scss` files with relative `@use`/`@import` | warns |
| Undo checks | before undo | files changed or target taken since the move | refuses the undo |
| Method analysis | graph method preview, `/project-map move-methods`, `analyze-cli` | shared state, shared helpers, circular dependencies, name clashes, every caller | blockers stop Claude until you decide |
| Type check + tests | after `/project-map move` and `move-methods` (Claude runs them) | anything the move broke | Claude fixes or reports |

## A2. Structure rules

Rules live in `project-map.config.mjs` under `rules`. Paths are relative to `root` (usually `src/app`).
Patterns: `*` = exactly one folder name, `**` = any depth. A folder pattern also covers everything inside it
(`'shared'` matches `shared/ui/button/button.component.ts`).

### Rule type `noImport`: "files here must not import files there"

| Option | Required | Meaning |
|---|---|---|
| `name` | yes | identifier shown in reports |
| `type` | yes | `'noImport'` |
| `from` | yes | pattern (or array) of importing files |
| `to` | yes | pattern (or array) of forbidden targets |
| `allowSame` | no | with `*` in both patterns: allowed when both match the **same** folder name (a feature may import itself) |
| `except` | no | pattern(s) of targets that are allowed anyway |
| `severity` | no | `'error'` (default, fails `map:check`) or `'warn'` (only shown) |
| `message` | no | explanation shown with every violation |

Only imports between project files count (relative imports and tsconfig path aliases). npm packages are ignored.

### Rule type `placement`: "files like this must live there"

| Option | Required | Meaning |
|---|---|---|
| `name`, `severity`, `message` | | as above |
| `type` | yes | `'placement'` |
| `files` | no | pattern of files the rule applies to (default: all) |
| `kinds` | no | only these file kinds: `component`, `service`, `routes`, `module`, `guard`, `interceptor`, `resolver`, `pipe`, `directive`, `store`, `model`, `config`, `other` |
| `allowedIn` | yes | pattern(s) where those files may live; `[]` means nowhere |
| `except` | no | pattern(s) of files the rule skips |
| `allowComponentScoped` | no | default `true`: a service listed in a component's `providers: [...]` and placed in the same folder as that component is accepted (it is component-scoped on purpose) |

File kinds come from Angular naming: `*.component.ts`, `*.service.ts`, `*.routes.ts` / `*-routing.module.ts`,
`*.guard.ts`, `*.interceptor.ts`, `*.resolver.ts`, `*.pipe.ts`, `*.directive.ts`,
`*.store|state|reducer|effects|actions|selectors|facade.ts`, `*.model|interface|types|enum|dto.ts`, `*.config.ts`.
Files without such a suffix (the Angular 20+ style guide names them `user-profile.ts`) get their kind from the code:
`@Component`, `@Directive`, `@Pipe`, `@NgModule`, `@Injectable`, `CanActivateFn`/`CanMatchFn` (guard),
`HttpInterceptorFn` (interceptor), `ResolveFn` (resolver), `: Routes =`, `signalStore(`/`createReducer(` (store),
`: ApplicationConfig =`. So prefer `kinds: ['service']` over `files: '**/*.service.ts'` in rules.

When a file is in a folder whose name is close to an allowed one, the message says so:
`must be in **/utils (folder "util/": did you mean "utils/"?)`.

### Angular style-guide rules

| Type | Options | Finds |
|---|---|---|
| `publicApi` | `modules` (e.g. `'features/*'`), `entry` (default `index.ts`), `except` | imports into another module that bypass its `index.ts`. Modules without an `index.ts` are skipped |
| `naming` | `case`: `kebab` (default), `camel`, `pascal`; `files`, `kinds` | file names that don't follow the case (`UserProfile.ts`) |
| `oneDeclaration` | `files` | files with more than one `@Component`/`@Directive`/`@Pipe`/`@Injectable`/`@NgModule` |
| `companion` | `companion` (default `.spec.ts`), `kinds`, `files` | files without that companion next to them (e.g. components without a spec) |

The template has the first three on as warnings and the spec rule commented out (it is noisy in older apps).
Make a rule an error once main is clean of it.

### Nx and ArchUnit

- **Nx** (`nx.json` present): the `depConstraints` of `@nx/enforce-module-boundaries` (from `.eslintrc.json` or
  `eslint.config.*`) are checked with the `tags` of every `project.json`: `onlyDependOnLibsWithTags`,
  `notDependOnLibsWithTags`, `sourceTag` / `allSourceTags`, `*`, globs and `/regex/` tags. Issues: `nx:module-boundaries`.
  Set the map root to the workspace (`root: '.'`). `nx: false` turns it off.
- **ArchUnit** (Spring Boot): rules in test classes are read: `noClasses().that().resideIn(Any)Package(..)`
  `.should().dependOnClassesThat()/accessClassesThat().resideIn(Any)Package(..)`, the same with
  `classes()…onlyDependOnClassesThat()`, and `layeredArchitecture()` with `mayNotBeAccessedByAnyLayer`,
  `mayOnlyBeAccessedByLayers`, `mayNotAccessAnyLayer`, `mayOnlyAccessLayers`. Issues: `archunit:<field name>`. Other
  ArchUnit rules still run in your tests; the map shows only these. `archunit: false` turns it off.

Like Sheriff, both are extra rule sources: their issues appear in the map, the graph, the branch report and the
new-issues-only check.

### Sheriff

If the project uses [Sheriff](https://github.com/softarc-consulting/sheriff) (`sheriff.config.ts` and
`@softarc/sheriff-core` in `node_modules`), its checks run as part of the map (`sheriff: 'auto'` in the config, the
default; `false` turns it off). Sheriff stays the source of truth for module boundaries; project-map adds:

- `sheriff:encapsulation` issues (deep imports into a module that has an `index.ts`) and `sheriff:dependency-rule`
  issues (tags in `depRules` that don't allow the dependency) in the map, the graph and the branch report;
- the new-issues-only check: Sheriff issues already on main don't block a branch, new ones fail `map:check`
  (the branch point map runs Sheriff too).

With Sheriff, remove the project-map rules it covers (`features-are-isolated`, `feature-public-api`,
`shared-has-no-feature-deps`) and keep the ones it doesn't (placement, naming, one class per file).

### The default rules (from the template)

```js
rules: [
  { name: 'features-are-isolated', type: 'noImport', from: 'features/*', to: 'features/*', allowSame: true,
    message: 'Features must not import other features. Move shared code to shared/ or core/.' },
  { name: 'shared-has-no-feature-deps', type: 'noImport', from: 'shared', to: ['features', 'core'],
    message: 'shared/ must stay generic. It cannot depend on features or core.' },
  { name: 'services-placement', type: 'placement', kinds: ['service'], allowedIn: ['core', 'features/*/data-access'],
    message: 'Services belong in core/ (app-wide) or features/<name>/data-access/.' },
  { name: 'no-components-in-core', type: 'placement', files: 'core', kinds: ['component'], allowedIn: [], severity: 'warn',
    message: 'core/ should not contain components. Use layout/ or shared/.' },
  // style guide (warnings): feature-public-api, file-names-kebab-case, one-angular-class-per-file; see above
]
```

### More examples you can copy

```js
// UI components inside a feature must not call APIs directly
{ name: 'ui-is-presentational', type: 'noImport', from: 'features/*/ui', to: 'features/*/data-access' },

// Nothing may import from a folder that is being retired (warning only)
{ name: 'legacy-is-frozen', type: 'noImport', from: '**', to: 'legacy', except: ['legacy'], severity: 'warn' },

// Guards and interceptors only in core
{ name: 'guards-in-core', type: 'placement', files: '**', kinds: ['guard', 'interceptor'], allowedIn: ['core'] },

// Models next to their feature's data-access or in shared/models
{ name: 'models-placement', type: 'placement', files: '**/*.model.ts', allowedIn: ['features/*/data-access', 'shared/models'] },
```

Tip: introduce a new rule as `severity: 'warn'`, clean up, then switch it to `'error'`.

## A3. `map:check` and the branch report

### What is compared with what

- **Base** = the branch point: `git merge-base HEAD origin/main` (or local `main`; the branch name comes from
  `baseBranch` in the config, or `--base <branch>`). The tool builds the map of that commit (with your **current**
  config, so only code changes count, not rule changes) and caches it per branch point in `.project-map/`.
- **Current** = your working tree, including uncommitted changes.
- Moved files keep their existing issues: issue paths of the base are mapped through git's rename detection, so
  moving a file that already had an issue doesn't count as "new".
- No git history (shallow CI clone) → the committed main map `docs/project-map.json` is used as base, with a note.
  No base at all → every `error` issue counts (like `--strict`).

### `npm run map:check`

Fails (exit 1) only on **new** `error` issues. `warn` issues never fail. Example on a branch that fixed one issue and
introduced another:

```
Rule check against main (branch point 5f4bfdda): 29 files.
  ✗ new: features/settings/settings-page/settings-page.component.ts imports features/orders/data-access/orders.service.ts
      features-are-isolated: Features must not import other features. Move shared code to shared/ or core/.
  ✓ fixed: features/customers/customer-list/customer-export.service.ts must be in core or features/*/data-access (services-placement)
  · 1 existing issue(s) on main, not blocking.
✗ 1 new rule issue introduced by this branch.
```

Success:
```
✓ No new rule issues. 1 fixed. 👍
```

`node scripts/project-map/generate-map.mjs --check --strict` fails on **every** `error` issue (for repositories that
are already clean and want to stay at zero).

### The branch report (`npm run map` → `.project-map/BRANCH_CHANGES.md`)

```
Branch `feature/demo` compared with `main` at the branch point `5f4bfdda`. Includes uncommitted changes.

Summary: 0 added · 1 moved · 0 deleted · 2 modified · rule issues: 1 new, 1 fixed, 1 existing

## New rule issues (fail map:check) (1)
## Fixed rule issues (1)
## Moved (1)
- features/customers/customer-list/customer-export.service.ts → features/customers/data-access/customer-export.service.ts
## Modified files (2)
## New dependencies between areas (1)
- features/settings → features/orders
```

Moves of a component with its companions are grouped into one line per folder:
`features/orders/ui/order-status-badge/ → shared/ui/order-status-badge/ (3 files: …)`.
If main has newer commits than your branch point, the report says so (`origin/main has 3 newer commits; merge or
rebase to get them`).

### The main map is never checked for staleness

On branches nobody updates `docs/`; CI regenerates it after each merge to main. So there's no "map out of date" error
anymore, and no merge conflicts on the map.

## A4. Where rule issues appear

- Terminal: `npm run map` and `npm run map:check`.
- `docs/PROJECT_MAP.md`: "Rules" and "Violations" sections (so Claude knows them in every session).
- Graph: red ring on the file bubble, "N issues" under folder names, total in the header, list in the side panel.
- Branch: `.project-map/BRANCH_CHANGES.md`, the session-start summary for Claude, `N new on branch` in the graph header,
  and new/fixed issues at the top of the graph's side panel.
- Move preview: "N rule issues on this file today. The map re-checks the rules after the move", and the toast
  after a move shows `issues before → after`.

## A5. Safety checks for file and folder moves

Before anything changes, the move engine refuses the move with a clear message when:

| Situation | Message |
|---|---|
| source doesn't exist | `Source not found: <path>` |
| target folder doesn't exist | `Target folder not found: <path>` |
| folder dropped into itself or its subfolder | `A folder cannot be moved into itself.` |
| folder already in that folder | `The folder is already there.` |
| file already in that folder | `The file is already in that folder.` |
| a file or folder with that name exists at the target | `<path> already exists.` |

What the move then guarantees:
- A file moves **with its companions** in the same folder (`x.component.ts` → `.html`, `.scss`, `.spec.ts`, …).
  A folder moves with everything inside.
- **Every import** that points to a moved file, or out of a moved file, is rewritten: relative imports,
  tsconfig path aliases, `export … from`, lazy `import()` in routes, `templateUrl`, `styleUrl`, `styleUrls`.
  Imports through `index.ts` keep pointing to the folder.
- When an import crosses into a folder that has a path alias, the alias is used (`@shared/…`).
- Tracked files move with `git mv` (history kept). Folders left empty are removed.
- The map is regenerated and the rules re-checked.

Warnings in the preview:
- `.scss` files with relative `@use`/`@import` paths: not rewritten, check them.

Undo (graph only, while the server runs) refuses when files were changed or the original location is taken again.
Git always works as the safety net: `git checkout . && git clean -fd` on a branch.

Recommended after a move (Claude does this in `/project-map move`): `npx tsc --noEmit -p tsconfig.app.json`.

## A6. Checks in the method-move analysis

The analysis uses the TypeScript compiler from your project (`node_modules/typescript`) with your tsconfig. It never
changes code.

| Check | How it's found | Result |
|---|---|---|
| Callers | TypeScript "find all references" on each method, across all `.ts` under `scanRoot` | listed with file, line and code |
| Template uses | text search for `.methodName(` in `.html` files | listed as `template` (text match: may include a same-named method of another object) |
| Test mocks | text search for `'methodName'` in `.spec.ts` (spy names, `createSpyObj`) | listed under test mocks (text match) |
| Helpers that move along | private methods used only by the moving methods (followed transitively) and not called from outside | moved automatically |
| Shared helper | a helper also used by methods that stay | **Decide** (or **Blocker** if it is private but referenced from outside) |
| State that moves along | fields used only by the moving methods | moved automatically |
| Shared state | a field (signal, subject, cache, counter …) also used by methods that stay | **Blocker**: splitting state can change behavior |
| Dependencies | `inject(X)` fields and constructor parameter properties used by the moving methods | "inject in target" / "already injected"; "no longer needed in source" if unused afterwards |
| Name clash | target already has a member with the same name | **Blocker** |
| Dependency direction | source still calls moved methods → source needs target; moving methods use members that stay → target needs source; plus existing injections | shown both ways |
| Circular dependency | both directions at once | **Blocker** |
| Input checks | source must contain an `@Injectable` class; methods must exist; target can't be the source; a new service name must be PascalCase ending in `Service`; the new file must not exist | refused with a message |

Blockers and decisions are written into the task as "STOP and ask me before deciding these". `/project-map move-methods`
always re-runs the analysis, asks you one question per decision, and doesn't edit while a blocker is open.

## A7. Exit codes

| Command | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `generate-map.mjs` (`npm run map`) | local map + branch report written | `root` folder not found | | |
| `generate-map.mjs --main` (`npm run map:main`) | main map written | `root` folder not found | | |
| `generate-map.mjs --check` (`npm run map:check`) | no new `error` issues | new `error` issues (with `--strict`: any) | | |
| `generate-map.mjs --session` (hook) | always (never breaks a session) | | | |
| `move-cli.mjs` | plan printed / move applied | move refused (see A5) | wrong usage | |
| `analyze-cli.mjs` | analysis without blockers | refused (bad input) | wrong usage | analysis has blockers |
| `install-hooks.mjs` (`npm run map:hooks`) | hooks installed/removed | `.claude/settings.json` is not valid JSON | | |

---

## B. Validate the installation with the sample app

`sample-app/` is a tiny Angular-shaped app (no Angular download needed; type stubs are included). It contains:
- 2 seeded structure issues: a feature importing another feature, and a service in the wrong folder
- `OrdersService` with methods to split: helpers, shared state, a template call and a test mock

All outputs below were produced with this exact sample.

### B1. Prepare (2 minutes)

```bash
cp -r project-map-kit/sample-app ~/pm-sample && cd ~/pm-sample
npm install                      # installs only TypeScript
git init -b main && git add -A && git commit -m "sample"
npm run typecheck                # must finish without errors
claude
```

### B2. Setup

```
/project-map setup
```

When Claude proposes the folder purposes and rules, keep the four template rules (`features-are-isolated`,
`shared-has-no-feature-deps`, `services-placement`, `no-components-in-core`) so your results match this guide.
Say yes to the automatic refresh; for CI choose "none" (the sample has no CI). Expected:

```
✓ Wrote the main map: docs/PROJECT_MAP.md and docs/project-map.json
  29 files · 7 routes · 7 areas · 2 violations
  ✗ features/orders/order-detail/order-detail.component.ts imports features/customers/ui/customer-avatar/customer-avatar.component.ts
    features-are-isolated: Features must not import other features. Move shared code to shared/ or core/.
  ✗ features/customers/customer-list/customer-export.service.ts must be in core or features/*/data-access
    services-placement: Services belong in core/ (app-wide) or features/<name>/data-access/.
```

and for the local map:
```
✓ Local map: .project-map/PROJECT_MAP.md  (29 files · 7 routes · 2 rule issues)
✓ Branch report: .project-map/BRANCH_CHANGES.md  (main vs main)
  0 added · 0 moved · 0 deleted · 0 modified · issues: 0 new, 0 fixed, 2 existing
```

Check: `scripts/project-map/` exists; `package.json` has `map`, `map:main`, `map:check`, `map:ui`, `map:hooks`;
`CLAUDE.md` contains `@docs/PROJECT_MAP.md`; `.claude/settings.json` has a `SessionStart` hook; `.git/hooks/post-checkout`
contains a `project-map` block; `git status` does **not** show `.project-map/`.

Commit the setup: `git add -A && git commit -m "setup project map"`.

### B3. The check on main: existing issues don't block

```bash
npm run map:check; echo "exit=$?"
```
Expected: `· 2 existing issue(s) on main, not blocking.`, `✓ No new rule issues.`, `exit=0`.

Strict mode lists them and fails:
```bash
node scripts/project-map/generate-map.mjs --check --strict; echo "exit=$?"
```
Expected: the 2 issues, `✗ 2 rule issues.`, `exit=1`.

### B4. The graph

```
/project-map ui
```
Open http://localhost:4321. Expected:
- header shows `29 files · 2 issues · 0 new on branch`; the side panel starts with the branch section (`Branch main vs main …`)
- `features/` shows `2 issues`; inside `customers/customer-list/` the file `customer-export.service` has a red ring
- click `features` → `customers`, drag `customer-export.service` onto `data-access/`
- preview: 1 file to move; 1 import `./customer-export.service` → `../data-access/customer-export.service`
- press **Move files**: toast `Moved 1 file · 1 import rewritten · issues 2 → 1`
- press **Undo**: header back to `2 issues`

### B5. Move a folder (with an alias)

```
/project-map move features/customers/ui/customer-avatar shared/ui
```
Expected dry run:
```
Would move 3 file(s):
  src/app/features/customers/ui/customer-avatar/customer-avatar.component.html → src/app/shared/ui/customer-avatar/…html
  src/app/features/customers/ui/customer-avatar/customer-avatar.component.spec.ts → …
  src/app/features/customers/ui/customer-avatar/customer-avatar.component.ts → …
Would rewrite 1 import(s):
  src/app/features/orders/order-detail/order-detail.component.ts:
    ../../customers/ui/customer-avatar/customer-avatar.component → @shared/ui/customer-avatar/customer-avatar.component
```
After Claude applies it: type check passes, the empty `features/customers/ui/` folder is gone, and `npm run map:check`
reports `✓ fixed: …features-are-isolated` and `✓ No new rule issues. 1 fixed. 👍`. Undo with `git checkout . && git clean -fd`
before B10.

### B6. Refusals

```bash
node scripts/project-map/move-cli.mjs features/orders features/orders/ui   # ✗ A folder cannot be moved into itself.
node scripts/project-map/move-cli.mjs nope.ts core                         # ✗ Source not found: nope.ts
```

### B7. Method-move analysis

In the graph: `features` → `orders` → `data-access` → click `orders.service` (it opens; 8 method bubbles, private
ones dashed). Click `exportCsv()` and `exportPdf()`, drag them onto the `data-access` breadcrumb, name the new service
`OrderExportService`, press **Show impact**. Expected:

- chips: `2 methods · 2 helpers move along · 2 call sites in 2 files · 1 test file · 1 blocker`
- Blocker: `State "cache" is read or written by moving methods and by refresh. Splitting it can change behavior.`
- moves along: `formatRow`, `formatMoney` (helpers), `exportCount` (state)
- target needs: `NotificationService` (no longer needed in OrdersService)
- callers: `order-list.component.ts:16` and the template `order-list.component.html:2`
- test mocks: `order-list.component.spec.ts`
- direction: `OrderExportService → OrdersService` (because of the shared state)

Same from the terminal:
```bash
node scripts/project-map/analyze-cli.mjs --source features/orders/data-access/orders.service.ts \
  --methods exportCsv,exportPdf --target-folder features/orders/data-access --class OrderExportService; echo "exit=$?"
```
Expected: the task text with "STOP and ask me before deciding these" and `exit=3`.

Circular dependency example:
```bash
node scripts/project-map/analyze-cli.mjs --source features/orders/data-access/orders.service.ts \
  --methods getOrder --target-file core/http/api-base.service.ts --json
```
Expected decisions: `decide: url() is also used by getOrders.` and
`blocker: OrdersService and ApiBaseService would depend on each other (circular dependency).`

Bad name:
```bash
node scripts/project-map/analyze-cli.mjs --source features/orders/data-access/orders.service.ts \
  --methods exportCsv --target-folder features/orders --class exporter
```
Expected: `✗ New service name must be PascalCase and end with "Service", e.g. OrderExportService.`

### B8. Let Claude do a method move (optional)

In the graph press **Copy task for Claude**, then in Claude Code:
```
/project-map move-methods <paste>
```
Expected behavior: Claude re-runs the analysis, shows a summary, **asks you how to handle `cache`** before editing.
After your answer: new branch, `OrderExportService` created, callers + template + spec updated, type check passes,
`npm run map:check` passes, summary of changed files.

### B9. Reset the sample

```bash
git checkout main && git reset --hard && git clean -fd
```

### B10. Branch workflow: report, new-issues check, session summary

```bash
git switch -c feature/demo                       # post-checkout hook refreshes .project-map/
node scripts/project-map/move-cli.mjs features/customers/customer-list/customer-export.service.ts features/customers/data-access --apply
npm run map:check; echo "exit=$?"
```
Expected: `✓ fixed: features/customers/customer-list/customer-export.service.ts …`, `· 1 existing issue(s) on main`,
`✓ No new rule issues. 1 fixed. 👍`, `exit=0`.

Now add a forbidden import (a feature using another feature):
```bash
sed -i.bak "1a import { OrdersService } from '../../orders/data-access/orders.service';" \
  src/app/features/settings/settings-page/settings-page.component.ts && rm -f src/app/features/settings/settings-page/*.bak
npm run map:check; echo "exit=$?"
cat .project-map/BRANCH_CHANGES.md
```
Expected: `✗ new: features/settings/settings-page/settings-page.component.ts imports features/orders/data-access/orders.service.ts`,
`✗ 1 new rule issue introduced by this branch.`, `exit=1`. The report shows `Summary: 0 added · 1 moved · 0 deleted ·
2 modified · rule issues: 1 new, 1 fixed, 1 existing` and `New dependencies between areas: features/settings → features/orders`.

What Claude gets at session start (the hook runs this):
```bash
node scripts/project-map/generate-map.mjs --session
```
Expected: `Branch feature/demo compared with main at branch point …`, `Changes on this branch: 0 files added, 1 moved, …`,
`Rule issues introduced by this branch: 1; fixed: 1; existing on main: 1.` In Claude Code, start a new session and ask
"what did this branch change?": Claude answers from that summary without running anything.

Simulate the merge and CI on main:
```bash
git checkout -- src/app/features/settings          # drop the forbidden import
git add -A && git commit -m "fix export service location"
git switch main && git merge --no-ff feature/demo -m "Merge feature/demo"
npm run map:main && git add docs && git commit -m "chore: update project map [skip ci]"   # what CI does
```
Expected: the main map now shows `1 violations`; `docs/` changed only on main, so other branches merge it without conflicts.

### Checklist

| # | Expected | ✓ |
|---|---|---|
| 1 | `/project-map` appears in Claude Code | |
| 2 | setup: main map `29 files · 7 routes · 7 areas · 2 violations`, local map + branch report, hooks | |
| 3 | `map:check` on main exits 0 (2 existing); `--strict` exits 1 | |
| 4 | graph opens, shows 2 issues, drag-move works, undo works | |
| 5 | folder move rewrites the import to `@shared/…`, type check passes | |
| 6 | after a fix `map:check` says `1 fixed` | |
| 7 | method preview shows 1 blocker (`cache`) and the template call | |
| 8 | `analyze-cli` exits 3; cycle example shows the circular-dependency blocker | |
| 9 | branch: a new forbidden import makes `map:check` exit 1, the report lists new/fixed issues and the move | |
| 10 | `--session` prints the branch summary; after the merge + `map:main` the main map shows 1 violation | |
