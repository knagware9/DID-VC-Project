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
