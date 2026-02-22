#!/bin/bash
cd /Users/krishparmar/GitHub/videoeditor_mcp/server
# Redirect mcp-use's noisy stdout logs to stderr so only JSON-RPC goes to stdout
exec node dist/index.js 2>&1 | while IFS= read -r line; do
  if echo "$line" | grep -q '^{'; then
    echo "$line"  # JSON-RPC → stdout
  else
    echo "$line" >&2  # Everything else → stderr
  fi
done
