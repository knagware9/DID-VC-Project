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
        macos)
          brew install curl && success "curl installed" || { error "Failed to install curl via brew. Install manually and retry."; exit 1; }
          ;;
        ubuntu|debian)
          sudo apt-get install -y curl && success "curl installed" || { error "Failed to install curl via apt-get. Install manually and retry."; exit 1; }
          ;;
        *)
          error "curl is required. Install it and retry."
          exit 1
          ;;
      esac
    else
      error "curl is required but not installed."
      exit 1
    fi
  fi
  success "curl: $(curl --version | head -1 | awk '{print $2}')"
}
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
