#!/bin/bash

# Stop Elasticsearch using Docker Compose
# Usage: ./scripts/es-stop.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_DIR/docker"

cd "$DOCKER_DIR"

echo "Stopping Elasticsearch..."
docker compose down

echo "✅ Elasticsearch stopped"

