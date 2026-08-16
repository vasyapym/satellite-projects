#!/usr/bin/env bash
# Builds the WASM core and commits artifacts into the satellite.
#   - JS glue + .d.ts  -> ./pkg          (imported by the client)
#   - .wasm binary     -> ../../../../public/bigbang_rust/  (served statically)
#
# Requires: rustup target add wasm32-unknown-unknown && cargo install wasm-pack
set -euo pipefail
cd "$(dirname "$0")"

wasm-pack build --release --target web --out-dir pkg

PUBLIC_DIR="../../../../public/bigbang_rust"
mkdir -p "$PUBLIC_DIR"
cp pkg/bigbang_rust_bg.wasm "$PUBLIC_DIR/bigbang_rust_bg.wasm"

echo "Built. Commit ./pkg and $PUBLIC_DIR/bigbang_rust_bg.wasm"
