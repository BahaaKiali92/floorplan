# Turn the project's CLAUDE.md rules into checks

CLAUDE.md is the team's source of truth. This step reads it and writes `floorplan.claude-rules.json` (repository root,
committed), which the generator, `map:check`, the edit hook, CI and the graph then check without you. Files that break
a CLAUDE.md rule get **warnings**; CLAUDE.md itself is never changed. Where CLAUDE.md contradicts a Floorplan rule
(preset, template or `floorplan.config.mjs`), the CLAUDE.md rule wins and the other rule is switched off.

## 1. Read the sources

Read every instruction file the project has, in this order, and keep the line numbers:
`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` (if committed), `.claude/rules/*.md`, CLAUDE.md files in
subfolders of the app (e.g. `src/app/CLAUDE.md`), and files they pull in with `@path` imports.
**Skip** the section between `<!-- floorplan:start` and `<!-- floorplan:end -->` (Floorplan writes it).

Also read `floorplan.config.mjs` (and its presets: `scripts/floorplan/presets/<name>.mjs`) and the root folder from
it, so rules you write use the same paths (patterns are relative to `root`) and you can see conflicts.

## 2. Classify every rule-like statement

For each statement that says what code must or must not do, pick one:

| The statement is about | Write |
|---|---|
| where files live ("services go in data-access", "DTOs in `dto/`") | `placement` (`files`, `kinds`, `allowedIn`) |
| what may import what ("features never import each other", "domain doesn't know adapters") | `noImport` (`from`, `to`, `allowSame`, `fromKinds`, `toKinds`) or `layers` |
| packages / APIs ("no moment.js", "never use `rxjs/internal`", "no `@Autowired` fields") | `noPackage` (`packages`) or `fieldInjection` / `proxyAnnotations` |
| file names ("kebab-case", "one component per file") | `naming` (`case` or `pattern`) / `oneDeclaration` |
| code text ("never use `any`", "no `console.log`", "use `inject()`, not constructor injection", "components use OnPush") | `pattern` (must not contain) or `requirePattern` (must contain), with `files`/`kinds` |
| tests next to code ("every component has a spec") | `companion` |
| sizes ("components under 300 lines") | `maxSize` (`maxLines`) |
| cycles, lazy features, aliases instead of `../../..` | `noCycles`, `lazyBoundary`, `relativeImports` |
| process, style of work, things only a reviewer can judge ("write tests first", "prefer readable code", "ask before adding dependencies") | not checkable: list it under `notCheckable` with a short reason |

Kinds: Angular `component, service, routes, guard, interceptor, resolver, pipe, directive, store, model, config, module`;
Spring `controller, service, repository, entity, dto, mapper, listener, config, component, application, exception`.
All rule options: `docs/2-VALIDATION.md` section A2 of the Floorplan repository, or the template config.

`pattern` / `requirePattern`: JavaScript regular expressions as JSON strings (escape backslashes), matched against the
file with comments removed. Make them precise; avoid patterns that also hit strings or names that merely contain the
word. Give `what` a human phrase (`"the any type"`) for the messages. Examples:

```json
{ "name": "no-any", "type": "pattern", "files": "**/*.ts", "pattern": ":\\s*any\\b|<any>|as any\\b", "what": "the any type" }
{ "name": "onpush", "type": "requirePattern", "kinds": ["component"], "pattern": "ChangeDetectionStrategy\\.OnPush", "what": "ChangeDetectionStrategy.OnPush" }
{ "name": "inject-function", "type": "pattern", "kinds": ["component", "service", "directive", "pipe"], "pattern": "constructor\\s*\\(\\s*(private|protected|public|readonly)\\b", "what": "constructor injection" }
```

## 3. Conflicts: CLAUDE.md wins

If a statement contradicts a Floorplan rule (e.g. CLAUDE.md: "services live in `features/*/services`", template rule
`services-placement` says `data-access`), write the CLAUDE.md version and put the contradicted rule's name in
`replaces`. Don't touch `floorplan.config.mjs`. A statement that agrees with an existing rule needs no new rule; you
may still add the existing rule's name to `confirms` so the user sees it is covered.

## 4. Write `floorplan.claude-rules.json`

```json
{
  "generatedBy": "/floorplan rules",
  "generatedAt": "2026-10-13",
  "sources": { "CLAUDE.md": "<hash>", ".claude/rules/angular.md": "<hash>" },
  "rules": [
    {
      "name": "no-any",
      "type": "pattern",
      "files": "**/*.ts",
      "pattern": ":\\s*any\\b|<any>|as any\\b",
      "what": "the any type",
      "message": "The project bans `any`.",
      "why": "Type errors should show at compile time.",
      "howToFix": "Use a real type, `unknown` plus a type guard, or a generic. For third-party gaps add a typed wrapper.",
      "source": { "file": "CLAUDE.md", "line": 42, "text": "Never use `any`." },
      "replaces": []
    }
  ],
  "notCheckable": [
    { "source": { "file": "CLAUDE.md", "line": 12, "text": "Write the test first." }, "reason": "about the way of working" }
  ]
}
```

- `name`: short kebab-case; the tools prefix it with `claude-md:`.
- `source.text`: the statement as written (shortened if long). `source.line`: its line number in that file.
- `message`: what is wrong, in one sentence. `howToFix`: concrete steps for this project (which function, folder or
  pattern to use instead). Both are shown next to every issue, so make them useful to someone who has never read
  CLAUDE.md.
- `sources`: every file you read, with its hash. Get the hashes with
  `node scripts/floorplan/claude-rules-hash.mjs <file> [<file> ...]` (prints the JSON object). The tools compare them
  later and say when CLAUDE.md changed.
- Don't set `severity`: CLAUDE.md rules are warnings (a team can make them errors with `claudeMdSeverity: 'error'` in
  the config).

## 5. Check and report

1. Run `node scripts/floorplan/generate-map.mjs` and read the CLAUDE.md issues (`rule: claude-md:…`).
2. Sanity-check each new rule: if a rule reports most files of its kind, or files where the statement clearly doesn't
   apply, the pattern is too broad. Narrow it (`files`, `kinds`, `except`, a tighter pattern) and run again.
3. Report to the user, briefly: how many statements became checks, which built-in rules CLAUDE.md replaced, what is
   not checkable (one line each), and the issue count per new rule with one example file:line.
4. Don't commit unless asked. Suggest committing `floorplan.claude-rules.json` so CI and teammates use the same rules.

Run this again whenever CLAUDE.md changes (the map, `map:check` and the session summary say so).
