#!/bin/bash

# Start Elasticsearch using Docker Compose
# Usage: ./scripts/es-start.sh [--with-kibana]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_DIR/docker"

# Check if Docker is running (macOS compatible - no timeout command needed)
echo "Checking Docker connectivity..."

if ! docker info > /dev/null 2>&1; then
    echo ""
    echo "❌ Docker is not running or not responding"
    echo ""
    echo "Please:"
    echo "  1. Open Docker Desktop"
    echo "  2. Wait for it to fully start (whale icon stops animating)"
    echo "  3. Try again: pnpm es:start"
    echo ""
    echo "If Docker is stuck, try:"
    echo "  - Quit Docker Desktop completely (right-click → Quit)"
    echo "  - Reopen Docker Desktop"
    echo "  - Or reset Docker: Docker Desktop → Settings → Troubleshoot → Clean/Purge data"
    exit 1
fi

echo "✅ Docker is running"
echo ""

cd "$DOCKER_DIR"

if [ "$1" = "--with-kibana" ]; then
    echo "Starting Elasticsearch with Kibana..."
    docker compose --profile debug up -d
    echo ""
    echo "Kibana will be available at http://localhost:5601"
else
    echo "Starting Elasticsearch..."
    docker compose up -d elasticsearch
fi

echo ""
echo "Waiting for Elasticsearch to be ready..."

# Wait for Elasticsearch to be healthy
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s --max-time 2 "http://localhost:9200/_cluster/health" 2>/dev/null | grep -q '"status":"green"\|"status":"yellow"'; then
        echo ""
        echo "✅ Elasticsearch is ready at http://localhost:9200"
        exit 0
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -n "."
    sleep 2
done

echo ""
echo "❌ Elasticsearch failed to start within timeout"
echo ""
echo "Check logs with: docker logs imessage-elasticsearch"
exit 1
