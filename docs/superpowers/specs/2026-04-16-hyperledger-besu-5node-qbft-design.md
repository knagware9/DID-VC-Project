# Hyperledger Besu 5-Node QBFT Network — Design Spec

**Date:** 2026-04-16
**Project:** DID-VC Platform
**Status:** Approved

---

## Overview

Replace the single Hardhat dev node with a 5-node Hyperledger Besu QBFT network running in Docker Compose. The network provides a permissioned, BFT-capable blockchain suitable for production-like demos. All five nodes act as validators; a one-shot deployer container uploads the smart contracts after the network is healthy, then the backend connects to it for all blockchain operations.

---

## 1. Network Architecture

**Nodes:** 5 validator nodes — `besu-node1` through `besu-node5`

**Image:** `hyperledger/besu:24.12`

**Consensus:** QBFT (Quorum Byzantine Fault Tolerant)
- Tolerates 1 Byzantine fault with 5 validators (`f = floor((5-1)/3) = 1`)
- 2-second block period
- Chain ID: 1337

**RPC endpoint:** Node 1 only (`besu-node1`) exposes port 8545 externally.  
Nodes 2–5 are P2P-only within the Docker network.

**Docker network:** All containers on a shared bridge network named `besu`.

**P2P ports:** Each node gets a unique P2P port (30303–30307) — internal only, not published to host.

---

## 2. Initialization Flow

Before `docker compose up`, the operator runs `scripts/init-besu-network.sh` once to generate all network artifacts:

```
scripts/init-besu-network.sh
  └── docker run besu operator generate-blockchain-config
        ├── besu/network/genesis.json          ← genesis with QBFT config + RLP extraData
        ├── besu/network/keys/node1/           ← key pair for node 1
        ├── besu/network/keys/node2/           ← key pair for node 2
        ├── besu/network/keys/node3/           ← ...
        ├── besu/network/keys/node4/
        └── besu/network/keys/node5/
  └── node scripts/generate-static-nodes.mjs
        └── besu/network/static-nodes.json     ← enode URLs using Docker service hostnames
```

`scripts/generate-static-nodes.mjs` reads each node's `key.pub` file, derives the enode URL using the Docker Compose service hostname (e.g. `besu-node1`) and the node's P2P port, and writes `static-nodes.json`.

The `besu/network/` directory is mounted read-only into each validator container. The `static-nodes.json` file is placed at the path Besu expects: the node's data directory.

**Important:** `scripts/init-besu-network.sh` is idempotent — if `besu/network/genesis.json` already exists, it exits early.

---

## 3. Contract Deployment

A sixth container, `besu-deployer`, runs after all 5 validator nodes are healthy:

```yaml
besu-deployer:
  depends_on:
    besu-node1: { condition: service_healthy }
    besu-node2: { condition: service_healthy }
    besu-node3: { condition: service_healthy }
    besu-node4: { condition: service_healthy }
    besu-node5: { condition: service_healthy }
```

It runs the existing `scripts/deploy-besu.cts` script (with a minor fix to use network `"besu"` in hardhat config instead of `"besuPrivate"`). On success it writes deployed contract addresses to `besu/deployed-addresses.json`, then exits with code 0.

The backend service depends on `besu-deployer` with `condition: service_completed_successfully`, ensuring it never starts before contracts are deployed.

**Pre-funded account:** The genesis file pre-funds the deployer's account (from `BESU_DEPLOYER_ADDRESS` in `.env`) with sufficient ETH. This is the account `deploy-besu.cts` uses.

---

## 4. Backend Integration

`src/blockchain/besu.ts` and `src/server/index.ts` need **no changes** — they already read `BESU_RPC_URL` and `BESU_PRIVATE_KEY` from environment, and fall back to demo/in-memory mode when those are unset.

`.env.example` additions:
```
BESU_RPC_URL=http://besu-node1:8545
BESU_PRIVATE_KEY=<deployer private key hex>
BESU_DEPLOYER_ADDRESS=<deployer address>
```

`docker-compose.yml` sets these vars for the backend service so it automatically connects to Node 1 when running in Docker.

---

## 5. Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `besu/qbft-config.json` | **Create** | Input to `besu operator generate-blockchain-config` — QBFT params, initial validators, pre-funded accounts |
| `scripts/init-besu-network.sh` | **Create** | One-shot init: generates genesis + key pairs + static-nodes.json |
| `scripts/generate-static-nodes.mjs` | **Create** | Node.js helper: reads key.pub files → writes static-nodes.json with enode URLs |
| `docker-compose.yml` | **Modify** | Replace single `besu` service with 5 validator nodes + `besu-deployer`; update backend deps and env vars |
| `scripts/deploy-besu.cts` | **Minor fix** | Change hardhat network name from `"besuPrivate"` to `"besu"` |
| `.env.example` | **Modify** | Add `BESU_RPC_URL`, `BESU_PRIVATE_KEY`, `BESU_DEPLOYER_ADDRESS`; remove old `BESU_NODE_URL` |
| `deploy.sh` | **Modify** | Call `scripts/init-besu-network.sh` before `docker compose up` |
| `.gitignore` | **Modify** | Ignore `besu/network/keys/` (private keys) and `besu/deployed-addresses.json` |

**No changes to:** `src/blockchain/besu.ts`, `src/server/index.ts`

---

## 6. Health Checks

Each Besu node container has a Docker health check:

```
curl -sf -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"net_peerCount","id":1}'
```

Interval: 5s, timeout: 3s, retries: 10, start period: 30s.

This ensures `besu-deployer` only runs once all 5 nodes are RPC-capable.

---

## 7. Gitignore Rules

```gitignore
# Besu generated network artifacts (private keys — never commit)
besu/network/keys/
besu/network/genesis.json

# Deployed contract addresses (generated at runtime)
besu/deployed-addresses.json
```

`besu/qbft-config.json` IS committed (it's input config, not a secret).  
`static-nodes.json` IS committed (it's derived from public keys).

---

## 8. Developer Workflow

**First time setup:**
```bash
./scripts/init-besu-network.sh   # generate genesis + keys
make deploy                      # build images, start all services, health check
```

**Subsequent starts:**
```bash
make up        # init-besu-network.sh is idempotent; deploy.sh calls it automatically
```

**No-besu demo mode:**
```bash
make deploy-no-besu   # skips all besu-* containers; backend runs in demo mode
```

---

## 9. Assumptions & Constraints

- Docker host has ≥ 4 GB RAM available (5 Besu nodes are lightweight in dev mode)
- `scripts/init-besu-network.sh` requires Docker to be running (uses a container for key generation)
- The deployer account is a well-known dev account (private key hardcoded in `.env.example` for local dev, must be rotated for production). Its address is pre-funded in `besu/qbft-config.json` under `alloc`. This is separate from the validator node keys (which are for block signing, not transactions).
- Chain ID 1337 matches the existing hardhat dev setup, so no contract ABI changes are needed
- The init script must be run on the host machine, not inside a container
