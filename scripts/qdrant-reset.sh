#!/bin/bash
set -e

CONTAINER_NAME="imessage-mcp-qdrant"
VOLUME_NAME="imessage_mcp_qdrant"

echo "Resetting Qdrant..."

# Stop and remove container if exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker stop $CONTAINER_NAME 2>/dev/null || true
  docker rm $CONTAINER_NAME
  echo "Removed existing container"
fi

# Remove volume if exists
if docker volume ls --format '{{.Name}}' | grep -q "^${VOLUME_NAME}$"; then
  docker volume rm $VOLUME_NAME
  echo "Removed existing volume"
fi

# Recreate
docker run -d --name $CONTAINER_NAME \
  -p 6333:6333 -p 6334:6334 \
  -v $VOLUME_NAME:/qdrant/storage \
  qdrant/qdrant

echo "Qdrant reset complete and running at http://localhost:6333"

