# Automated Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `deploy.sh` with a single `setup.sh` that takes a brand-new machine from zero to a running full stack — blockchain, database, backend, and frontend — with one command, adapting to local dev, CI/CD, and production contexts.

**Architecture:** `setup.sh` runs two phases in sequence: Phase 1 (Setup) handles prerequisites, `.env` creation, and Besu network init; Phase 2 (Deploy) builds images in parallel, starts services, and polls each service with live progress output. Context (`local` / `ci` / `production`) is detected once at startup and drives all interactive vs. non-interactive decisions. Structured exit codes 1–9 map to each failure point for CI pipeline integration.

**Tech Stack:** Bash 5+, Docker Compose v2, Node.js ≥ 18, curl. No new runtime dependencies.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `setup.sh` | **Create** | Single entry point — all setup + deploy logic |
| `deploy.sh` | **Delete** | Replaced entirely by `setup.sh` |
| `Makefile` | **Modify** | Update all targets to call `setup.sh`; add new targets from spec |

No changes to `docker-compose.yml`, `Dockerfile.*`, or application source.

---

## Task 1: Script scaffold — flags, context, colours, simple commands

**Files:**
- Create: `setup.sh`

- [ ] **Step 1: Create `setup.sh` with shebang, colour vars, logging helpers, defaults, and argument parser**

```bash
#!/usr/bin/env bash
# =============================================================================
#  setup.sh — DID-VC Platform — full lifecycle automation
# =============================================================================
#
#  Usage:
#    ./setup.sh                   # Full setup + deploy (first-time or clean rebuild)
#    ./setup.sh --skip-setup      # Skip Phase 1 — deploy only (day-to-day)
#    ./setup.sh --skip-build      # Skip image builds — start existing images
#    ./setup.sh --seed            # Seed the database after deploy
#    ./setup.sh --no-besu         # Skip Besu; backend runs in demo mode
#    ./setup.sh --prod            # Production safety checks
#    ./setup.sh --rollback        # Roll back to previous Docker images
#    ./setup.sh --down            # Stop and remove all containers
#    ./setup.sh --status          # Show service status
#    ./setup.sh --logs [service]  # Tail logs (all or named service)
#
#  Environment variables:
#    CI=true              CI mode — no prompts, plain output, strict validation
#    DEPLOY_ENV=production  Production mode — .env must pre-exist
#    SETUP_TIMEOUT=180    Per-service health check timeout (seconds)
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colours (disabled in CI) ──────────────────────────────────────────────────
if [[ "${CI:-}" == "true" ]]; then
  RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; RESET=''
else
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
fi

log()     { echo -e "${BLUE}[setup]${RESET}  $*"; }
success() { echo -e "${GREEN}[✔]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET}  $*"; }
error()   { echo -e "${RED}[✘]${RESET}  $*" >&2; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${RESET}"; }
divider() { echo -e "${CYAN}──────────────────────────────────────────────────${RESET}"; }

# ── Context detection ─────────────────────────────────────────────────────────
CONTEXT="local"
[[ "${CI:-}"          == "true"       ]] && CONTEXT="ci"
[[ "${DEPLOY_ENV:-}"  == "production" ]] && CONTEXT="production"

# ── Defaults ──────────────────────────────────────────────────────────────────
SKIP_SETUP=false
SKIP_BUILD=false
WITH_SEED=false
NO_BESU=false
PROD_MODE=false
ROLLBACK=false
CMD_DOWN=false
CMD_STATUS=false
CMD_LOGS=false
LOGS_SERVICE=""
TIMEOUT="${SETUP_TIMEOUT:-180}"
BACKEND_PORT="3001"
FRONTEND_PORT="3000"

# ── Argument parser ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-setup) SKIP_SETUP=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --seed)       WITH_SEED=true ;;
    --no-besu)    NO_BESU=true ;;
    --prod)       PROD_MODE=true; CONTEXT="production" ;;
    --rollback)   ROLLBACK=true ;;
    --down)       CMD_DOWN=true ;;
    --status)     CMD_STATUS=true ;;
    --logs)       CMD_LOGS=true; shift; LOGS_SERVICE="${1:-}" ;;
    -h|--help)
      sed -n '/^#  Usage:/,/^# ====/p' "$0" | grep -v "^# ====" | sed 's/^#  *//'
      exit 0
      ;;
    *)
      error "Unknown option: $1  (use --help for usage)"
      exit 1
      ;;
  esac
  shift
done

# ── Banner ────────────────────────────────────────────────────────────────────
divider
echo -e "${BOLD}  DID-VC Platform — Setup & Deploy${RESET}"
echo -e "  $(date '+%Y-%m-%d %H:%M:%S')  |  Context: ${CONTEXT}"
divider

# =============================================================================
#  SIMPLE COMMANDS
# =============================================================================

if $CMD_DOWN; then
  step "Stopping all services"
  docker compose down
  success "All containers stopped."
  exit 0
fi

if $CMD_STATUS; then
  step "Service status"
  docker compose ps
  exit 0
fi

if $CMD_LOGS; then
  if [[ -n "$LOGS_SERVICE" ]]; then
    docker compose logs -f "$LOGS_SERVICE"
  else
    docker compose logs -f
  fi
  exit 0
fi

if $ROLLBACK; then
  step "Rolling back to previous images"
  for svc in backend frontend; do
    if docker image inspect "${svc}-previous" &>/dev/null; then
      log "Restoring ${svc} from ${svc}-previous"
      docker compose stop "$svc"
      docker tag "${svc}-previous" "did-vc-project-${svc}:latest" 2>/dev/null || true
      docker compose up -d "$svc"
      success "${svc} rolled back."
    else
      warn "No previous image for ${svc} — skipping."
    fi
  done
  docker compose ps
  exit 0
fi

# =============================================================================
#  PHASE 1 — SETUP   (skipped with --skip-setup)
# =============================================================================

check_prerequisites() { : ; }  # implemented in Task 2
setup_env()           { : ; }  # implemented in Task 3
init_besu()           { : ; }  # implemented in Task 4

# =============================================================================
#  PHASE 2 — DEPLOY
# =============================================================================

build_images()     { : ; }  # implemented in Task 4
start_services()   { : ; }  # implemented in Task 5
wait_for_stack()   { : ; }  # implemented in Task 5
seed_database()    { : ; }  # implemented in Task 6
print_summary()    { : ; }  # implemented in Task 6

# =============================================================================
#  MAIN
# =============================================================================

main() {
  if ! $SKIP_SETUP; then
    check_prerequisites
    setup_env
    init_besu
  fi

  build_images
  start_services
  wait_for_stack

  if $WITH_SEED; then
    seed_database
  fi

  print_summary
}

main
```

