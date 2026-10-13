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
mkdir -p scripts/project-map
cp "<SKILL_DIR>/scripts/"* scripts/project-map/
```

If `scripts/project-map/` already existed, say "Tools updated" and show `git diff --stat scripts/project-map`.

## 3. Create `project-map.config.mjs` (only if it doesn't exist)

### Angular

Start from `<SKILL_DIR>/templates/project-map.config.mjs` and adapt it:

1. `root`: read `angular.json` → `projects.<name>.sourceRoot` (usually `src`) and use `<sourceRoot>/app`.
   If the workspace has several projects, ask which one.
2. `tsconfig`: `tsconfig.json` unless the path aliases are defined in another file.
3. List the folders under `root` (two levels). Write a short `purpose` for each top-level folder from what its code does.
   Remove template entries for folders that don't exist.
4. Keep only rules that fit the real structure. If the app uses another layout (`pages/`, `modules/`, `components/`
   instead of `features/`, `shared/`, `core/`), adapt the patterns.

### Spring Boot

Start from `<SKILL_DIR>/templates/project-map.config.spring.mjs` and adapt it:

1. Modules: list them (`<modules>` in `pom.xml`, `include` in `settings.gradle`, or every folder with its own
   `src/main/java`).
   - **One module**: `root` = the folder of the base package, i.e. the package of the `@SpringBootApplication` class,
     e.g. `src/main/java/com/acme/shop`. Paths then read like packages (`orders/OrderService.java`).
   - **Several modules**: `root: '.'`. Paths start with the module (`billing/src/main/java/com/acme/billing/...`);
     the map shows each module's package chain on one line. Use `units: ['*']` so each module is an area, and write
     rule patterns with `**` (e.g. `from: 'domain/**'`), or ask which module to map if only one matters.
2. Find the layout: list the packages under the base package (two levels) and count classes per kind
   (`node scripts/project-map/generate-map.mjs` after a first minimal config prints the map in `.project-map/`).
   - **Package by feature** (`orders/`, `customers/` each with controller, service, repository): keep the feature rules
     and replace the example feature names with the real ones.
   - **Package by layer** (`controller/`, `service/`, `repository/`, `domain/`): use the commented layer rules instead.
   - **Hexagonal** (`domain/`, `application/`, `adapter/in`, `adapter/out`): rules like "domain must not import adapter".
   The layer rules `controllers-use-services` and `controllers-return-dtos` work for every layout (they use kinds).
3. Write a short `purpose` for each top-level package from what its code does. Remove template entries that don't exist.

### Both

Show the proposed purposes and rules as a short list and ask the user to confirm or adjust before writing.
Write `framework: 'angular'` or `framework: 'spring'` in the config.

## 4. Commands

- **Angular**: add npm scripts:
  ```bash
  npm pkg set scripts.map="node scripts/project-map/generate-map.mjs" scripts.map:main="node scripts/project-map/generate-map.mjs --main" scripts.map:check="node scripts/project-map/generate-map.mjs --check" scripts.map:ui="node scripts/project-map/server.mjs" scripts.map:hooks="node scripts/project-map/install-hooks.mjs"
  ```
- **Spring Boot**: no `package.json`; everything is `node scripts/project-map/<tool>.mjs`. Don't add a package.json.

What they do: local map (`generate-map.mjs`) = local map + branch report in `.project-map/` (never committed);
`--main` = the committed main map in `docs/` (CI after merges; once now for setup); `--check` = fails only on rule
issues new compared with main; `server.mjs` = the graph; `install-hooks.mjs` = the automatic refresh.

## 5. CLAUDE.md

Read `<SKILL_DIR>/templates/claude-md-section.md` (Angular) or `<SKILL_DIR>/templates/claude-md-section-spring.md`
(Spring Boot). If `CLAUDE.md` has no `@docs/PROJECT_MAP.md` reference, append the section (create the file if needed).
If it already has an older "Project structure" section from this skill, replace that section with the new one.

## 6. First maps

1. `node scripts/project-map/generate-map.mjs --main` creates the main map in `docs/` (from now on only CI
   regenerates it). Report files, routes or endpoints, areas, and list every rule violation. Don't fix them now.
2. `node scripts/project-map/generate-map.mjs` creates the local map and the branch report in `.project-map/`
   (the folder ignores itself).

## 7. Automatic refresh (ask first)

Ask the user whether to install the automatic refresh, then run `node scripts/project-map/install-hooks.mjs`. It adds:
- a Claude Code SessionStart hook in `.claude/settings.json` (commit it to share): every session starts with a short
  summary of what the branch changed compared with main;
- git hooks (post-checkout, post-merge, post-rewrite) that refresh `.project-map/` after switching branches, pulling,
  merging or rebasing. Git hooks are local to this clone; each developer runs
  `node scripts/project-map/install-hooks.mjs --git` once.
If the repository uses husky (`core.hooksPath`), the script prints the line to add instead of writing hooks.

## 8. CI (ask which system)

Ask which CI the repository uses and copy the matching template from `<SKILL_DIR>/templates/ci/`:
- GitHub Actions: `github-actions.yml` → `.github/workflows/project-map.yml`
- Azure Pipelines: `azure-pipelines.yml` → `azure-pipelines-project-map.yml` (the user creates a pipeline from it, or
  merges the steps into an existing pipeline)
- GitLab: show `gitlab-ci.yml` and ask before appending it to `.gitlab-ci.yml`
Each template does two jobs: pull requests run the check (only new issues fail); builds of main regenerate the main
map and commit `docs/` with `[skip ci]`. They need only Node, no build. Tell the user: CI needs full git history
(already set in the templates) and permission to push to main (protected branches need an exception for the build
identity). In a Java repository the CI may run in a Maven/Gradle image: Node must be available there, or keep the
templates' own job with a Node image.

## 9. Finish

Tell the user briefly:
- Commit: `scripts/project-map/`, `project-map.config.mjs`, `docs/PROJECT_MAP.md`, `docs/project-map.json`,
  `CLAUDE.md`, for Angular `package.json`, and if added `.claude/settings.json` and the CI file. `.project-map/` stays local.
- Merge this to main first; from then on CI keeps the main map current.
- Each teammate: `node scripts/project-map/install-hooks.mjs --git` once per clone (or just run the local map when they
  want a fresh report).
- Open the graph: `/project-map ui` (or `node scripts/project-map/server.mjs`). It works offline: D3 is bundled.
