#!/usr/bin/env bash
# Cross-compile ferry for all platforms into ./dist (no GoReleaser needed).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=${VERSION:-$(git describe --tags --always 2>/dev/null || echo 1.0.0)}
mkdir -p dist
for t in windows/amd64 windows/arm64 darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do
  os=${t%/*}; arch=${t#*/}; ext=""; [ "$os" = windows ] && ext=".exe"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -mod=vendor -trimpath \
    -ldflags="-s -w -X main.version=${VERSION#v}" -o "dist/ferry-$os-$arch$ext" .
  echo "built dist/ferry-$os-$arch$ext"
done