- [ ] **Step 2: Make executable and verify the scaffold runs**

```bash
chmod +x setup.sh
./setup.sh --help
```

Expected output: prints the Usage block from the script header, exits 0.

```bash
./setup.sh --down
```

Expected: "Stopping all services" step, exits 0 (even if nothing is running — `docker compose down` is a no-op in that case).

```bash
./setup.sh --status
```

Expected: prints `docker compose ps` output (may be empty), exits 0.

- [ ] **Step 3: Commit the scaffold**

```bash
git add setup.sh
git commit -m "feat(setup): scaffold setup.sh with flags, context, and simple commands"
```

---

## Task 2: Phase 1b — Prerequisite detection with OS-aware install hints

**Files:**
- Modify: `setup.sh` — replace `check_prerequisites() { : ; }` stub

- [ ] **Step 1: Replace the `check_prerequisites` stub with the full implementation**

Replace the line `check_prerequisites() { : ; }  # implemented in Task 2` with:

```bash
check_prerequisites() {
  step "Checking prerequisites"

  # Detect OS for install hints
  local os="unknown"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    os="macos"
  elif [[ -f /etc/os-release ]]; then
    os=$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr '[:upper:]' '[:lower:]')
  fi

  # ── Docker ──────────────────────────────────────────────────────────────────
  if ! command -v docker &>/dev/null; then
    error "Docker is not installed."
    case "$os" in
      macos)         error "  Install: https://docs.docker.com/desktop/mac/install/" ;;
      ubuntu|debian) error "  Install: https://docs.docker.com/engine/install/ubuntu/" ;;
      *)             error "  Install: https://docs.docker.com/get-docker/" ;;
    esac
    exit 1
  fi
  if ! docker info &>/dev/null; then
    error "Docker daemon is not running."
    [[ "$os" == "macos" ]] && error "  Open Docker Desktop and wait for it to start."
    exit 1
  fi
  success "Docker: $(docker --version | awk '{print $3}' | tr -d ',')"

  # ── Docker Compose v2 ────────────────────────────────────────────────────────
  if ! docker compose version &>/dev/null; then
    error "Docker Compose v2 is required ('docker compose', not 'docker-compose')."
    error "  It ships with Docker Desktop >= 3.x. Update Docker or install the plugin:"
    error "  https://docs.docker.com/compose/install/"
    exit 1
  fi
  success "Docker Compose: $(docker compose version --short 2>/dev/null || docker compose version | head -1)"

  # ── Node.js >= 18 ────────────────────────────────────────────────────────────
  if ! command -v node &>/dev/null; then
    if [[ "$CONTEXT" == "local" ]]; then
      warn "Node.js not found (needed by the Besu contract deployer)."
      case "$os" in
        macos)         warn "  Install: brew install node@20" ;;
        ubuntu|debian) warn "  Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
        *)             warn "  Install: https://nodejs.org/en/download/" ;;
      esac
      warn "  After installing Node, re-run: ./setup.sh"
      exit 1
    else
      error "Node.js >= 18 is required."
      exit 1
    fi
  fi
  local node_major
  node_major=$(node --version | tr -d 'v' | cut -d. -f1)
  if [[ "$node_major" -lt 18 ]]; then
    error "Node.js >= 18 required, found $(node --version)."
    error "  Update: https://nodejs.org/en/download/"
    exit 1
  fi
  success "Node.js: $(node --version)"

  # ── curl ─────────────────────────────────────────────────────────────────────
  if ! command -v curl &>/dev/null; then
    if [[ "$CONTEXT" == "local" ]]; then
      warn "curl not found — attempting to install..."
      case "$os" in
        macos)         brew install curl && success "curl installed" ;;
        ubuntu|debian) sudo apt-get install -y curl && success "curl installed" ;;
        *)             error "curl is required. Install it and retry."; exit 1 ;;
      esac
    else
      error "curl is required but not installed."; exit 1
    fi
  fi
  success "curl: $(curl --version | head -1 | awk '{print $2}')"
}
```

