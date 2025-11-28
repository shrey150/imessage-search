#!/bin/bash
set -e

echo "Setting up iMessage MCP..."

# Create state directory
STATE_DIR="$HOME/.imessage-mcp"
if [ ! -d "$STATE_DIR" ]; then
  mkdir -p "$STATE_DIR"
  echo "Created state directory: $STATE_DIR"
fi

# Check for Messages database access
MESSAGES_DB="$HOME/Library/Messages/chat.db"
if [ -f "$MESSAGES_DB" ]; then
  if [ -r "$MESSAGES_DB" ]; then
    echo "✓ Messages database accessible"
  else
    echo "✗ Cannot read Messages database. Grant Full Disk Access to your terminal in System Preferences > Privacy & Security."
    exit 1
  fi
else
  echo "✗ Messages database not found at $MESSAGES_DB"
  exit 1
fi

# Check for AddressBook database access
ADDRESSBOOK_DB="$HOME/Library/Application Support/AddressBook/AddressBook-v22.abcddb"
if [ -f "$ADDRESSBOOK_DB" ]; then
  if [ -r "$ADDRESSBOOK_DB" ]; then
    echo "✓ AddressBook database accessible"
  else
    echo "⚠ Cannot read AddressBook database. Contact resolution may not work."
  fi
else
  echo "⚠ AddressBook database not found. Contact resolution may not work."
fi

# Check for Docker
if command -v docker &> /dev/null; then
  echo "✓ Docker is installed"
else
  echo "✗ Docker not found. Please install Docker Desktop."
  exit 1
fi

# Check for .env file
if [ ! -f ".env" ]; then
  if [ -f "env.example" ]; then
    cp env.example .env
    echo "Created .env file from env.example - please add your OPENAI_API_KEY"
  fi
fi

echo ""
echo "Setup complete! Next steps:"
echo "  1. Add your OPENAI_API_KEY to .env"
echo "  2. Run 'pnpm es:start' to start Elasticsearch"
echo "  3. Run 'pnpm index' to index your messages"
echo "  4. Run 'pnpm start' to start the MCP server"

