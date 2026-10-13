# Setup (once per repository)

Work from the project root (Angular: the folder with `angular.json`; Spring Boot: the folder with the root `pom.xml`,
`build.gradle` or `settings.gradle`). Report each step in one short line.

## 1. Check the project and pick the framework

- `node --version` must be 18 or newer (the tools need Node also in Java projects; no npm install, no build).
- **Angular**: `angular.json` exists, or `package.json` lists `@angular/core`.
  `node_modules/typescript` must exist (the method analysis uses the project's own TypeScript).
  If missing, ask the user to run `npm install` first and stop.
- **Spring Boot (Java)**: `pom.xml`, `build.gradle(.kts)` or `settings.gradle(.kts)` exists and there are `.java` files
  under `src/main/java`. Kotlin sources are not analyzed; say so if the project is mostly Kotlin.
- Neither: stop. This version supports Angular and Spring Boot (Java).

## 2. Copy the tools into the repository

They live in the repository so CI and teammates without the skill can run them.

```bash
mkdir -p scripts/floorplan
cp -r "<SKILL_DIR>/scripts/." scripts/floorplan/
```

If `scripts/floorplan/` already existed, follow `<SKILL_DIR>/reference/update.md` instead (keeps the config).

On Windows, if git then reports mode changes on files you didn't edit, the clone has `core.fileMode` on; suggest
`git config core.fileMode false` for that clone.

## 3. Create `floorplan.config.mjs` (only if it doesn't exist)

### Angular

Start from `<SKILL_DIR>/templates/floorplan.config.mjs` and adapt it:

1. `root`: read `angular.json` → `projects.<name>.sourceRoot` (usually `src`) and use `<sourceRoot>/app`.
   If the workspace has several projects, ask which one.
2. `tsconfig`: `tsconfig.json` unless the path aliases are defined in another file.
3. List the folders under `root` (two levels). Write a short `purpose` for each top-level folder from what its code does.
   Remove template entries for folders that don't exist.
4. Keep only rules that fit the real structure. If the app uses another layout (`pages/`, `modules/`, `components/`
   instead of `features/`, `shared/`, `core/`), adapt the patterns.
5. **Sheriff**: if `sheriff.config.ts` exists, Sheriff's module encapsulation and dependency rules are checked
   automatically (`sheriff: 'auto'`; needs `@softarc/sheriff-core` in `node_modules`). Then remove the template rules
   Sheriff already covers (`features-are-isolated`, `feature-public-api`, `shared-has-no-feature-deps`) and keep the
   ones it doesn't (placement, naming, one class per file). Without Sheriff, keep them; mention that Sheriff is the
   standard tool for this in Angular if the team wants module boundaries also in the editor (ESLint plugin).
   **ESLint**: if the ESLint config uses `eslint-plugin-boundaries`, `import/no-restricted-paths` or
   `no-restricted-imports`, those rules are read automatically (`eslint: 'auto'`; the plugins must be installed).
   With boundaries or no-restricted-paths, the preset's import rules are switched off (the map says so); tell the
   user their ESLint config stays the source of truth for import boundaries, and don't add the same rules to
   `floorplan.config.mjs`.
5b. **Where services live**: `services-placement` follows the project's own folder name (data-access, services,
   facades, …; see the map's Rules section after the first run). If the map says the project mixes names, show the
   counts and ask which one the team wants; then pin it: drop `convention` and set
   `allowedIn: ['core', 'features/*/<name>']`. Never rename folders for this without asking.
6. **Style-guide rules** (`file-names-kebab-case`, `one-angular-class-per-file`, `feature-public-api`, the commented
   `specs-next-to-code`): they start as warnings. Run a first map with them and show how many each finds; keep the
   ones the team wants.
7. **Component-scoped services**: a service listed in a component's `providers` and placed next to it is accepted by
   placement rules (`allowComponentScoped`, on by default). Folders with other intended exceptions: `except`.
8. Angular 20+ file names without suffixes (`user-profile.ts`) are fine: kinds come from the decorators then.

### Spring Boot

Start from `<SKILL_DIR>/templates/floorplan.config.spring.mjs` and adapt it:

1. Modules: list them (`<modules>` in `pom.xml`, `include` in `settings.gradle`, or every folder with its own
   `src/main/java`).
   - **One module**: `root` = the folder of the base package, i.e. the package of the `@SpringBootApplication` class,
     e.g. `src/main/java/com/acme/shop`. Paths then read like packages (`orders/OrderService.java`).
   - **Several modules**: `root: '.'`. Paths start with the module (`billing/src/main/java/com/acme/billing/...`);
     the map shows each module's package chain on one line. Use `units: ['*']` so each module is an area, and write
     rule patterns with `**` (e.g. `from: 'domain/**'`), or ask which module to map if only one matters.
2. Find the layout: list the packages under the base package (two levels) and count classes per kind
   (`node scripts/floorplan/generate-map.mjs` after a first minimal config prints the map in `.floorplan/`).
   - **Package by feature** (`orders/`, `customers/` each with controller, service, repository): keep the feature rules
     and replace the example feature names with the real ones.
   - **Package by layer** (`controller/`, `service/`, `repository/`, `domain/`): use the commented layer rules instead.
   - **Hexagonal** (`domain/`, `application/`, `adapter/in`, `adapter/out`): rules like "domain must not import adapter".
   The layer rules `controllers-use-services` and `controllers-return-dtos` work for every layout (they use kinds).
3. Write a short `purpose` for each top-level package from what its code does. Remove template entries that don't exist.

### Both

- **Where the main map goes**: `git check-ignore -q docs/FLOORPLAN.md` (exit 0 = ignored). If `docs/` is ignored,
  propose another tracked folder (e.g. `floorplan/`) and set `output.markdown` / `output.json` accordingly;
  otherwise the map never reaches teammates or CI. `--main` also warns about this.
- **CI**: ask now whether a CI job will regenerate the main map (step 8). Set `ci: true` or `ci: false` in the config;
  it decides the CLAUDE.md wording.
- **Preset**: if the layout matches one, start from it instead of the template rules (`presets: ['<name>']` in the
  config, the project's own rules on top): `angular-feature-sliced` (features/ + shared/ + core/), `angular-nx`
  (apps/ + libs/), `spring-layered` (controller → service → repository, by feature or by layer), `spring-hexagonal`
  (domain / application / adapter). Read `<SKILL_DIR>/scripts/presets/<name>.mjs` to list its rules for the user.
- **Count before choosing**: write the proposed config, run `node scripts/floorplan/generate-map.mjs --quiet`, count
  the `violations` per `rule` in `.floorplan/floorplan.json`, and show those numbers with the proposal. For a rule with many existing issues, propose one of: `severity: 'warn'`,
  `errorFrom: '<date>'` (warning now, error later), or a `budget` (the count may only go down). Interface-only imports
  are reported as warnings by default (`typeImports: 'warn'`); known, accepted exceptions go in `accepted` with a reason.
- Show the proposed purposes and rules as a short list and ask the user to confirm or adjust before writing.
- Write `framework: 'angular'` or `framework: 'spring'` in the config.

## 4. Commands

- **Angular**: add npm scripts:
  ```bash
  npm pkg set scripts.map="node scripts/floorplan/generate-map.mjs" scripts.map:main="node scripts/floorplan/generate-map.mjs --main" scripts.map:check="node scripts/floorplan/generate-map.mjs --check" scripts.map:ui="node scripts/floorplan/server.mjs" scripts.map:hooks="node scripts/floorplan/install-hooks.mjs"
  ```
- **Spring Boot**: no `package.json`; everything is `node scripts/floorplan/<tool>.mjs`. Don't add a package.json.

What they do: local map (`generate-map.mjs`) = local map + branch report in `.floorplan/` (never committed);
`--main` = the committed main map in `docs/` (CI after merges; once now for setup); `--check` = fails only on rule
issues new compared with main; `server.mjs` = the graph; `install-hooks.mjs` = the automatic refresh.

## 5. CLAUDE.md

Run `node scripts/floorplan/claude-md.mjs` (add `--no-ci` if there is no CI job for the map; `--print` to preview).
It writes the "Project structure" section for the framework, with the configured map path and the CI or no-CI
wording, keeps the file's line endings (CRLF on Windows), replaces its own or an older section from this skill, and
creates `CLAUDE.md` if needed. Don't write the section by hand.

## 5a. Rules from CLAUDE.md

If the project has a CLAUDE.md (or `.claude/rules/*.md`) with coding or structure rules, run the **rules** step now:
follow `<SKILL_DIR>/reference/rules.md`. CLAUDE.md is the source of truth: its rules become warnings, and where it
contradicts a template or preset rule, that rule is switched off. Skip it if CLAUDE.md has no such rules yet.

## 6. First maps

1. `node scripts/floorplan/generate-map.mjs --main` creates the main map in `docs/` (from now on only CI
   regenerates it). Report files, routes or endpoints, areas, and list every rule violation. Don't fix them now.
2. `node scripts/floorplan/generate-map.mjs` creates the local map and the branch report in `.floorplan/`
   (the folder ignores itself).

## 7. Automatic refresh (ask first)

Ask the user whether to install the automatic refresh, then run `node scripts/floorplan/install-hooks.mjs`. It adds:
- a Claude Code SessionStart hook in `.claude/settings.json` (commit it to share): every session starts with a short
  summary of what the branch changed compared with main;
- git hooks (post-checkout, post-merge, post-rewrite) that refresh `.floorplan/` after switching branches, pulling,
  merging or rebasing. Git hooks are local to this clone; each developer runs
  `node scripts/floorplan/install-hooks.mjs --git` once.
If the repository uses husky (`core.hooksPath`), the script prints the line to add instead of writing hooks.

## 8. CI (ask which system)

Ask which CI the repository uses and copy the matching template from `<SKILL_DIR>/templates/ci/`:
- GitHub Actions: `github-actions.yml` → `.github/workflows/floorplan.yml`
- Azure Pipelines: `azure-pipelines.yml` → `azure-pipelines-floorplan.yml` (the user creates a pipeline from it, or
  merges the steps into an existing pipeline)
- GitLab: show `gitlab-ci.yml` and ask before appending it to `.gitlab-ci.yml`
If the team has no CI for this: keep `ci: false` (step 3) and tell them who runs `--main` on main after merges.
Each template does two jobs: pull requests run the check (only new issues fail); builds of main regenerate the main
map and commit it with `[skip ci]` (if the map path isn't `docs/`, change the paths in the template). They need only Node, no build. Tell the user: CI needs full git history
(already set in the templates) and permission to push to main (protected branches need an exception for the build
identity). In a Java repository the CI may run in a Maven/Gradle image: Node must be available there, or keep the
templates' own job with a Node image.

## 8a. Cloud sessions (ask)

Claude Code cloud sessions (claude.ai/code, `claude --cloud`) don't install plugins, but they load skills committed to
the repository. Ask whether teammates use cloud sessions; if yes, copy the skill into the repository so `/floorplan`
works there without installing anything:

```bash
mkdir -p .claude/skills && cp -r "<SKILL_DIR>" .claude/skills/floorplan
```

`/floorplan update` refreshes that copy too. (The hooks in `.claude/settings.json` and the CLAUDE.md section work in
cloud sessions already. The graph needs a browser on the same machine, so in cloud sessions use the map and the
commands instead.)

## 9. Finish

Tell the user briefly:
- Commit: `scripts/floorplan/`, `floorplan.config.mjs`, `docs/FLOORPLAN.md`, `docs/floorplan.json`,
  `CLAUDE.md`, `floorplan.claude-rules.json` (if created), for Angular `package.json`, and if added
  `.claude/settings.json`, `.claude/skills/floorplan/` and the CI file. `.floorplan/` stays local.
- Merge this to main first; from then on CI keeps the main map current.
- Each teammate: `node scripts/floorplan/install-hooks.mjs --git` once per clone (or just run the local map when they
  want a fresh report).
- Open the graph: `/floorplan ui` (or `node scripts/floorplan/server.mjs`). It works offline: D3 is bundled.
