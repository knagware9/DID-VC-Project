# Hyperledger Besu 5-Node QBFT Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single Hardhat dev node in docker-compose.yml with a 5-node Hyperledger Besu QBFT validator network, with a one-shot deployer container that deploys smart contracts and passes addresses to the backend.

**Architecture:** Five `hyperledger/besu:24.12` validator containers share a generated genesis file and per-node key pair (bind-mounted from `besu/network/`). A sixth `besu-deployer` container runs Hardhat against `besu-node1:8545` after all nodes are healthy, then exits; a named Docker volume (`besu_contracts`) passes the deployed addresses to the backend via a shell entrypoint. The backend's `depends_on` waits for `besu-deployer: condition: service_completed_successfully`.

**Tech Stack:** Hyperledger Besu 24.12, QBFT consensus, Docker Compose, Node.js 20, Hardhat, ethers v6, bash

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `besu/qbft-config.json` | **Create** | QBFT genesis config input for `besu operator generate-blockchain-config` |
| `.gitignore` | **Modify** | Exclude generated private keys and runtime addresses |
| `scripts/generate-static-nodes.mjs` | **Create** | Reads `besu/network/keys/*/key.pub` → writes `besu/network/static-nodes.json` |
| `scripts/init-besu-network.sh` | **Create** | One-shot: runs Besu config generator + calls generate-static-nodes.mjs; idempotent |
| `scripts/docker-entrypoint.sh` | **Create** | Backend container entrypoint: sources `/shared/addresses.env` before `node dist/server/index.js` |
| `Dockerfile.backend` | **Modify** | Copy and use docker-entrypoint.sh as ENTRYPOINT |
| `docker-compose.yml` | **Modify** | 5 Besu validator nodes + besu-deployer + updated backend; named volume `besu_contracts` |
| `scripts/deploy-besu.cts` | **No change needed** | Already writes `.env.blockchain`; deployer compose command copies it to shared volume |
| `.env.example` | **Modify** | Add `BESU_DEPLOYER_ADDRESS`, clarify RPC URL is container-internal |
| `deploy.sh` | **Modify** | Call `scripts/init-besu-network.sh` before `docker compose up` |

---

## Task 1: QBFT Genesis Config + .gitignore

**Files:**
- Create: `besu/qbft-config.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `besu/` directory and `qbft-config.json`**

```bash
mkdir -p /Users/kamleshnagware/did-vc-project/besu
```

Create `besu/qbft-config.json` with this exact content:

```json
{
  "genesis": {
    "config": {
      "chainId": 1337,
      "berlinBlock": 0,
      "londonBlock": 0,
      "qbft": {
        "blockperiodseconds": 2,
        "epochlength": 30000,
        "requesttimeoutseconds": 4
      }
    },
    "nonce": "0x0",
    "timestamp": "0x58ee40ba",
    "gasLimit": "0x1fffffffffffff",
    "difficulty": "0x1",
    "mixHash": "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
    "coinbase": "0x0000000000000000000000000000000000000000",
    "alloc": {
      "fe3b557e8fb62b89f4916b721be55ceb828dbd73": {
        "balance": "0xad78ebc5ac6200000"
      }
    }
  },
  "blockchain": {
    "nodes": {
      "generate": true,
      "count": 5
    }
  }
}
```

**Notes on fields:**
- `chainId: 1337` — matches existing hardhat.config.cts `besuPrivate` network; no ABI changes needed
- `berlinBlock: 0, londonBlock: 0` — enables EIP-1559 from block 0 (fine for private net)
- `blockperiodseconds: 2` — 2-second blocks
- `requesttimeoutseconds: 4` — must be > blockperiodseconds
- `alloc` address `fe3b557e8...` is the standard Besu dev pre-funded account (private key: `8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63`); no `0x` prefix in genesis alloc keys
- `0xad78ebc5ac6200000` = 200 ETH
- `mixHash` is the QBFT magic value
- `blockchain.nodes.generate: true, count: 5` tells `generate-blockchain-config` to create 5 validator key pairs

- [ ] **Step 2: Validate JSON syntax**

```bash
cd /Users/kamleshnagware/did-vc-project
node -e "JSON.parse(require('fs').readFileSync('besu/qbft-config.json','utf8')); console.log('JSON valid')"
```

Expected output:
```
JSON valid
```

- [ ] **Step 3: Update `.gitignore`**

Append to `/Users/kamleshnagware/did-vc-project/.gitignore`:

```gitignore

# Besu generated network artifacts — private keys must never be committed
besu/network/keys/
besu/network/genesis.json

