#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — DID-VC Platform Deployment Script
# =============================================================================
#
#  Usage:
#    ./deploy.sh                    # Full deploy (build + up + health checks)
#    ./deploy.sh --skip-build       # Skip Docker image rebuild (use cached)
#    ./deploy.sh --seed             # Seed the database after deploy
#    ./deploy.sh --no-besu          # Skip the local Besu dev chain
#    ./deploy.sh --prod             # Production mode (extra checks, no seed)
#    ./deploy.sh --rollback         # Roll back to the previous Docker images
#    ./deploy.sh --down             # Stop and remove all containers
#    ./deploy.sh --status           # Show running service status
#    ./deploy.sh --logs [service]   # Tail logs (all or specific service)
#
#  Flags can be combined:
#    ./deploy.sh --no-besu --seed
#    ./deploy.sh --prod --skip-build
#
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m';  GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m';  BOLD='\033[1m';  RESET='\033[0m'

log()     { echo -e "${BLUE}[deploy]${RESET}  $*"; }
success() { echo -e "${GREEN}[✔]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET}  $*"; }
error()   { echo -e "${RED}[✘]${RESET}  $*" >&2; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${RESET}"; }
divider() { echo -e "${CYAN}──────────────────────────────────────────────────${RESET}"; }

# ── Defaults ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_BUILD=false
WITH_SEED=false
NO_BESU=false
PROD_MODE=false
ROLLBACK=false
CMD_DOWN=false
CMD_STATUS=false
CMD_LOGS=false
LOGS_SERVICE=""

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)  SKIP_BUILD=true ;;
    --seed)        WITH_SEED=true ;;
    --no-besu)     NO_BESU=true ;;
    --prod)        PROD_MODE=true ;;
    --rollback)    ROLLBACK=true ;;
    --down)        CMD_DOWN=true ;;
    --status)      CMD_STATUS=true ;;
    --logs)        CMD_LOGS=true; shift; LOGS_SERVICE="${1:-}" ;;
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

cd "$SCRIPT_DIR"

# ── Banner ────────────────────────────────────────────────────────────────────
divider
echo -e "${BOLD}  DID-VC Platform — Deployment Script${RESET}"
echo -e "  $(date '+%Y-%m-%d %H:%M:%S')  |  Mode: $(${PROD_MODE} && echo PRODUCTION || echo development)"
divider

# =============================================================================
#  SIMPLE COMMANDS (--down, --status, --logs)
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

# =============================================================================
#  ROLLBACK
# =============================================================================

if $ROLLBACK; then
  step "Rolling back to previous images"

  for svc in backend frontend; do
    prev_tag="${svc}-previous"
    img=$(docker compose config --images 2>/dev/null | grep "$svc" | head -1 || true)

    if docker image inspect "${prev_tag}" &>/dev/null; then
      log "Restoring ${svc} from ${prev_tag}"
      docker compose stop "$svc"
      # Retag: current → discard, previous → current
      docker tag "${prev_tag}" "$(docker compose images -q ${svc} 2>/dev/null || echo did-vc-project-${svc}):latest" 2>/dev/null || true
      docker compose up -d "$svc"
      success "${svc} rolled back."
    else
      warn "No previous image found for ${svc} — skipping rollback for this service."
    fi
  done

  echo ""
  docker compose ps
  exit 0
fi

# =============================================================================
#  PREREQUISITE CHECKS
# =============================================================================

step "Checking prerequisites"

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is required but not installed."
    exit 1
  fi
  success "$1 found: $(command -v "$1")"
}

check_cmd docker
check_cmd curl

# Docker daemon running?
if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker and try again."
  exit 1
fi
success "Docker daemon is running"

# docker compose v2?
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif docker-compose version &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  error "docker compose (v2) or docker-compose (v1) is required."
  exit 1
fi
success "Compose: $($COMPOSE_CMD version --short 2>/dev/null || echo 'v1')"

# =============================================================================
#  ENVIRONMENT SETUP
# =============================================================================

step "Setting up environment"

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    error ".env.example not found. Cannot create .env automatically."
    exit 1
  fi
  cp .env.example .env
  warn ".env created from .env.example — review and update secrets before production use."
else
  success ".env already exists"
fi

# Production safety: warn about default DB password
if $PROD_MODE; then
  if grep -q "didvc_pass" .env; then
    warn "PRODUCTION MODE: .env still contains the default database password 'didvc_pass'."
    warn "Update DATABASE_URL and postgres credentials before deploying to a public server."
    echo -n "  Continue anyway? [y/N] "
    read -r confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { log "Aborted."; exit 1; }
  fi
fi

