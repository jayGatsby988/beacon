#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("Beacon checks require Node.js 24 (SQLite tests use node:sqlite)."); process.exit(1); }'
npm run typecheck
npm test
npm run lint --if-present
