#!/bin/sh
# Build WASM binary and Go server for musicbox-web.
set -e

cd "$(dirname "$0")"
wasm-pack build --target web --out-dir www/pkg
go build -o bin/serve ./cmd/serve/
echo "Build complete."
