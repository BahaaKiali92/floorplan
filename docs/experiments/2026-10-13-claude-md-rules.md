# `/floorplan rules` on a real app (2026-10-13, Floorplan 1.0.0)

Repository: [gothinkster/angular-realworld-example-app](https://github.com/gothinkster/angular-realworld-example-app),
with `presets: ['angular-feature-sliced']` and a 17-line team CLAUDE.md written for the test (stack, seven code
conventions, two working-style rules). One convention deliberately contradicts the preset: "Feature services live in
`features/<feature>/services/`" (the preset says `data-access/`).

Run: `claude -p "/floorplan:floorplan rules" --plugin-dir <plugin>` (headless, Sonnet 5.5): **8 turns, $0.17, about
35 s.** Result: [the generated file](2026-10-13-realworld-floorplan.claude-rules.json).

| CLAUDE.md line | Became |
|---|---|
| 7 "standalone and OnPush" | `standalone-components` (pattern `standalone: false`) and `onpush` (requirePattern) |
| 8 "use `inject()`, never constructor injection" | `inject-function` (pattern on constructor parameter properties) |
| 9 "never use `any`" | `no-any` (pattern) |
| 10 "components never call `HttpClient`" | `no-httpclient-in-components` (pattern, components only) |
| 11 "no `console.log`" | `no-console-log` (pattern) |
| 12 "services in `features/<feature>/services/`" | `services-placement`, **replaces the preset's rule** (CLAUDE.md wins; config untouched) |
| 13 "models in `models/` or `core/models`" | `models-placement` (placement, model kind) |
| 4, 16, 17 (run tests, small PRs, ask before new dependencies) | `notCheckable`, with reasons |

All line numbers and quotes were right. The run then found 18 warnings: 17 constructor injections (the app predates
`inject()`; Claude opened one to confirm it was a real match) and `core/auth/user.model.ts` outside `core/models`.
No false positives on the other six checks. Claude didn't commit and suggested committing the rules file.

What this shows: the step is cheap enough to re-run whenever CLAUDE.md changes, and the split between "Claude
interprets CLAUDE.md once" and "the committed JSON is checked deterministically by CI and hooks" works.
