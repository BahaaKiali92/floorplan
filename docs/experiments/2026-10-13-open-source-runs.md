# Runs on open-source Angular repositories (2026-10-13, project-map 0.9.0)

Shallow clones, the tools copied in, one config per repository, `generate-map.mjs --main`. Times on the
development container (Node 22), first run without cache.

| Repository | Shape | Config | Files | Time | Result |
|---|---|---|---|---|---|
| [gothinkster/angular-realworld-example-app](https://github.com/gothinkster/angular-realworld-example-app) | standalone app, `features/` + `core/` + `shared/`, no path aliases | `presets: ['angular-feature-sliced']` | 40 | 0.2 s | 42 issues (see below) |
| [nrwl/nx-examples](https://github.com/nrwl/nx-examples) | Nx workspace, libraries as npm workspace packages with `exports` (no tsconfig paths) | `presets: ['angular-nx']` | 49 (`.ts`; the React parts are `.tsx`) | 0.1 s | 0 issues; 13 areas with their dependencies |
| [angular/components](https://github.com/angular/components) | large library repository (CDK, Material) | `root: 'src'`, areas per package, `noCycles`, CDK must not use Material, `maxSize`, `maxFanIn` | 897 (without tests and demo apps) / 2,147 (everything) | 0.5 s / 0.9 s (second run 0.3 s with the cache) | no cycles and no CDK → Material import (the project enforces both itself); 3 files over 1,500 lines, 4 hub files |

Spring Boot, same day:

| Repository | Config | Result |
|---|---|---|
| [spring-projects/spring-petclinic](https://github.com/spring-projects/spring-petclinic) | `presets: ['spring-layered']` | 5 controllers use repositories directly and 8 controller signatures use entities (petclinic does this on purpose, for brevity); no field injection, no proxy annotations on private methods, no cycles |
| [thombergs/buckpal](https://github.com/thombergs/buckpal) (hexagonal) | `presets: ['spring-hexagonal']` | layers and framework-free domain clean; 2 tests left in `application/domain` while their classes are in `application/domain/model` |

## RealWorld in detail

- 8 imports between `features/article` and `features/profile`; **5 of them bring in only interfaces** (detected as
  "types only", reported as warnings with `typeImports: 'warn'`). This matches the first company project, where about
  half of the cross-feature issues were interface-only.
- The 3 real ones form a cycle (`article → profile → article`); `noCycles` names the weakest link
  (`article.component.ts → follow-button.component.ts`).
- 4 services live in `features/*/services/` instead of `data-access/`: a naming convention difference, not a mistake.
  For this project you would set `allowedIn: ['core', 'features/*/services']`.
- 25 relative imports that climb 3–4 folders (`../../../core/...`); the project has no path aliases, so the rule only
  reports depth, not "use the alias".

## What changed because of these runs

- `orphanTests` for Java: first version reported every test not named after a class (8 in petclinic: integration and
  scenario tests). A Java test of a deleted class wouldn't compile anyway, so it now reports only tests whose class
  exists in another package (left behind by a move): 0 in petclinic, the 2 real ones in buckpal.

- `lazyBoundary`: a lazily loaded file outside the feature areas (here `core/auth/auth.component.ts`) no longer makes
  its whole folder "lazy"; only the file itself. Before, every use of `core/auth/services/user.service.ts` was reported.
- `relativeImports`: "across areas" is reported only when the project has path aliases to use instead.
- Workspace packages (npm / yarn / pnpm workspaces with `exports`, as current Nx uses) are resolved like tsconfig
  paths. Before, nx-examples showed no dependencies between libraries at all.
