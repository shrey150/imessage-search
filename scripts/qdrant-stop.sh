#!/bin/bash
set -e

CONTAINER_NAME="imessage-mcp-qdrant"

echo "Stopping Qdrant..."

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker stop $CONTAINER_NAME
  echo "Qdrant stopped"
else
  echo "Qdrant is not running"
fi

