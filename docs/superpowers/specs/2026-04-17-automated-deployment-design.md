# Automated Deployment Design

**Date:** 2026-04-17
**Status:** Approved

---

## Goal

Replace the current multi-step first-time setup (manual Besu init + env file creation + deploy.sh) with a single `./setup.sh` command that works on a brand-new machine, in CI/CD pipelines, and on staging/production servers — with no prior manual steps required.

## Problem Statement

The current `deploy.sh` is a solid 80%-complete deployment script, but first-time setup is fragile:

- New developers must manually run `scripts/init-besu-network.sh`, create `.env` from `.env.example`, and then run `deploy.sh` — with no guidance if any step fails
- CI/CD pipelines have no structured entry point (interactive colored output, no machine-readable exit codes)
- Production setup has no automated prerequisites check or env validation

## Architecture

`setup.sh` replaces `deploy.sh` as the primary deployment entry point. It runs two phases in sequence, always:

```
setup.sh
 ├── Phase 1 — SETUP
 │    ├── 1a. Detect context         (local / CI / prod)
 │    ├── 1b. Check prerequisites    (Docker, Compose v2, Node ≥18, curl)
 │    ├── 1c. Create .env            (from .env.example or env vars)
 │    └── 1d. Initialize Besu network (idempotent)
 │
 └── Phase 2 — DEPLOY
      ├── 2a. Build images           (backend + frontend, parallel)
      ├── 2b. Start services         (docker compose up -d)
      ├── 2c. Wait for health        (per-service polling with live progress)
      └── 2d. Print summary          (URLs, next steps)
```

`Makefile` remains as a thin wrapper. `deploy.sh` is replaced by `setup.sh`.

---

## Phase 1 — Setup

### 1a. Context Detection

Context is determined once at startup and drives all subsequent behavior:

| Context | Trigger | Behavior |
|---------|---------|----------|
| `local` | Default | Colored output, interactive prompts, auto-install offered |
| `ci` | `CI=true` env var | Plain output, no prompts, strict env validation, structured exit codes |
| `production` | `DEPLOY_ENV=production` | No auto-install, requires `.env` to pre-exist, extra safety checks |

### 1b. Prerequisite Detection & Installation

Checks four tools in order. Failure behavior differs by context:

| Tool | Check Command | Local: missing | CI/Prod: missing |
|------|--------------|----------------|------------------|
| Docker daemon | `docker info` | Print install URL for detected OS, exit 1 | Exit code 1 with error message |
| Docker Compose v2 | `docker compose version` | Guide to Docker Desktop, exit 1 | Exit code 1 |
| Node.js ≥ 18 | `node --version` | Offer `brew install node` (macOS) or `nvm install 20` (Linux) | Exit code 1 |
| curl | `curl --version` | Auto-install via `brew` / `apt-get` | Exit code 1 |

Docker cannot be auto-installed (requires daemon + possible system restart). The script detects the OS (`uname`, `/etc/os-release`) and prints the exact install URL rather than failing cryptically mid-deployment.

Node.js installation is offered interactively on local. The script detects macOS vs Linux and offers the appropriate package manager command.

### 1c. Environment File Creation

Three behaviors based on context:

**Local mode:**
1. If `.env` does not exist: copy `.env.example` → `.env`
2. Open in `$EDITOR` if set, otherwise print: "`.env` created — edit it now, then press Enter to continue"
3. Validate required vars are non-empty after user confirms

**CI mode:**
1. Validate that all required env vars exist in the process environment
2. Write every key from `.env.example` that exists in the current environment to `.env` (keys not in the environment are written as empty, then the required-var check catches them)
3. Exit code 2 with a complete list of missing vars if any are absent

**Production mode:**
1. Require `.env` to already exist — never auto-create
2. Validate required vars
3. Warn on any vars still at their `.env.example` default values (e.g. `didvc_pass`)

**Required vars** (validated in all contexts):
- `DATABASE_URL` or (`POSTGRES_USER` + `POSTGRES_PASSWORD` + `POSTGRES_DB`)
- `BESU_PRIVATE_KEY`
- `BESU_CHAIN_ID`
- `JWT_SECRET` (if present in `.env.example`)

### `--no-besu` flag

When `--no-besu` is passed, Phase 1d (Besu init) is skipped entirely, and in Phase 2 the five `besu-node*` services and `besu-deployer` are excluded from `docker compose up`. The backend starts in demo mode (no blockchain connection). This is useful for frontend-only development or environments where Docker resources are constrained.

### 1d. Besu Network Initialization

Calls the existing `scripts/init-besu-network.sh`. Already fully idempotent — skips silently if `besu/network/genesis.json` is non-empty. Setup script:
1. Checks if init is needed (`[[ -s besu/network/genesis.json ]]`)
2. If yes: skip with "Besu network already initialized"
3. If no: run `scripts/init-besu-network.sh` with progress output
4. On failure: exit code 3, print last 20 lines of output

---

## Phase 2 — Deploy

### 2a. Parallel Image Builds

Backend and frontend images are built in parallel using background processes:

```bash
docker compose build backend &
docker compose build frontend &
wait
```

