# UI tests (Playwright, Python)

Browser tests of the bubble graph. They drive a real Chromium against the graph server running on a prepared
sample repository and save screenshots.

Requirements: `pip install playwright && playwright install chromium`.

```bash
# 1. prepare a sample repo with the tools (see tests/run.sh for the steps), commit it, then in that repo:
node scripts/floorplan/server.mjs            # http://localhost:4321
# 2. from this folder:
python3 file_moves_test.py ./shots              # navigation, drag & drop, preview, move, undo, breadcrumb drop, pick-up move
python3 method_moves_test.py ./mshots           # open a service, select methods, new service dialog, impact preview
```

Expected output ends with `errors: []`. Look at the screenshots after UI changes.
Reset the sample repo between runs (`git reset --hard && git clean -fd src`), because the file test really moves files.

Spring Boot sample (`sample-spring-app/`, prepared the same way with `templates/floorplan.config.spring.mjs`):

```bash
node scripts/floorplan/server.mjs --port 4392   # in the prepared copy, on a branch
python3 spring_test.py ./sshots 4392              # overview, class move preview + move + undo, method-move preview
```

Rule issues panel, keyboard and image export (a sample-app copy with `presets: ['angular-feature-sliced']`):

```bash
node scripts/floorplan/server.mjs --port 4400
python3 issues_test.py ./ishots 4400              # filter by rule/severity, jump, Tab/Enter/Escape, "/", PNG + SVG
```

The page's Content-Security-Policy forbids eval, so tests poll instead of using `wait_for_function` with a string.