# Load key vars for health-check URLs
BACKEND_PORT=$(grep -E '^BACKEND_PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || echo "3001")
FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || echo "3000")

# =============================================================================
#  TAG EXISTING IMAGES AS "PREVIOUS" (for rollback)
# =============================================================================

step "Tagging current images as rollback targets"

for svc in backend frontend; do
  img_id=$(docker images -q "did-vc-project-${svc}" 2>/dev/null | head -1 || true)
  if [[ -n "$img_id" ]]; then
    docker tag "$img_id" "${svc}-previous" 2>/dev/null && \
      log "Tagged ${svc} → ${svc}-previous" || true
  fi
done

# =============================================================================
#  BUILD DOCKER IMAGES
# =============================================================================

if ! $SKIP_BUILD; then
  step "Building Docker images"
  $COMPOSE_CMD build --no-cache
  success "Images built successfully"
else
  warn "Skipping build (--skip-build flag set)"
fi

# =============================================================================
#  COMPOSE UP
# =============================================================================

step "Starting services"

# Build compose services list — exclude besu if --no-besu
if $NO_BESU; then
  warn "Skipping Besu dev chain (--no-besu). Blockchain features will run in demo mode."
  COMPOSE_SERVICES="postgres backend frontend"

  # Override besu dependency so backend doesn't wait for it
  $COMPOSE_CMD up -d postgres
  log "Waiting for postgres to be healthy..."
  _wait_postgres() {
    local n=0
    until $COMPOSE_CMD exec -T postgres pg_isready -U didvc_user -d didvc &>/dev/null; do
      n=$((n+1))
      [[ $n -ge 30 ]] && { error "Postgres did not become ready in time."; exit 1; }
      sleep 2
    done
  }
  _wait_postgres
  success "Postgres is ready"

  $COMPOSE_CMD up -d backend frontend
else
  $COMPOSE_CMD up -d
fi

# =============================================================================
#  HEALTH CHECKS
# =============================================================================

step "Waiting for services to become healthy"

wait_healthy() {
  local service="$1"
  local url="$2"
  local max_attempts="${3:-30}"
  local delay=3
  local attempt=0

  log "Checking ${service} at ${url} ..."
  until curl -sf "$url" &>/dev/null; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      error "${service} did not become healthy after $((max_attempts * delay))s."
      log "Last logs from ${service}:"
      $COMPOSE_CMD logs --tail=20 "$service" 2>/dev/null || true
      exit 1
    fi
    sleep $delay
    echo -n "."
  done
  echo ""
  success "${service} is healthy ✔"
}

wait_healthy "backend"  "http://localhost:${BACKEND_PORT}/health"  30
wait_healthy "frontend" "http://localhost:${FRONTEND_PORT}"         15

# =============================================================================
#  DATABASE SEED (optional)
# =============================================================================

if $WITH_SEED; then
  step "Seeding database"

  if $PROD_MODE; then
    warn "PRODUCTION MODE: About to seed the database. This will insert/overwrite demo data."
    echo -n "  Continue with seed? [y/N] "
    read -r confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { warn "Seed skipped."; }
  fi

  if [[ "$confirm" =~ ^[Yy]$ ]] || ! $PROD_MODE; then
    log "Running seed script inside backend container..."
    $COMPOSE_CMD exec -T backend node dist/db/seed.js 2>&1 | tail -20
    success "Database seeded"
  fi
fi

# =============================================================================
#  FINAL STATUS
# =============================================================================

step "Deployment complete"
divider
echo ""
$COMPOSE_CMD ps
echo ""
divider
echo -e "  ${BOLD}Application URLs${RESET}"
echo -e "  Frontend  → ${GREEN}http://localhost:${FRONTEND_PORT}${RESET}"
echo -e "  Backend   → ${GREEN}http://localhost:${BACKEND_PORT}${RESET}"
echo -e "  API docs  → ${GREEN}http://localhost:${BACKEND_PORT}/health${RESET}"
if ! $NO_BESU; then
  echo -e "  Besu RPC  → ${GREEN}http://localhost:8545${RESET}"
fi
divider
echo ""
echo -e "  ${BOLD}Useful commands${RESET}"
echo -e "  Tail all logs     :  ${CYAN}./deploy.sh --logs${RESET}"
echo -e "  Tail backend logs :  ${CYAN}./deploy.sh --logs backend${RESET}"
echo -e "  Service status    :  ${CYAN}./deploy.sh --status${RESET}"
echo -e "  Stop everything   :  ${CYAN}./deploy.sh --down${RESET}"
echo -e "  Roll back         :  ${CYAN}./deploy.sh --rollback${RESET}"
echo ""
