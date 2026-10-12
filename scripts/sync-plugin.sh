#!/usr/bin/env bash
# Copy the skill (source of truth: skill/project-map) into the plugin (plugin/skills/project-map).
# Run after every change to skill/. tests/run.sh fails if the two copies differ.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf plugin/skills/project-map
mkdir -p plugin/skills
cp -r skill/project-map plugin/skills/
echo "✓ plugin/skills/project-map synced from skill/project-map"
if command -v claude >/dev/null 2>&1; then
  claude plugin validate . | tail -1
else
  echo "· claude CLI not found: skipped 'claude plugin validate .'"
fi
