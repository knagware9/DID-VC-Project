#!/usr/bin/env bash
# =============================================================================
#  init-besu-network.sh — Initialize Hyperledger Besu 5-node QBFT network
# =============================================================================
#  Run this ONCE before `docker compose up`.
#  Idempotent: if besu/network/genesis.json already exists and is non-empty,
#  exits with success. Delete besu/network/ to regenerate.
#
#  Requires: docker, node (for generate-static-nodes.mjs)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NETWORK_DIR="$ROOT_DIR/besu/network"
CONFIG_FILE="$ROOT_DIR/besu/qbft-config.json"
TEMP_DIR="$ROOT_DIR/besu/.network-tmp"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
log()   { echo -e "${BLUE}[init-besu]${RESET} $*"; }
ok()    { echo -e "${GREEN}[init-besu] ✔${RESET} $*"; }
warn()  { echo -e "${YELLOW}[init-besu] !${RESET} $*"; }
error() { echo -e "${RED}[init-besu] ✘${RESET} $*" >&2; }

# ── Idempotency check ──────────────────────────────────────────────────────────
# Use -s (non-empty file) to avoid false positive from empty placeholder files
if [[ -s "$NETWORK_DIR/genesis.json" ]]; then
  warn "Network already initialized — delete besu/network/ to regenerate."
  exit 0
fi

log "Initializing Besu QBFT 5-node network..."

# ── Prerequisite checks ────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  error "docker is required but not installed."; exit 1
fi
if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker and try again."; exit 1
fi
if ! command -v node &>/dev/null; then
  error "node is required but not installed."; exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  error "besu/qbft-config.json not found at $CONFIG_FILE"; exit 1
fi

# ── Generate genesis + key pairs using Besu ────────────────────────────────────
log "Running besu operator generate-blockchain-config..."

# Besu's besu-entry.sh entrypoint does a --print-paths-and-exit pre-run that
# creates the --to directory before the actual command, causing "already exists".
# Fix: bypass besu-entry.sh and call /opt/besu/bin/besu directly.
# Use a named (non-ephemeral) container so we can docker cp the output out.
INIT_CONTAINER="besu-qbft-init"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Remove any leftover container from a previous failed run
docker rm "$INIT_CONTAINER" 2>/dev/null || true

docker run \
  --name "$INIT_CONTAINER" \
  --entrypoint /opt/besu/bin/besu \
  -v "$CONFIG_FILE:/config/qbft-config.json:ro" \
  "hyperledger/besu:24.12.0" \
  operator generate-blockchain-config \
    --config-file=/config/qbft-config.json \
    --to=/besu-output \
    --private-key-file-name=key

# Copy output from container filesystem to host
docker cp "$INIT_CONTAINER:/besu-output/." "$TEMP_DIR/"
docker rm "$INIT_CONTAINER"

ok "Besu blockchain config generated"

# ── Fix permissions (Besu runs as root inside Docker) ──────────────────────────
chmod -R a+r "$TEMP_DIR"

# ── Verify expected output ─────────────────────────────────────────────────────
if [[ ! -f "$TEMP_DIR/genesis.json" ]]; then
  error "generate-blockchain-config did not produce genesis.json in $TEMP_DIR"
  error "Contents of $TEMP_DIR:"
  ls -la "$TEMP_DIR" >&2 || true
  exit 1
fi

KEYS_DIR="$TEMP_DIR/keys"
if [[ ! -d "$KEYS_DIR" ]]; then
  error "generate-blockchain-config did not produce a keys/ directory"
  exit 1
fi

# ── Rename key directories from 0x<address> to node1…node5 ───────────────────
log "Renaming key directories to node1…node5 (sorted by address)..."

i=1
while IFS= read -r dir; do
  if [[ -d "$KEYS_DIR/$dir" ]]; then
    mv "$KEYS_DIR/$dir" "$KEYS_DIR/node${i}"
    log "  $dir → node${i}"
    i=$((i + 1))
  fi
done < <(ls "$KEYS_DIR" | sort)

ACTUAL_COUNT=$((i - 1))
if [[ $ACTUAL_COUNT -ne 5 ]]; then
  error "Expected 5 key directories, found $ACTUAL_COUNT"
  exit 1
fi

ok "5 node key pairs renamed"

# ── Move to final location ─────────────────────────────────────────────────────
# Remove existing dir (may have placeholder files from docker compose config validation)
rm -rf "$NETWORK_DIR"
mv "$TEMP_DIR" "$NETWORK_DIR"
ok "Network artifacts written to besu/network/"

# ── Generate static-nodes.json ─────────────────────────────────────────────────
log "Generating static-nodes.json..."
node "$SCRIPT_DIR/generate-static-nodes.mjs" "$NETWORK_DIR"
ok "static-nodes.json created"

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━ Besu network initialized ━━━${RESET}"
echo "  genesis.json    : besu/network/genesis.json"
echo "  node keys       : besu/network/keys/node{1..5}/key"
echo "  static-nodes    : besu/network/static-nodes.json"
echo ""
echo "Next step: docker compose up -d  (or: make up)"
echo ""
