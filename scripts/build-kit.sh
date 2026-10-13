#!/usr/bin/env bash
# Build dist/project-map-kit.zip: the package you copy to another laptop
# (README, docs, the skill, the plugin marketplace, the sample apps).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=dist/project-map-kit
rm -rf dist && mkdir -p "$OUT/skill" "$OUT/plugin-marketplace/.claude-plugin" "$OUT/plugin-marketplace/plugins"
cp README.md LICENSE CHANGELOG.md "$OUT/"
mkdir -p "$OUT/docs" && cp -r docs/img "$OUT/docs/"
cp -r docs "$OUT/"
cp -r plugin/skills/project-map "$OUT/skill/"
cp .claude-plugin/marketplace.json "$OUT/plugin-marketplace/.claude-plugin/"
sed -i.bak 's#"source": "./plugin"#"source": "./plugins/project-map"#' "$OUT/plugin-marketplace/.claude-plugin/marketplace.json" && rm -f "$OUT/plugin-marketplace/.claude-plugin/marketplace.json.bak"
cp -r plugin "$OUT/plugin-marketplace/plugins/project-map"
rsync -a --exclude node_modules --exclude .project-map --exclude docs --exclude scripts sample-app/ "$OUT/sample-app/" 2>/dev/null \
  || (mkdir -p "$OUT/sample-app" && cp -r sample-app/src sample-app/angular.json sample-app/package.json sample-app/tsconfig.json "$OUT/sample-app/")
cp -r sample-spring-app "$OUT/sample-spring-app"
cp -r tests/java-stubs "$OUT/java-stubs"
cp -r experiments "$OUT/experiments" && rm -rf "$OUT/experiments/results"
(cd dist && zip -qr project-map-kit.zip project-map-kit)
echo "✓ dist/project-map-kit.zip ($(du -h dist/project-map-kit.zip | cut -f1))"
