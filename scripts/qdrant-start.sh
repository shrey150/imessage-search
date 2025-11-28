#!/bin/bash
set -e

CONTAINER_NAME="imessage-mcp-qdrant"

echo "Starting Qdrant..."

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Qdrant is already running"
  else
    docker start $CONTAINER_NAME
    echo "Qdrant started"
  fi
else
  docker run -d --name $CONTAINER_NAME \
    -p 6333:6333 -p 6334:6334 \
    -v imessage_mcp_qdrant:/qdrant/storage \
    qdrant/qdrant
  echo "Qdrant container created and started"
fi

echo "Qdrant available at http://localhost:6333"

