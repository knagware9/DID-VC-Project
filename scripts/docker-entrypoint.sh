#!/bin/sh
# docker-entrypoint.sh — Backend container entrypoint
#
# Sources Besu contract addresses from the shared Docker volume
# (written by besu-deployer after contract deployment), then hands
# off to the main server process.
#
# The shared volume is mounted at /shared in docker-compose.yml.
# If the file is absent (e.g., --no-besu mode), server starts in demo mode.
set -e

ADDRESSES_FILE="/shared/addresses.env"

if [ -f "$ADDRESSES_FILE" ]; then
  echo "[entrypoint] Loading Besu contract addresses from $ADDRESSES_FILE"
  # set -a exports all sourced variables automatically; set +a stops exporting
  set -a
  # shellcheck disable=SC1090
  . "$ADDRESSES_FILE"
  set +a
  echo "[entrypoint] DID_REGISTRY_ADDRESS=${DID_REGISTRY_ADDRESS:-<not set>}"
  echo "[entrypoint] VC_REGISTRY_ADDRESS=${VC_REGISTRY_ADDRESS:-<not set>}"
else
  echo "[entrypoint] $ADDRESSES_FILE not found — backend will run in demo mode"
fi

exec "$@"
