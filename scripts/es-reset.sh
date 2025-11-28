#!/bin/bash

# Reset Elasticsearch - stops containers and removes all data
# Usage: ./scripts/es-reset.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_DIR/docker"

cd "$DOCKER_DIR"

echo "⚠️  This will delete all Elasticsearch data!"
read -p "Are you sure? (y/N) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Stopping and removing containers..."
    docker compose down -v
    
    echo "✅ Elasticsearch reset complete - all data removed"
else
    echo "Cancelled"
fi

