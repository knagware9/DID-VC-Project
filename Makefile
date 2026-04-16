SHELL := /bin/bash
.PHONY: build up down logs restart ps env deploy deploy-seed deploy-no-besu deploy-prod rollback status

# ── Docker Compose primitives ─────────────────────────────────────────────────
build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

restart: down up

ps:
	docker compose ps

env:
	@if [ ! -f .env ]; then cp .env.example .env && echo ".env created from .env.example"; else echo ".env already exists"; fi

# ── Deploy targets (via deploy.sh) ────────────────────────────────────────────

## Full deploy: build images, start services, health-check
deploy:
	./deploy.sh

## Deploy + seed the database with demo data
deploy-seed:
	./deploy.sh --seed

## Deploy without the local Besu dev chain (demo/blockchain-less mode)
deploy-no-besu:
	./deploy.sh --no-besu

## Production deploy (warns on default passwords, no auto-seed)
deploy-prod:
	./deploy.sh --prod

## Roll back backend + frontend to the previous Docker images
rollback:
	./deploy.sh --rollback

## Show running service status
status:
	./deploy.sh --status