# Deployed contract addresses — generated at runtime by besu-deployer
besu/deployed-addresses.json
.env.blockchain
```

Note: `besu/qbft-config.json` and `besu/network/static-nodes.json` ARE committed (they contain no secrets).

- [ ] **Step 4: Commit**

```bash
cd /Users/kamleshnagware/did-vc-project
git add besu/qbft-config.json .gitignore
git commit -m "feat(besu): add QBFT genesis config and gitignore rules"
```

---

## Task 2: generate-static-nodes.mjs

**Files:**
- Create: `scripts/generate-static-nodes.mjs`

This script runs on the host (not in a container) after `besu operator generate-blockchain-config` creates the key pairs. It reads each node's `key.pub` and generates enode URLs using Docker Compose service names as hostnames.

- [ ] **Step 1: Create `scripts/generate-static-nodes.mjs`**

```javascript
#!/usr/bin/env node
/**
 * generate-static-nodes.mjs
 * Reads besu/network/keys/<address>/key.pub files (sorted alphabetically)
 * and writes besu/network/static-nodes.json with enode URLs using
 * Docker Compose service hostnames (besu-node1 … besu-node5).
 *
 * Usage: node scripts/generate-static-nodes.mjs <network-dir>
 *   e.g: node scripts/generate-static-nodes.mjs ./besu/network
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const networkDir = resolve(process.argv[2] || '.');
const keysDir = join(networkDir, 'keys');

// List only directories (skip files), sort for deterministic ordering
const keyDirs = readdirSync(keysDir)
  .filter(entry => statSync(join(keysDir, entry)).isDirectory())
  .sort();

if (keyDirs.length === 0) {
  console.error(`[generate-static-nodes] No key directories found in ${keysDir}`);
  process.exit(1);
}

const P2P_PORT = 30303;

const enodes = keyDirs.map((dir, index) => {
  const pubKeyPath = join(keysDir, dir, 'key.pub');
  // key.pub may or may not have a leading 0x — strip it
  const pubKey = readFileSync(pubKeyPath, 'utf8').trim().replace(/^0x/, '');
  const host = `besu-node${index + 1}`;
  return `enode://${pubKey}@${host}:${P2P_PORT}`;
});

const outputPath = join(networkDir, 'static-nodes.json');
writeFileSync(outputPath, JSON.stringify(enodes, null, 2) + '\n');

console.log(`[generate-static-nodes] Written ${enodes.length} enodes to ${outputPath}`);
enodes.forEach(e => console.log(`  ${e.substring(0, 80)}...`));
```

- [ ] **Step 2: Make it executable and validate syntax**

```bash
cd /Users/kamleshnagware/did-vc-project
chmod +x scripts/generate-static-nodes.mjs
node --check scripts/generate-static-nodes.mjs
echo "Syntax OK"
```

Expected output:
```
Syntax OK
```

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-static-nodes.mjs
git commit -m "feat(besu): add generate-static-nodes helper script"
```

---

## Task 3: init-besu-network.sh

**Files:**
- Create: `scripts/init-besu-network.sh`

This is the one-shot initialization script. It:
1. Checks if `besu/network/genesis.json` exists — if so, exits early (idempotent)
2. Uses `docker run hyperledger/besu:24.12 operator generate-blockchain-config` to generate genesis + 5 key pairs into a temp dir
3. Moves the temp dir to `besu/network/`
4. Renames the numbered key directories from `0x<address>` format to `node1`…`node5` (sorted by address for determinism)
5. Calls `node scripts/generate-static-nodes.mjs besu/network` to generate `static-nodes.json`

- [ ] **Step 1: Create `scripts/init-besu-network.sh`**

```bash
#!/usr/bin/env bash
# =============================================================================
#  init-besu-network.sh — Initialize Hyperledger Besu 5-node QBFT network
# =============================================================================
#  Run this ONCE before `docker compose up`.
#  Idempotent: if besu/network/genesis.json already exists, exits with success.
#
#  Requires: docker, node (for generate-static-nodes.mjs)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NETWORK_DIR="$ROOT_DIR/besu/network"
CONFIG_FILE="$ROOT_DIR/besu/qbft-config.json"
TEMP_DIR="$ROOT_DIR/besu/.network-tmp"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RESET='\033[0m'
log()  { echo -e "${BLUE}[init-besu]${RESET} $*"; }
ok()   { echo -e "${GREEN}[init-besu] ✔${RESET} $*"; }
warn() { echo -e "${YELLOW}[init-besu] !${RESET} $*"; }

# ── Idempotency check ────────────────────────────────────────────────────────
# Use -s (non-empty) so empty placeholder files don't trigger a false positive
if [[ -s "$NETWORK_DIR/genesis.json" ]]; then
  warn "Network already initialized — delete besu/network/ to regenerate."
  exit 0
fi

log "Initializing Besu QBFT 5-node network..."

# ── Prerequisite checks ───────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "[init-besu] ✘ docker is required but not installed." >&2; exit 1
fi
if ! docker info &>/dev/null; then
  echo "[init-besu] ✘ Docker daemon is not running." >&2; exit 1
fi
if ! command -v node &>/dev/null; then
  echo "[init-besu] ✘ node is required but not installed." >&2; exit 1
fi

# ── Generate genesis + key pairs using Besu ──────────────────────────────────
log "Running besu operator generate-blockchain-config..."

# Clean up any previous failed attempt
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

docker run --rm \
  -v "$CONFIG_FILE:/config/qbft-config.json:ro" \
  -v "$TEMP_DIR:/output" \
  "hyperledger/besu:24.12" \
  operator generate-blockchain-config \
    --config-file=/config/qbft-config.json \
    --to=/output \
    --private-key-file-name=key

ok "Besu blockchain config generated"

# ── Fix permissions (Besu runs as root inside Docker) ───────────────────────
chmod -R a+r "$TEMP_DIR"

# ── Rename key directories from 0x<address> to node1…node5 ──────────────────
log "Renaming key directories to node1…node5 (sorted by address)..."

KEYS_DIR="$TEMP_DIR/keys"
i=1
# Sort alphabetically for determinism — same order as generate-static-nodes.mjs
for dir in $(ls "$KEYS_DIR" | sort); do
  if [[ -d "$KEYS_DIR/$dir" ]]; then
    mv "$KEYS_DIR/$dir" "$KEYS_DIR/node${i}"
    log "  $dir → node${i}"
    i=$((i + 1))
  fi
done

if [[ $((i - 1)) -ne 5 ]]; then
  echo "[init-besu] ✘ Expected 5 key directories, got $((i - 1))" >&2
  exit 1
fi

# ── Move to final location ────────────────────────────────────────────────────
# Remove existing dir (may have placeholder files from docker compose config validation)
rm -rf "$NETWORK_DIR"
mv "$TEMP_DIR" "$NETWORK_DIR"
ok "Network artifacts written to besu/network/"

# ── Generate static-nodes.json ────────────────────────────────────────────────
log "Generating static-nodes.json..."
node "$SCRIPT_DIR/generate-static-nodes.mjs" "$NETWORK_DIR"
ok "static-nodes.json created"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━ Besu network initialized ━━━${RESET}"
echo "  genesis.json    : besu/network/genesis.json"
echo "  node keys       : besu/network/keys/node{1..5}/key"
echo "  static-nodes    : besu/network/static-nodes.json"
echo ""
echo "Next step: docker compose up -d  (or: make up)"
echo ""
```

- [ ] **Step 2: Make it executable and validate bash syntax**

```bash
cd /Users/kamleshnagware/did-vc-project
chmod +x scripts/init-besu-network.sh
bash -n scripts/init-besu-network.sh
echo "Bash syntax OK"
```

Expected output:
```
Bash syntax OK
```

- [ ] **Step 3: Commit**

```bash
git add scripts/init-besu-network.sh
git commit -m "feat(besu): add network initialization script"
```

---

## Task 4: Backend Docker Entrypoint

**Files:**
- Create: `scripts/docker-entrypoint.sh`
- Modify: `Dockerfile.backend`

The backend needs `DID_REGISTRY_ADDRESS` and `VC_REGISTRY_ADDRESS` env vars to leave demo mode. The `besu-deployer` container writes these to a named Docker volume at `/shared/addresses.env`. This entrypoint sources that file before starting the server.

- [ ] **Step 1: Create `scripts/docker-entrypoint.sh`**

```bash
#!/bin/sh
# docker-entrypoint.sh — Backend container entrypoint
# Sources Besu contract addresses from the shared volume (written by besu-deployer)
# then hands off to the main server process.
set -e

ADDRESSES_FILE="/shared/addresses.env"

if [ -f "$ADDRESSES_FILE" ]; then
  echo "[entrypoint] Loading Besu contract addresses from $ADDRESSES_FILE"
  # set -a exports all sourced variables; set +a stops exporting
  set -a
  # shellcheck disable=SC1090
  . "$ADDRESSES_FILE"
  set +a
  echo "[entrypoint] DID_REGISTRY_ADDRESS=$DID_REGISTRY_ADDRESS"
  echo "[entrypoint] VC_REGISTRY_ADDRESS=$VC_REGISTRY_ADDRESS"
else
  echo "[entrypoint] $ADDRESSES_FILE not found — running in demo mode"
fi

exec "$@"
```

- [ ] **Step 2: Make it executable and validate shell syntax**

```bash
cd /Users/kamleshnagware/did-vc-project
chmod +x scripts/docker-entrypoint.sh
sh -n scripts/docker-entrypoint.sh
echo "Shell syntax OK"
```

Expected output:
```
Shell syntax OK
```

- [ ] **Step 3: Update `Dockerfile.backend`**

Read current `Dockerfile.backend`:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (including dev deps for build)
COPY package*.json ./
RUN npm install

# Copy sources and build
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist ./dist

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/server/index.js"]
```

Replace the entire second stage (from `FROM node:20-alpine` to end) with:

```dockerfile
FROM node:20-alpine
WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Entrypoint: sources /shared/addresses.env (Besu contract addresses) if present
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001
ENV NODE_ENV=production
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
```

- [ ] **Step 4: Verify Dockerfile syntax compiles (dry-run build check)**

```bash
cd /Users/kamleshnagware/did-vc-project
docker build --no-cache --target builder -f Dockerfile.backend . -t didvc-backend-check 2>&1 | tail -5
```

Expected: build completes the `builder` stage without error. (Full build is tested in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add scripts/docker-entrypoint.sh Dockerfile.backend
git commit -m "feat(besu): add backend entrypoint to source Besu contract addresses"
```

---

## Task 5: docker-compose.yml — 5-Node Besu Network

**Files:**
- Modify: `docker-compose.yml`

Replace the entire file with the new compose definition. All existing services (postgres, backend, frontend) are preserved; the single `besu` service is replaced with 5 validator nodes + `besu-deployer`.

- [ ] **Step 1: Write the new `docker-compose.yml`**

```yaml
services:

  # ── Hyperledger Besu QBFT Validators ──────────────────────────────────────
  # Run scripts/init-besu-network.sh ONCE before docker compose up.
  # Node 1 is the designated RPC endpoint (port 8545 published to host).
  # Nodes 2-5 are P2P-only within the Docker network.

  besu-node1:
    image: hyperledger/besu:24.12
    volumes:
      - ./besu/network/genesis.json:/config/genesis.json:ro
      - ./besu/network/keys/node1/key:/config/nodekey:ro
      - ./besu/network/static-nodes.json:/config/static-nodes.json:ro
      - besu_node1_data:/data
    command:
      - --data-path=/data
      - --genesis-file=/config/genesis.json
      - --node-private-key-file=/config/nodekey
      - --static-nodes-file=/config/static-nodes.json
      - --rpc-http-enabled=true
      - --rpc-http-host=0.0.0.0
      - --rpc-http-port=8545
      - --rpc-http-cors-origins=*
      - --rpc-http-api=ETH,NET,QBFT,WEB3,TXPOOL
      - --host-allowlist=*
      - --p2p-enabled=true
      - --p2p-host=0.0.0.0
      - --p2p-port=30303
      - --min-gas-price=0
      - --revert-reason-enabled=true
      - --logging=INFO
    ports:
      - "8545:8545"
    healthcheck:
      test:
        - "CMD-SHELL"
        - >
          curl -sf -X POST http://localhost:8545
          -H 'Content-Type: application/json'
          --data '{"jsonrpc":"2.0","method":"net_peerCount","id":1}'
          | grep -q '"result"'
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 60s
    restart: unless-stopped

  besu-node2:
    image: hyperledger/besu:24.12
    volumes:
      - ./besu/network/genesis.json:/config/genesis.json:ro
      - ./besu/network/keys/node2/key:/config/nodekey:ro
      - ./besu/network/static-nodes.json:/config/static-nodes.json:ro
      - besu_node2_data:/data
    command:
      - --data-path=/data
      - --genesis-file=/config/genesis.json
      - --node-private-key-file=/config/nodekey
      - --static-nodes-file=/config/static-nodes.json
      - --rpc-http-enabled=true
      - --rpc-http-host=0.0.0.0
      - --rpc-http-port=8545
      - --rpc-http-cors-origins=*
      - --rpc-http-api=ETH,NET,QBFT,WEB3,TXPOOL
      - --host-allowlist=*
      - --p2p-enabled=true
      - --p2p-host=0.0.0.0
      - --p2p-port=30303
      - --min-gas-price=0
      - --revert-reason-enabled=true
      - --logging=INFO
    healthcheck:
      test:
        - "CMD-SHELL"
        - >
          curl -sf -X POST http://localhost:8545
          -H 'Content-Type: application/json'
          --data '{"jsonrpc":"2.0","method":"net_peerCount","id":1}'
          | grep -q '"result"'
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 60s
    restart: unless-stopped

  besu-node3:
    image: hyperledger/besu:24.12
    volumes:
      - ./besu/network/genesis.json:/config/genesis.json:ro
      - ./besu/network/keys/node3/key:/config/nodekey:ro
      - ./besu/network/static-nodes.json:/config/static-nodes.json:ro
      - besu_node3_data:/data
    command:
      - --data-path=/data
      - --genesis-file=/config/genesis.json
      - --node-private-key-file=/config/nodekey
      - --static-nodes-file=/config/static-nodes.json
      - --rpc-http-enabled=true
      - --rpc-http-host=0.0.0.0
      - --rpc-http-port=8545
      - --rpc-http-cors-origins=*
      - --rpc-http-api=ETH,NET,QBFT,WEB3,TXPOOL
      - --host-allowlist=*
      - --p2p-enabled=true
      - --p2p-host=0.0.0.0
      - --p2p-port=30303
      - --min-gas-price=0
      - --revert-reason-enabled=true
      - --logging=INFO
    healthcheck:
      test:
        - "CMD-SHELL"
        - >
          curl -sf -X POST http://localhost:8545
          -H 'Content-Type: application/json'
          --data '{"jsonrpc":"2.0","method":"net_peerCount","id":1}'
          | grep -q '"result"'
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 60s
    restart: unless-stopped

  besu-node4:
    image: hyperledger/besu:24.12
    volumes:
      - ./besu/network/genesis.json:/config/genesis.json:ro
      - ./besu/network/keys/node4/key:/config/nodekey:ro
      - ./besu/network/static-nodes.json:/config/static-nodes.json:ro
      - besu_node4_data:/data
    command:
      - --data-path=/data
      - --genesis-file=/config/genesis.json
      - --node-private-key-file=/config/nodekey
      - --static-nodes-file=/config/static-nodes.json
      - --rpc-http-enabled=true
      - --rpc-http-host=0.0.0.0
      - --rpc-http-port=8545
      - --rpc-http-cors-origins=*
      - --rpc-http-api=ETH,NET,QBFT,WEB3,TXPOOL
      - --host-allowlist=*
      - --p2p-enabled=true
      - --p2p-host=0.0.0.0
      - --p2p-port=30303
      - --min-gas-price=0
      - --revert-reason-enabled=true
      - --logging=INFO
    healthcheck:
      test:
        - "CMD-SHELL"
        - >
          curl -sf -X POST http://localhost:8545
          -H 'Content-Type: application/json'
          --data '{"jsonrpc":"2.0","method":"net_peerCount","id":1}'
          | grep -q '"result"'
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 60s
    restart: unless-stopped

  besu-node5:
    image: hyperledger/besu:24.12
    volumes:
      - ./besu/network/genesis.json:/config/genesis.json:ro
      - ./besu/network/keys/node5/key:/config/nodekey:ro
      - ./besu/network/static-nodes.json:/config/static-nodes.json:ro
      - besu_node5_data:/data
    command:
      - --data-path=/data
      - --genesis-file=/config/genesis.json
      - --node-private-key-file=/config/nodekey
      - --static-nodes-file=/config/static-nodes.json
      - --rpc-http-enabled=true
      - --rpc-http-host=0.0.0.0
      - --rpc-http-port=8545
      - --rpc-http-cors-origins=*
      - --rpc-http-api=ETH,NET,QBFT,WEB3,TXPOOL
      - --host-allowlist=*
      - --p2p-enabled=true
      - --p2p-host=0.0.0.0
      - --p2p-port=30303
      - --min-gas-price=0
      - --revert-reason-enabled=true
      - --logging=INFO
    healthcheck:
      test:
        - "CMD-SHELL"
        - >
          curl -sf -X POST http://localhost:8545
          -H 'Content-Type: application/json'
          --data '{"jsonrpc":"2.0","method":"net_peerCount","id":1}'
          | grep -q '"result"'
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 60s
    restart: unless-stopped

  # ── Contract Deployer (one-shot) ───────────────────────────────────────────
  # Deploys DIDRegistry and VCRegistry after all 5 Besu nodes are healthy.
  # Writes contract addresses to /shared/addresses.env (named volume).
  # Exits with code 0 on success; backend waits for service_completed_successfully.
  besu-deployer:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - .:/app
      - besu_contracts:/shared
    environment:
      - BESU_RPC_URL=http://besu-node1:8545
      - BESU_PRIVATE_KEY=0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63
      - BESU_CHAIN_ID=1337
      - TS_NODE_PROJECT=tsconfig.hardhat.json
    command: >
      sh -c "
        echo '[deployer] Installing dependencies...' &&
        npm install --ignore-scripts 2>/dev/null &&
        echo '[deployer] Deploying contracts to besu-node1...' &&
        npx hardhat run scripts/deploy-besu.cts --network besuPrivate &&
        echo '[deployer] Copying addresses to shared volume...' &&
        cp .env.blockchain /shared/addresses.env &&
        echo '[deployer] Done — contract addresses available at /shared/addresses.env'
      "
    depends_on:
      besu-node1:
        condition: service_healthy
      besu-node2:
        condition: service_healthy
      besu-node3:
        condition: service_healthy
      besu-node4:
        condition: service_healthy
      besu-node5:
        condition: service_healthy
    restart: "no"

  # ── PostgreSQL ─────────────────────────────────────────────────────────────
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: didvc
      POSTGRES_USER: didvc_user
      POSTGRES_PASSWORD: didvc_pass
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U didvc_user -d didvc"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Backend ────────────────────────────────────────────────────────────────
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "${BACKEND_PORT:-3001}:3001"
    env_file:
      - .env
    environment:
      - PORT=3001
      - DATABASE_URL=postgresql://didvc_user:didvc_pass@postgres:5432/didvc
      - BESU_NETWORK=${BESU_NETWORK:-dev}
      - BESU_RPC_URL=http://besu-node1:8545
      - BESU_PRIVATE_KEY=0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63
      - BESU_CHAIN_ID=1337
      - BESU_EXPLORER_URL=${BESU_EXPLORER_URL:-}
    volumes:
      - besu_contracts:/shared
    depends_on:
      postgres:
        condition: service_healthy
      besu-deployer:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  # ── Frontend ───────────────────────────────────────────────────────────────
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "${FRONTEND_PORT:-3000}:80"
    env_file:
      - .env
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  postgres_data:
  besu_node1_data:
  besu_node2_data:
  besu_node3_data:
  besu_node4_data:
  besu_node5_data:
  besu_contracts:
```

- [ ] **Step 2: Validate compose syntax (requires besu/network/ to exist — init first if needed)**

The `docker compose config` command validates the YAML but will fail if referenced bind-mount files don't exist. Create placeholder files to allow validation:

```bash
cd /Users/kamleshnagware/did-vc-project

# Create placeholder network files so docker compose config can validate bind mounts
mkdir -p besu/network/keys/node{1,2,3,4,5}
touch besu/network/genesis.json
touch besu/network/static-nodes.json
for i in 1 2 3 4 5; do touch besu/network/keys/node${i}/key; done

docker compose config --quiet && echo "docker-compose.yml is valid"
```

Expected output:
```
docker-compose.yml is valid
```

Note: After validation, the placeholder files stay — they'll be overwritten by `init-besu-network.sh` with real content.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(besu): replace single Hardhat node with 5-node QBFT network in compose"
```

---

## Task 6: .env.example + deploy-besu.cts network name

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**

Replace the entire `# ── Hyperledger Besu Blockchain ──` section in `.env.example`. The current section starts at the line `# ── Hyperledger Besu Blockchain ──` and ends before the next blank section. Replace it with:

```bash
# ── Hyperledger Besu Blockchain ────────────────────────────────────────────────
#
# The platform now runs a 5-node QBFT Besu network via Docker Compose.
#
# FIRST-TIME SETUP:
#   1. Run: ./scripts/init-besu-network.sh    (generates genesis + key pairs)
#   2. Run: make deploy                        (starts all services + deploys contracts)
#
# The besu-deployer container automatically deploys DIDRegistry + VCRegistry
# after all 5 Besu nodes are healthy, then passes addresses to the backend
# via a shared Docker volume (/shared/addresses.env).
#
# DEMO MODE (no blockchain): make deploy-no-besu
#   Backend runs in-memory simulation. Sidebar shows "Demo Mode".
#
# Pre-funded dev account (DO NOT use in production):
#   Address     : 0xfe3b557e8fb62b89f4916b721be55ceb828dbd73
#   Private key : 0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63
#
BESU_NETWORK=dev
# When running via docker compose, the RPC URL is the internal container address:
# BESU_RPC_URL=http://besu-node1:8545
# When running the backend locally (outside Docker), point to the published port:
BESU_RPC_URL=http://localhost:8545
BESU_CHAIN_ID=1337

# Optional Blockscout explorer (e.g. http://localhost:4000)
BESU_EXPLORER_URL=

# Contract addresses — set automatically by besu-deployer in Docker;
# for local dev outside Docker, copy from .env.blockchain after npm run deploy:besu
DID_REGISTRY_ADDRESS=
VC_REGISTRY_ADDRESS=
```

- [ ] **Step 2: Validate .env.example has no leftover placeholder text**

```bash
cd /Users/kamleshnagware/did-vc-project
grep -n "TBD\|TODO\|fill in" .env.example || echo "No placeholders found"
```

Expected output:
```
No placeholders found
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(besu): update env.example for 5-node QBFT setup"
```

---

## Task 7: Update deploy.sh

**Files:**
- Modify: `deploy.sh`

Add a call to `scripts/init-besu-network.sh` before the `docker compose up` step, skipped when `--no-besu` is set.

- [ ] **Step 1: Find the insertion point in deploy.sh**

The current `deploy.sh` has this section at approximately line 200 (after "Tagging current images"):

```bash
# =============================================================================
#  BUILD DOCKER IMAGES
# =============================================================================
```

Insert the Besu init block BEFORE the build step.

- [ ] **Step 2: Add the Besu init block to deploy.sh**

Insert after line `step "Tagging current images as rollback targets"` block (after the `done` at approximately line 213) and before the `if ! $SKIP_BUILD; then` block:

```bash
# =============================================================================
#  BESU NETWORK INITIALIZATION (if needed)
# =============================================================================

if ! $NO_BESU; then
  if [[ ! -f "$SCRIPT_DIR/besu/network/genesis.json" ]]; then
    step "Initializing Besu QBFT network (first run)"
    bash "$SCRIPT_DIR/scripts/init-besu-network.sh"
    success "Besu network initialized"
  else
    log "Besu network already initialized — skipping init"
  fi
fi
```

The exact edit: In `deploy.sh`, find the block:

```bash
# =============================================================================
#  BUILD DOCKER IMAGES
# =============================================================================

if ! $SKIP_BUILD; then
```

And replace it with:

```bash
# =============================================================================
#  BESU NETWORK INITIALIZATION (if needed)
# =============================================================================

if ! $NO_BESU; then
  if [[ ! -f "$SCRIPT_DIR/besu/network/genesis.json" ]]; then
    step "Initializing Besu QBFT network (first run)"
    bash "$SCRIPT_DIR/scripts/init-besu-network.sh"
    success "Besu network initialized"
  else
    log "Besu network already initialized — skipping init"
  fi
fi

# =============================================================================
#  BUILD DOCKER IMAGES
# =============================================================================

if ! $SKIP_BUILD; then
```

- [ ] **Step 2: Also update the no-besu health check in deploy.sh**

The current deploy.sh `--no-besu` path starts `postgres backend frontend`. Update it to not depend on any `besu-*` services:

Find in deploy.sh (around line 233):
```bash
if $NO_BESU; then
  warn "Skipping Besu dev chain (--no-besu). Blockchain features will run in demo mode."
  COMPOSE_SERVICES="postgres backend frontend"
```

This is already correct — `backend` in `--no-besu` mode won't wait for `besu-deployer`. BUT the `docker-compose.yml` `backend.depends_on` now includes `besu-deployer: condition: service_completed_successfully`. When running with `--no-besu`, we start `backend` directly with `$COMPOSE_CMD up -d backend frontend` which bypasses the depends_on (since we're specifying services explicitly). This is fine.

However, we need to ensure the backend can start without the shared volume having `addresses.env`. The entrypoint already handles this gracefully: `if [ -f /shared/addresses.env ]; then ... fi`. So no changes needed here.

- [ ] **Step 3: Validate bash syntax of deploy.sh**

```bash
cd /Users/kamleshnagware/did-vc-project
bash -n deploy.sh
echo "deploy.sh syntax OK"
```

Expected:
```
deploy.sh syntax OK
```

- [ ] **Step 4: Commit**

```bash
git add deploy.sh
git commit -m "feat(besu): auto-init Besu QBFT network in deploy.sh before compose up"
```

---

## Task 8: Integration Test — Full Network Startup

This task runs the full stack end-to-end. It requires Docker with sufficient resources (≥4GB RAM recommended).

**Pre-condition:** Tasks 1–7 must be complete and committed.

- [ ] **Step 1: Run init-besu-network.sh**

```bash
cd /Users/kamleshnagware/did-vc-project
./scripts/init-besu-network.sh
```

Expected output (abbreviated):
```
[init-besu] Initializing Besu QBFT 5-node network...
[init-besu] Running besu operator generate-blockchain-config...
[init-besu] ✔ Besu blockchain config generated
[init-besu] Renaming key directories to node1…node5...
[init-besu]   0x<addr1> → node1
[init-besu]   0x<addr2> → node2
  ... (5 total)
[init-besu] ✔ Network artifacts written to besu/network/
[init-besu] Generating static-nodes.json...
[generate-static-nodes] Written 5 enodes to .../besu/network/static-nodes.json
  enode://...@besu-node1:30303...
  ... (5 total)
[init-besu] ✔ static-nodes.json created

━━━ Besu network initialized ━━━
```

- [ ] **Step 2: Verify generated file structure**

```bash
cd /Users/kamleshnagware/did-vc-project
echo "=== Genesis ===" && test -f besu/network/genesis.json && echo "✓ genesis.json exists"
echo "=== Keys ===" && ls besu/network/keys/
echo "=== Static nodes ===" && cat besu/network/static-nodes.json
```

Expected:
```
=== Genesis ===
✓ genesis.json exists
=== Keys ===
node1  node2  node3  node4  node5
=== Static nodes ===
[
  "enode://...@besu-node1:30303",
  "enode://...@besu-node2:30303",
  "enode://...@besu-node3:30303",
  "enode://...@besu-node4:30303",
  "enode://...@besu-node5:30303"
]
```

- [ ] **Step 3: Verify idempotency — run init again**

```bash
./scripts/init-besu-network.sh
```

Expected output:
```
[init-besu] ! Network already initialized — delete besu/network/ to regenerate.
```

- [ ] **Step 4: Pull the Besu image and start just the 5 nodes**

```bash
cd /Users/kamleshnagware/did-vc-project
docker compose pull besu-node1
docker compose up -d besu-node1 besu-node2 besu-node3 besu-node4 besu-node5
```

Wait 90 seconds for nodes to start and peer:

```bash
sleep 90
docker compose ps
```

Expected: All 5 besu-node containers show `healthy`.

- [ ] **Step 5: Verify peer count on node 1**

```bash
curl -sf -X POST http://localhost:8545 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"net_peerCount","id":1}'
```

Expected response (peers = 4, i.e., nodes 2-5):
```json
{"jsonrpc":"2.0","id":1,"result":"0x4"}
```

- [ ] **Step 6: Verify QBFT is producing blocks**

```bash
# Check block number is increasing
BLOCK1=$(curl -sf -X POST http://localhost:8545 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}' | jq -r .result)
sleep 5
BLOCK2=$(curl -sf -X POST http://localhost:8545 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}' | jq -r .result)
echo "Block 1: $BLOCK1, Block 2: $BLOCK2"
[[ "$BLOCK1" != "$BLOCK2" ]] && echo "✓ Blocks are being produced" || echo "✗ Block number did not change"
```

Expected:
```
Block 1: 0x2, Block 2: 0x4   (or similar increasing values)
✓ Blocks are being produced
```

- [ ] **Step 7: Run the full stack (deployer + backend + frontend)**

```bash
cd /Users/kamleshnagware/did-vc-project
docker compose up -d besu-deployer
```

Watch deployer logs:
```bash
docker compose logs -f besu-deployer
```

Expected output (deployer completes in ~60-90s):
```
[deployer] Installing dependencies...
[deployer] Deploying contracts to besu-node1...

━━━ Besu Contract Deployment ━━━
Network : unknown (chainId: 1337)
RPC     : http://besu-node1:8545
Deployer: 0xfe3b557e8fb62b89f4916b721be55ceb828dbd73
Balance : 200.0 ETH

Deploying DIDRegistry...
  ✓ DIDRegistry deployed: 0x<address>

Deploying VCRegistry...
  ✓ VCRegistry deployed: 0x<address>

  ✓ Addresses saved to .env.blockchain

[deployer] Copying addresses to shared volume...
[deployer] Done — contract addresses available at /shared/addresses.env
```

- [ ] **Step 8: Start backend and frontend**

```bash
docker compose up -d postgres backend frontend
```

Wait for backend health check:
```bash
sleep 15
curl -sf http://localhost:3001/health | jq .
```

Expected (blockchain.mode should be `live`, not `demo`):
```json
{
  "status": "ok",
  "blockchain": {
    "mode": "live",
    ...
  }
}
```

- [ ] **Step 9: Verify the backend entrypoint sourced addresses**

```bash
docker compose logs backend | grep -E "(entrypoint|DID_REGISTRY|VC_REGISTRY|demo mode)"
```

Expected:
```
[entrypoint] Loading Besu contract addresses from /shared/addresses.env
[entrypoint] DID_REGISTRY_ADDRESS=0x...
[entrypoint] VC_REGISTRY_ADDRESS=0x...
```

- [ ] **Step 10: Commit the generated static-nodes.json (safe to commit — public keys only)**

```bash
cd /Users/kamleshnagware/did-vc-project
git add besu/network/static-nodes.json
git commit -m "feat(besu): add generated static-nodes.json for 5-node QBFT network"
```

Note: `genesis.json` and `keys/` are in `.gitignore` and must NOT be committed.

- [ ] **Step 11: Tear down and verify clean state**

```bash
docker compose down -v   # -v removes volumes to reset contract state
```

Verify containers stopped:
```bash
docker compose ps
```

Expected: empty output (no running containers).

---

## Troubleshooting Reference

**Nodes never reach healthy:**
- Check logs: `docker compose logs besu-node1`
- Common cause: `static-nodes.json` has wrong enode format or hostnames
- Fix: verify `cat besu/network/static-nodes.json` shows `enode://<64-byte-hex>@besu-node1:30303`

**Deployer fails with "Deployer has 0 ETH":**
- The genesis alloc address doesn't match the `BESU_PRIVATE_KEY`
- Verify: `besu/qbft-config.json` alloc contains `fe3b557e8fb62b89f4916b721be55ceb828dbd73`

**Backend still in demo mode after deployer succeeds:**
- Check: `docker compose logs backend | grep entrypoint`
- Check: `docker compose exec backend ls /shared/`
- If `/shared/addresses.env` is missing, the deployer may have exited before writing it

**"key.pub not found" in generate-static-nodes.mjs:**
- The `besu operator generate-blockchain-config` may have used a different output structure
- Check: `ls besu/network/keys/node1/` — should contain `key` and `key.pub`
- If only `key` exists (no `key.pub`), add `--private-key-file-name key` to the generate-blockchain-config command AND check Besu 24.12 docs for the correct public key flag
