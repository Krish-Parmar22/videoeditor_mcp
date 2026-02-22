#!/bin/bash
cd "$(dirname "$0")"

export BRIDGE_TOKEN=videoeditor2026
export CUMULUS_VLM_ENDPOINT="http://192.222.57.112:8000/v1"
export CUMULUS_VLM_MODEL="Qwen/Qwen3-VL-32B-Instruct-FP8"
export CUMULUS_VLM_API_KEY="EMPTY"
export RESOLVE_SCRIPT_API="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
export RESOLVE_SCRIPT_LIB="/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"

npx tsx src/resolve-bridge-server.ts
