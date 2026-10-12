# UI tests (Playwright, Python)

Browser tests of the bubble graph. They drive a real Chromium against the graph server running on a prepared
sample repository and save screenshots.

Requirements: `pip install playwright && playwright install chromium`.

```bash
# 1. prepare a sample repo with the tools (see tests/run.sh for the steps), commit it, then in that repo:
node scripts/project-map/server.mjs            # http://localhost:4321
# 2. from this folder:
python3 file_moves_test.py ./shots              # navigation, drag & drop, preview, move, undo, breadcrumb drop, pick-up move
python3 method_moves_test.py ./mshots           # open a service, select methods, new service dialog, impact preview
```

Expected output ends with `errors: []`. Look at the screenshots after UI changes.
Reset the sample repo between runs (`git reset --hard && git clean -fd src`), because the file test really moves files.
