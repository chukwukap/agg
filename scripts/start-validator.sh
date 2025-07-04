#!/usr/bin/env bash
# -------------------------------------------------------------
# spin-up a fresh local Solana validator pre-loaded with all
# AMM programs required by the aggregator end-to-end tests.
# -------------------------------------------------------------
# Usage (from repo root):
#   pnpm validator          # foreground
#   pnpm test               # npm script spawns in background, runs mocha, kills
#
# Requires:  
#  • solana CLI >= v1.18 on $PATH  
#  • binaries/*.so present (see binaries/README.md)  
# -------------------------------------------------------------

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LEDGER="$SCRIPT_DIR/../.test-ledger"
BIN_DIR="$SCRIPT_DIR/../binaries"

# Program IDs (same as hard-coded in adapters)
LIFINITY="LfacfEjtujQTWBXZVzgkiPBw7Mt4guHSsmAi7y3cycL"
ORCA="whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
SOLAR_CP="sooGfSeXGtkLCPAMMpqkViwXxPxq8np5xpoEGoEsXXL"
SOLAR_CLMM="So11111111111111111111111111111111111111113"
INVARIANT="So11111111111111111111111111111111111111112"

# Build program-args array only for binaries that actually exist
ARGS=("--ledger" "$LEDGER" "--reset" "--quiet")

add_program() {
  local id=$1
  local file=$2
  if [[ -f "$file" ]]; then
    ARGS+=("--bpf-program" "$id" "$file")
  else
    echo "[WARN] binary missing: $file – skipping preload" >&2
  fi
}

add_program "$LIFINITY"   "$BIN_DIR/lifinity_v2.so"
add_program "$ORCA"       "$BIN_DIR/orca_whirlpool.so"
add_program "$SOLAR_CP"   "$BIN_DIR/solar_cp.so"
add_program "$SOLAR_CLMM" "$BIN_DIR/solar_clmm.so"
add_program "$INVARIANT"  "$BIN_DIR/invariant_clmm.so"

# ------------------------------------------------------------------
# 1. Build aggregator with e2e feature if binary absent or older.
# ------------------------------------------------------------------
AGG_SO="$SCRIPT_DIR/../target/deploy/aggregator.so"
AGG_ID="81VEHHWGikHo5wkBAPRZQUJs5LY5Yg5zrooifw27PbXt"

if [[ ! -f "$AGG_SO" ]]; then
  echo "[info] building aggregator with e2e feature…" >&2
  (cd "$SCRIPT_DIR/../" && anchor build -- --features e2e)
fi

add_program "$AGG_ID" "$AGG_SO"

# ------------------------------------------------------------------
# 2. Optionally clone real pool PDAs from mainnet for E2E tests.
#    Provide env vars or edit constants below.
# ------------------------------------------------------------------

# Skip cloning if SKIP_CLONES env var is set (useful when only
# testing with programs available locally, e.g. Whirlpool).
if [[ -z "${SKIP_CLONES:-}" ]]; then
  # Example public SOL/USDC Lifinity V2 whirlpool (mainnet):
  LIFI_WHIRL="D36zYmhG1CEV4VpWwfvX2VNfzQExgkt1PyfuzMdudH5K"
  LIFI_VA_TOKEN_A="7k3bDHK5mVsQt1zArhcXd1LSeX776BF3nfUSKCDrkguP"  # SOL vault
  LIFI_VA_TOKEN_B="77DpD6PEw24kTx5cHGNyEJD7BqXc9EwP6KDAdAm8YGtS"  # USDC vault

  # Orca Whirlpool SOL/USDC (tick_spacing = 8) – verified main-net PDA
  # See whirlpool-essentials docs for reference.
  ORCA_WHIRL="7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm"

  clone_account() {
    local acc=$1
    ARGS+=("--clone" "$acc")
  }

  clone_account "$LIFI_WHIRL"
  clone_account "$LIFI_VA_TOKEN_A"
  clone_account "$LIFI_VA_TOKEN_B"
  clone_account "$ORCA_WHIRL"

  # add url once
  ARGS+=("--url" "mainnet-beta")
else
  echo "[info] SKIP_CLONES set – skipping remote account clones" >&2
fi

# ensure we pass --url once if at least one clone requested
HAS_CLONES=1

# Finally start the validator
exec solana-test-validator "${ARGS[@]}" 