- [ ] **Step 2: Verify prerequisites check passes on the current machine**

```bash
./setup.sh --skip-setup --skip-build --down 2>&1 | head -5
```

Expected: banner prints, then `--down` runs docker compose down. No errors about missing tools.

Now simulate a missing tool to confirm the error path works:

```bash
PATH_BACKUP="$PATH"
export PATH="/nonexistent"
./setup.sh --help 2>&1 | head -3
export PATH="$PATH_BACKUP"
```

Expected: prints banner then exits with error about Docker not found (or similar — the help flag bypasses prereq check, but this confirms the PATH override works).

- [ ] **Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat(setup): Phase 1b — prerequisite detection with OS-aware install hints"
```

---

## Task 3: Phase 1c — Environment file creation (local / CI / production)

**Files:**
- Modify: `setup.sh` — replace `setup_env() { : ; }` stub

- [ ] **Step 1: Replace the `setup_env` stub with the full implementation**

Replace `setup_env()           { : ; }  # implemented in Task 3` with:

```bash
setup_env() {
  step "Setting up environment"

  # Required vars — must be non-empty after .env is loaded
  local required_vars=(
    "DATABASE_URL"
    "BESU_PRIVATE_KEY"
    "BESU_CHAIN_ID"
  )

  case "$CONTEXT" in

    # ── CI mode: write env vars from process environment → .env ───────────────
    ci)
      if [[ ! -f .env.example ]]; then
        error ".env.example not found — cannot generate .env in CI mode."
        exit 2
      fi
      : > .env  # truncate/create
      while IFS= read -r line; do
        # Skip comments and blank lines
        [[ "$line" =~ ^#  ]] && continue
        [[ -z "$line"      ]] && continue
        local key
        key=$(echo "$line" | cut -d= -f1)
        if [[ -n "${!key:-}" ]]; then
          echo "${key}=${!key}" >> .env
        else
          echo "${key}=" >> .env
        fi
      done < .env.example
      success ".env written from environment variables"
      ;;

    # ── Production mode: .env MUST already exist ──────────────────────────────
    production)
      if [[ ! -f .env ]]; then
        error "Production mode: .env must exist before running setup."
        error "  Create it manually from .env.example and populate all secrets."
        exit 2
      fi
      success ".env found"
      ;;

    # ── Local mode: create from .env.example if missing, offer editor ─────────
    local)
      if [[ ! -f .env ]]; then
        if [[ ! -f .env.example ]]; then
          error ".env.example not found."
          exit 2
        fi
        cp .env.example .env
        warn ".env created from .env.example"
        if [[ -n "${EDITOR:-}" ]]; then
          warn "Opening .env in \$EDITOR (${EDITOR}) — save and exit when done..."
          "$EDITOR" .env
        else
          warn "Review .env now (edit secrets if needed), then press Enter to continue..."
          read -r
        fi
      else
        success ".env already exists"
      fi
      ;;

  esac

  # ── Validate required vars are non-empty ─────────────────────────────────────
  local missing=()
  for var in "${required_vars[@]}"; do
    local val
    val=$(grep -E "^${var}=" .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)
    [[ -z "$val" ]] && missing+=("$var")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    error "The following required variables are empty in .env:"
    for var in "${missing[@]}"; do
      error "  - $var"
    done
    exit 2
  fi

  # ── Production: warn about default passwords ──────────────────────────────────
  if [[ "$CONTEXT" == "production" ]] || $PROD_MODE; then
    if grep -qE "^DATABASE_URL=.*didvc_pass" .env 2>/dev/null; then
      warn "PRODUCTION: .env still contains the default database password 'didvc_pass'."
      warn "  Update DATABASE_URL and POSTGRES_PASSWORD before deploying publicly."
      if [[ "$CONTEXT" != "ci" ]]; then
        echo -n "  Continue anyway? [y/N] "
        read -r confirm
        [[ "$confirm" =~ ^[Yy]$ ]] || { log "Aborted."; exit 1; }
      fi
    fi
  fi

  # ── Load port vars for health checks ─────────────────────────────────────────
  BACKEND_PORT=$(grep -E '^BACKEND_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo "3001")
  FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo "3000")
}
```

