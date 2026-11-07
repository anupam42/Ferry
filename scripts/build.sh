#!/usr/bin/env bash
# Cross-compile ferry for all platforms into ./dist (needs bun: https://bun.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=${VERSION:-$(git describe --tags --always 2>/dev/null || echo 1.0.0)} bun scripts/build.ts "$@"
