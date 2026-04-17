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