- [ ] **Step 2: Test local mode — .env already exists**

```bash
./setup.sh --skip-setup --down 2>&1 | head -3  # confirm no regression
```

- [ ] **Step 3: Test CI mode — writes .env from environment**

```bash
rm -f .env
CI=true DATABASE_URL="postgresql://u:p@localhost/db" \
  BESU_PRIVATE_KEY="0xabc123" \
  BESU_CHAIN_ID="1337" \
  ./setup.sh --skip-setup --down 2>&1 | head -10
cat .env | grep DATABASE_URL
```

Expected: `.env` exists, `DATABASE_URL=postgresql://u:p@localhost/db` is in it.

Restore `.env`:
```bash
cp .env.example .env
```

- [ ] **Step 4: Commit**

```bash
git add setup.sh
git commit -m "feat(setup): Phase 1c — .env creation for local/CI/production contexts"
```

---

## Task 4: Phase 1d — Besu init + Phase 2a parallel image builds

**Files:**
- Modify: `setup.sh` — replace `init_besu` and `build_images` stubs

- [ ] **Step 1: Replace the `init_besu` stub**

Replace `init_besu()           { : ; }  # implemented in Task 4` with:

```bash
init_besu() {
  if $NO_BESU; then
    log "Skipping Besu network init (--no-besu)"
    return 0
  fi

  if [[ -s "${SCRIPT_DIR}/besu/network/genesis.json" ]]; then
    success "Besu network already initialized — skipping"
    return 0
  fi

  step "Initializing Besu QBFT network (first run)"
  if ! bash "${SCRIPT_DIR}/scripts/init-besu-network.sh"; then
    error "Besu network initialization failed."
    exit 3
  fi
  success "Besu network initialized"
}
```

- [ ] **Step 2: Replace the `build_images` stub**

Replace `build_images()     { : ; }  # implemented in Task 4` with:

