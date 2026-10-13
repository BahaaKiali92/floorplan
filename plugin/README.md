# Floorplan

Keeps an Angular or Spring Boot codebase in shape when you work with Claude Code.

- **A map Claude reads for every task**: folders and their purpose, areas and their dependencies, routes or HTTP
  endpoints, and the rules (`docs/FLOORPLAN.md`, kept current by CI).
- **Rules**: built-in ones and presets (feature-sliced Angular, Nx, layered and hexagonal Spring Boot), plus **your
  own CLAUDE.md**: `/floorplan rules` turns the rules written there into checks. CLAUDE.md is the source of truth:
  its rules are reported as warnings, and where it contradicts a built-in rule, the built-in rule is switched off.
- **Clear issues**: every issue names the file and line, the rule and where it comes from (preset, config, or
  "CLAUDE.md:42" with the quote), why it matters, and how to fix it, including the command when there is one.
  Claude gets the same message right after it writes a file that breaks a rule.
- **A CI check that fails only on issues a branch introduces**, with a pull-request comment.
- **A bubble graph** to explore the app and move files, classes and packages by drag and drop (imports rewritten,
  `git mv`, undo), and a preview for moving methods between services.

## Install

```
/plugin marketplace add BahaaKiali92/floorplan
/plugin install floorplan@floorplan
```

Then, in an Angular or Spring Boot repository: `/floorplan setup`. Commands: `setup`, `update`, `rules`, `map`, `ui`,
`move`, `move-methods` (as plugin: `/floorplan:floorplan <command>`).

Cloud sessions (claude.ai/code) don't install plugins; `/floorplan setup` can commit the skill into the repository so
it works there too.

Requirements: Node 18+. Angular projects need `npm install` done; Spring Boot projects need no build. No network
access, no telemetry.

Documentation, examples and source: https://github.com/BahaaKiali92/floorplan · License: MIT