**`--skip-build` flag** skips this phase entirely for day-to-day restarts where code hasn't changed.

**`--no-cache` flag** passed through to `docker compose build` for clean rebuilds.

### 2b. Service Startup

```bash
docker compose up -d
```

Docker Compose health checks and `depends_on` conditions already enforce the correct startup order:
1. Besu nodes 1–5 (must all be healthy)
2. besu-deployer (must complete successfully)
3. PostgreSQL (must be healthy)
4. Backend (waits for postgres + deployer)
5. Frontend (waits for backend)

### 2c. Health Check Polling with Live Progress

The script polls each service independently and displays a live progress bar:

```
[1/5] Besu QBFT (5 nodes)   ████████░░  4/5 healthy (38s)
[2/5] Contract deployer      ✓ completed (45s)
[3/5] PostgreSQL             ✓ healthy (12s)
[4/5] Backend                ⠸ starting... (8s)
[5/5] Frontend               – pending
```

**Timeout:** Default 180 seconds per service, overridable via `SETUP_TIMEOUT=300 ./setup.sh`.

**On timeout or health failure:**
1. Print last 20 lines of the failing service's logs automatically
2. Exit with service-specific exit code (see Exit Codes below)
3. Local mode: suggest `./setup.sh --logs <service>` for deeper investigation

**In CI mode:** Progress uses plain-text lines (no ANSI, no cursor movement) suitable for log parsing.

### 2d. Final Summary

```
━━━ Stack is ready ━━━

  Frontend    →  http://localhost:3000
  Backend     →  http://localhost:3001
  PostgreSQL  →  localhost:5433
  Besu RPC    →  http://localhost:8545

  First time? Seed the database:  ./setup.sh --seed

  ./setup.sh --logs      tail all service logs
  ./setup.sh --down      stop everything
  ./setup.sh --status    quick health check
```

---

## Exit Codes

| Code | Phase | Meaning |
|------|-------|---------|
| `0` | — | All services healthy, stack ready |
| `1` | 1b | Prerequisite missing (Docker, Node, etc.) |
| `2` | 1c | Environment validation failed (missing required vars) |
| `3` | 1d | Besu network initialization failed |
| `4` | 2a | Docker image build failed |
| `5` | 2c | Besu nodes failed to become healthy |
| `6` | 2c | Contract deployer failed or exited non-zero |
| `7` | 2c | PostgreSQL failed to become healthy |
| `8` | 2c | Backend failed to become healthy |
| `9` | 2c | Frontend failed to become healthy |

The failing service name is always printed to stderr alongside the exit code.

---

## CLI Interface

```
Usage: ./setup.sh [OPTIONS]

Options:
  (none)           Full setup + deploy (first-time or clean rebuild)
  --skip-setup     Skip Phase 1 (prerequisites, env, Besu init) — deploy only
  --skip-build     Skip image builds — start existing images
  --down           Stop and remove all containers
  --logs [svc]     Tail logs (all services, or named service)
  --status         Print current health status of all services
  --seed           Seed the database after deploy
  --no-besu        Skip Besu nodes (run backend in demo mode)
  --prod           Enable production safety checks
  --help           Show this message

Environment variables:
  CI=true              Enable CI mode (no prompts, plain output)
  DEPLOY_ENV=          Set to 'production' for prod safety checks
  SETUP_TIMEOUT=180    Per-service health check timeout in seconds
```

---

## Makefile Targets

| Target | Calls | When to use |
|--------|-------|-------------|
| `make setup` | `./setup.sh` | First time on a new machine |
| `make up` | `./setup.sh --skip-setup` | Day-to-day restart |
| `make down` | `./setup.sh --down` | Stop everything |
| `make logs` | `./setup.sh --logs` | Tail all service logs |
| `make ci` | `CI=true ./setup.sh` | Test pipeline behavior locally |
| `make status` | `./setup.sh --status` | Quick health check |
| `make seed` | `./setup.sh --seed` | Seed database |

---

## CI/CD Integration

Example GitHub Actions job:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy full stack
        env:
          CI: true
          DEPLOY_ENV: staging
          BESU_PRIVATE_KEY: ${{ secrets.BESU_PRIVATE_KEY }}
          POSTGRES_USER: ${{ secrets.POSTGRES_USER }}
          POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}
          POSTGRES_DB: didvc
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
        run: ./setup.sh
```

Exit codes map directly to pipeline failure states — the job fails with a meaningful code that identifies exactly which phase broke.

---

## Files Changed

| File | Change |
|------|--------|
| `setup.sh` | New file — replaces `deploy.sh` as primary entry point |
| `deploy.sh` | Removed (functionality absorbed into `setup.sh`) |
| `Makefile` | Update all targets to call `setup.sh` instead of `deploy.sh` |

No changes to `docker-compose.yml`, `Dockerfile.*`, or application code.

---

## Out of Scope

- Zero-downtime rolling deploys (requires orchestrator like Kubernetes)
- Secrets management beyond `.env` files (Vault, AWS Secrets Manager, etc.)
- Multi-host / swarm deployments
- Windows native support (WSL2 is supported)
