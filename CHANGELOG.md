# Changelog

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