```bash
build_images() {
  if $SKIP_BUILD; then
    warn "Skipping image builds (--skip-build)"
    return 0
  fi

  step "Building Docker images (parallel)"

  # Tag existing images as rollback targets before rebuilding
  for svc in backend frontend; do
    local img_id
    img_id=$(docker images -q "did-vc-project-${svc}" 2>/dev/null | head -1 || true)
    if [[ -n "$img_id" ]]; then
      docker tag "$img_id" "${svc}-previous" 2>/dev/null && \
        log "  Tagged ${svc} → ${svc}-previous" || true
    fi
  done

  # Build backend and frontend in parallel
  local build_log
  build_log=$(mktemp)

  docker compose build backend  > "${build_log}.backend"  2>&1 &
  local pid_backend=$!
  docker compose build frontend > "${build_log}.frontend" 2>&1 &
  local pid_frontend=$!

  local failed=false

  wait "$pid_backend"  || { error "Backend build failed:";  cat "${build_log}.backend"  >&2; failed=true; }
  wait "$pid_frontend" || { error "Frontend build failed:"; cat "${build_log}.frontend" >&2; failed=true; }

  rm -f "${build_log}.backend" "${build_log}.frontend"

  $failed && exit 4

  success "Images built successfully"
}
```

- [ ] **Step 3: Test build_images skips when --skip-build is set**

```bash
./setup.sh --skip-setup --skip-build --down 2>&1 | grep -E "Skipping|build"
```

Expected output includes: `Skipping image builds (--skip-build)`

- [ ] **Step 4: Test that --no-besu skips init**

```bash
./setup.sh --no-besu --skip-build --down 2>&1 | grep -i besu
```

Expected: `Skipping Besu network init (--no-besu)` and no init-besu-network.sh execution.

- [ ] **Step 5: Commit**

```bash
git add setup.sh
git commit -m "feat(setup): Phase 1d and 2a — Besu init gate and parallel image builds"
```

---

## Task 5: Phase 2b/c — Service startup + live per-service health polling

**Files:**
- Modify: `setup.sh` — replace `start_services` and `wait_for_stack` stubs

- [ ] **Step 1: Replace the `start_services` stub**

Replace `start_services()   { : ; }  # implemented in Task 5` with:

```bash
start_services() {
  step "Starting services"

  if $NO_BESU; then
    warn "Skipping Besu dev chain (--no-besu). Blockchain features run in demo mode."
    docker compose up -d postgres
    docker compose up -d backend frontend
  else
    docker compose up -d
  fi
}
```

- [ ] **Step 2: Add the `_elapsed` helper above `wait_for_stack`**

Add this function immediately before the `wait_for_stack` stub line:

```bash
_elapsed() {
  echo $(( $(date +%s) - $1 ))
}
```

- [ ] **Step 3: Replace the `wait_for_stack` stub with the full implementation**

Replace `wait_for_stack()   { : ; }  # implemented in Task 5` with:

```bash
wait_for_stack() {
  step "Waiting for services to become healthy"
  local start_time
  start_time=$(date +%s)

  if ! $NO_BESU; then
    _wait_besu_nodes    "$start_time" || exit 5
    _wait_deployer      "$start_time" || exit 6
  fi

  _wait_service_healthy "postgres" "PostgreSQL"   "3/5" "$start_time" || exit 7
  _wait_http "backend"  "Backend"  "http://localhost:${BACKEND_PORT}/health" "4/5" "$start_time" || exit 8
  _wait_http "frontend" "Frontend" "http://localhost:${FRONTEND_PORT}"       "5/5" "$start_time" || exit 9
}

_wait_besu_nodes() {
  local start_time="$1"
  local stage="1/5"
  local label="[${stage}] Besu QBFT (5 nodes)"

  while true; do
    local elapsed
    elapsed=$(_elapsed "$start_time")
    if [[ $elapsed -ge $TIMEOUT ]]; then
      echo ""
      error "${label}: timed out after ${TIMEOUT}s."
      docker compose logs --tail=20 besu-node1 >&2
      return 1
    fi

    local healthy
    healthy=$(docker compose ps 2>/dev/null | grep -cE "besu-node[0-9].*\(healthy\)" || echo 0)

    local bar="" filled=$(( (healthy * 10) / 5 ))
    for ((i=0;i<filled;i++)); do bar+="█"; done
    for ((i=filled;i<10;i++)); do bar+="░"; done

    if [[ "$CONTEXT" == "ci" ]]; then
      log "${label}: ${healthy}/5 healthy (${elapsed}s)"
    else
      printf "\r  %-38s %s  %d/5 (%ds)" "$label" "$bar" "$healthy" "$elapsed"
    fi

    if [[ "$healthy" -eq 5 ]]; then
      if [[ "$CONTEXT" == "ci" ]]; then
        success "${label}: all 5 healthy (${elapsed}s)"
      else
        printf "\r  %-38s ✓ all 5 healthy (%ds)\n" "$label" "$elapsed"
      fi
      return 0
    fi
    sleep 3
  done
}

_wait_deployer() {
  local start_time="$1"
  local stage="2/5"
  local label="[${stage}] Contract deployer"

  while true; do
    local elapsed
    elapsed=$(_elapsed "$start_time")
    if [[ $elapsed -ge $TIMEOUT ]]; then
      echo ""
      error "${label}: timed out after ${TIMEOUT}s."
      docker compose logs --tail=20 besu-deployer >&2
      return 1
    fi

    local cid
    cid=$(docker compose ps -q besu-deployer 2>/dev/null | head -1 || true)
    local state="missing" exit_code="-1"
    if [[ -n "$cid" ]]; then
      state=$(docker inspect "$cid" --format '{{.State.Status}}' 2>/dev/null || echo "missing")
      exit_code=$(docker inspect "$cid" --format '{{.State.ExitCode}}' 2>/dev/null || echo "-1")
    fi

    if [[ "$CONTEXT" == "ci" ]]; then
      log "${label}: ${state} (${elapsed}s)"
    else
      printf "\r  %-38s ⠸ %s (%ds)" "$label" "$state" "$elapsed"
    fi

    if [[ "$state" == "exited" ]]; then
      if [[ "$exit_code" == "0" ]]; then
        if [[ "$CONTEXT" == "ci" ]]; then
          success "${label}: completed (${elapsed}s)"
        else
          printf "\r  %-38s ✓ completed (%ds)\n" "$label" "$elapsed"
        fi
        return 0
      else
        echo ""
        error "${label}: exited with code ${exit_code}."
        docker compose logs --tail=20 besu-deployer >&2
        return 1
      fi
    fi
    sleep 3
  done
}

_wait_service_healthy() {
  local service="$1" display="$2" stage="$3" start_time="$4"
  local label="[${stage}] ${display}"

  while true; do
    local elapsed
    elapsed=$(_elapsed "$start_time")
    if [[ $elapsed -ge $TIMEOUT ]]; then
      echo ""
      error "${label}: timed out after ${TIMEOUT}s."
      docker compose logs --tail=20 "$service" >&2
      return 1
    fi

    local healthy
    healthy=$(docker compose ps 2>/dev/null | grep -cE "${service}.*\(healthy\)" || echo 0)

    if [[ "$CONTEXT" == "ci" ]]; then
      log "${label}: $(docker compose ps "$service" --format '{{.Status}}' 2>/dev/null || echo waiting) (${elapsed}s)"
    else
      printf "\r  %-38s ⠸ waiting (%ds)" "$label" "$elapsed"
    fi

    if [[ "$healthy" -gt 0 ]]; then
      if [[ "$CONTEXT" == "ci" ]]; then
        success "${label}: healthy (${elapsed}s)"
      else
        printf "\r  %-38s ✓ healthy (%ds)\n" "$label" "$elapsed"
      fi
      return 0
    fi
    sleep 3
  done
}

_wait_http() {
  local service="$1" display="$2" url="$3" stage="$4" start_time="$5"
  local label="[${stage}] ${display}"

  while true; do
    local elapsed
    elapsed=$(_elapsed "$start_time")
    if [[ $elapsed -ge $TIMEOUT ]]; then
      echo ""
      error "${label}: did not respond within ${TIMEOUT}s."
      docker compose logs --tail=20 "$service" >&2
      return 1
    fi

    if [[ "$CONTEXT" == "ci" ]]; then
      log "${label}: checking ${url} (${elapsed}s)"
    else
      printf "\r  %-38s ⠸ waiting (%ds)" "$label" "$elapsed"
    fi

    if curl -sf "$url" &>/dev/null; then
      if [[ "$CONTEXT" == "ci" ]]; then
        success "${label}: ready (${elapsed}s)"
      else
        printf "\r  %-38s ✓ ready (%ds)\n" "$label" "$elapsed"
      fi
      return 0
    fi
    sleep 3
  done
}
```

- [ ] **Step 4: Verify the script still runs simple commands without error**

```bash
./setup.sh --status
./setup.sh --down
```

Expected: both exit 0, print relevant output.

- [ ] **Step 5: Commit**

```bash
git add setup.sh
git commit -m "feat(setup): Phase 2b/c — service startup and live per-service health polling"
```

---

## Task 6: Phase 2d — Final summary, seed, and complete main() wiring

**Files:**
- Modify: `setup.sh` — replace `seed_database` and `print_summary` stubs

- [ ] **Step 1: Replace the `seed_database` stub**

Replace `seed_database()    { : ; }  # implemented in Task 6` with:

```bash
seed_database() {
  step "Seeding database"

  if $PROD_MODE || [[ "$CONTEXT" == "production" ]]; then
    warn "PRODUCTION: About to seed the database with demo data."
    if [[ "$CONTEXT" != "ci" ]]; then
      echo -n "  Continue? [y/N] "
      read -r confirm
      [[ "$confirm" =~ ^[Yy]$ ]] || { warn "Seed skipped."; return 0; }
    fi
  fi

  log "Running seed script inside backend container..."
  if docker compose exec -T backend node dist/db/seed.js 2>&1 | tail -20; then
    success "Database seeded"
  else
    warn "Seed script exited with an error — check logs above."
  fi
}
```

- [ ] **Step 2: Replace the `print_summary` stub**

Replace `print_summary()    { : ; }  # implemented in Task 6` with:

```bash
print_summary() {
  echo ""
  divider
  echo -e "  ${BOLD}━━━ Stack is ready ━━━${RESET}"
  echo ""
  echo -e "  Frontend    →  ${GREEN}http://localhost:${FRONTEND_PORT}${RESET}"
  echo -e "  Backend     →  ${GREEN}http://localhost:${BACKEND_PORT}${RESET}"
  echo -e "  PostgreSQL  →  ${GREEN}localhost:5433${RESET}"
  if ! $NO_BESU; then
    echo -e "  Besu RPC    →  ${GREEN}http://localhost:8545${RESET}"
  fi
  echo ""
  if ! $WITH_SEED; then
    echo -e "  First time? Seed the database:  ${CYAN}./setup.sh --seed${RESET}"
  fi
  echo ""
  echo -e "  ${BOLD}Useful commands${RESET}"
  echo -e "  ./setup.sh --logs        tail all service logs"
  echo -e "  ./setup.sh --logs backend  tail backend logs"
  echo -e "  ./setup.sh --status      service health overview"
  echo -e "  ./setup.sh --down        stop everything"
  echo -e "  ./setup.sh --rollback    restore previous images"
  echo -e "  ./setup.sh --skip-setup  re-deploy without setup phase"
  divider
  echo ""
}
```

- [ ] **Step 3: Verify the full script is syntactically valid**

```bash
bash -n setup.sh && echo "Syntax OK"
```

Expected: `Syntax OK` with exit 0.

- [ ] **Step 4: Run a dry smoke test (--skip-setup --skip-build --down to verify wiring)**

```bash
./setup.sh --help | grep -c "skip-setup"
```

Expected: `1` (the flag appears in usage).

- [ ] **Step 5: Commit**

```bash
git add setup.sh
git commit -m "feat(setup): Phase 2d — summary, seed, and complete main() wiring"
```

---

## Task 7: Makefile update, deploy.sh removal, and end-to-end verification

**Files:**
- Modify: `Makefile`
- Delete: `deploy.sh`

- [ ] **Step 1: Rewrite `Makefile` with updated targets**

Replace the entire contents of `Makefile` with:

```makefile
SHELL := /bin/bash
.PHONY: setup up down logs status seed ci rollback build ps env \
        deploy deploy-seed deploy-no-besu deploy-prod

# ── Primary targets ───────────────────────────────────────────────────────────

## First-time setup on a new machine: check prerequisites, create .env, init
## Besu, build images, start services, wait for health checks.
setup:
	./setup.sh

## Day-to-day restart: skip prerequisite / env / Besu-init phase, just deploy.
up:
	./setup.sh --skip-setup

## Stop and remove all containers.
down:
	./setup.sh --down

## Tail logs for all services (or a specific one: make logs s=backend).
logs:
	./setup.sh --logs $(s)

## Print current health status of all services.
status:
	./setup.sh --status

## Seed the database with demo data.
seed:
	./setup.sh --seed

## Test CI pipeline behaviour locally (plain output, strict env validation).
ci:
	CI=true ./setup.sh

## Roll back backend + frontend to the previous Docker images.
rollback:
	./setup.sh --rollback

# ── Build helpers ─────────────────────────────────────────────────────────────

## Rebuild Docker images only (no startup).
build:
	docker compose build

## Show running container list.
ps:
	docker compose ps

## Create .env from .env.example if it does not exist.
env:
	@if [ ! -f .env ]; then cp .env.example .env && echo ".env created from .env.example"; else echo ".env already exists"; fi

# ── Legacy aliases (kept for muscle memory) ───────────────────────────────────

deploy:
	./setup.sh

deploy-seed:
	./setup.sh --seed

deploy-no-besu:
	./setup.sh --no-besu

deploy-prod:
	./setup.sh --prod
```

- [ ] **Step 2: Verify Makefile targets parse correctly**

```bash
make --dry-run setup 2>&1 | head -5
make --dry-run up    2>&1 | head -5
make --dry-run ci    2>&1 | head -5
```

Expected: each prints `./setup.sh ...` and the correct flags, no errors.

- [ ] **Step 3: Delete `deploy.sh`**

```bash
rm deploy.sh
```

- [ ] **Step 4: Verify no stale references to `deploy.sh` remain (other than git history)**

```bash
grep -r "deploy\.sh" --include="*.md" --include="*.sh" --include="Makefile" \
  --exclude-dir=".git" --exclude-dir="node_modules" . 2>/dev/null
```

Expected: no output (zero references). If any docs reference `deploy.sh`, update them to `setup.sh`.

- [ ] **Step 5: End-to-end smoke test — bring the full stack up from scratch**

With the QBFT network already initialized (from previous session), run:

```bash
./setup.sh --skip-setup 2>&1 | tail -30
```

Expected output ends with:
```
━━━ Stack is ready ━━━

  Frontend    →  http://localhost:3000
  Backend     →  http://localhost:3001
  PostgreSQL  →  localhost:5433
  Besu RPC    →  http://localhost:8545
```
And exits 0.

Verify all services healthy:
```bash
docker compose ps | grep -E "healthy|running"
```

Expected: besu-node1 through besu-node5 show `(healthy)`, postgres shows `(healthy)`, backend shows `(healthy)`, frontend shows `Up`.

- [ ] **Step 6: Test CI mode exit codes**

```bash
CI=true ./setup.sh --skip-setup --skip-build 2>&1 | grep -E "\[✔\]|\[✘\]|\[setup\]" | head -20
echo "Exit code: $?"
```

Expected: plain-text log lines (no color codes), exits 0.

- [ ] **Step 7: Test `--down` brings everything down cleanly**

```bash
./setup.sh --down
docker compose ps
```

Expected: `docker compose ps` shows no running containers.

- [ ] **Step 8: Final commit**

```bash
git add setup.sh Makefile
git rm deploy.sh
git commit -m "feat(setup): complete automated deployment — setup.sh replaces deploy.sh

- Single entry point for local dev, CI/CD, and production
- Phase 1: OS-aware prerequisites, .env creation (3 modes), Besu init
- Phase 2: parallel image builds, live per-service health progress
- 9 structured exit codes for pipeline integration
- Updated Makefile with setup/up/down/logs/ci/seed/rollback targets
- Removed deploy.sh (absorbed into setup.sh)"
```

---

## Verification Checklist

After all tasks complete, confirm:

- [ ] `./setup.sh --help` prints full usage
- [ ] `./setup.sh --skip-setup` brings the stack up and shows the summary
- [ ] `CI=true ./setup.sh --skip-setup` produces plain (no colour) output and exits 0
- [ ] `./setup.sh --down` stops all services cleanly
- [ ] `make setup`, `make up`, `make ci`, `make down` all resolve to the correct `setup.sh` call
- [ ] `deploy.sh` no longer exists in the repo
- [ ] `bash -n setup.sh` reports no syntax errors
