# Video Editor MCP - Implementation Plan

## Context

Build an AI-powered video editing assistant. Claude (the agent) orchestrates between:
1. **DaVinci Resolve** — actual video editing operations via existing Python MCP server
2. **Cumulus Labs VLM** (Qwen3-VL) — vision language model for understanding video content

**How it works:** The agent receives natural language instructions (e.g. "cut out the person jumping"), reasons about what information it needs, uses the Cumulus Labs VLM tool to understand the video, then chains together the right DaVinci Resolve tools. The agent handles all reasoning — we just provide the tools.

## Architecture

```
Claude (Agent) — reasons about intent, plans tool chains
    |
    v
[mcp-use Server]  (TypeScript, port 3000)
    |
    ├── analyze-video ──> HTTP ──> Cumulus Labs VLM (Qwen3-VL) @ 192.222.57.112:8000/v1
    |                              (OpenAI-compatible, video_url content type)
    |
    └── resolve-* tools ──> stdio ──> Python DaVinci MCP server (child process)
                                        |
                                        v
                                   DaVinci Resolve (running locally)
```

**Principles:**
- **KISS**: One Cumulus Labs VLM tool (`analyze-video`) — Claude composes the right question
- **SRP**: Cumulus Labs VLM client does HTTP calls. DaVinci proxy does MCP proxying. Server wires them together.
- **Extensible**: Adding a new VLM tool = one `server.tool()` call + Cumulus Labs VLM client reuse

## File Structure

```
videoeditor_mcp/
├── CLAUDE.md
├── davinci-resolve-mcp/              # Already cloned (untouched)
│   ├── src/resolve_mcp_server.py     # Python MCP server entry point
│   ├── requirements.txt
│   └── ...
└── server/                           # mcp-use project (to scaffold)
    ├── index.ts                      # Main server: registers tools, starts proxy
    ├── src/
    │   ├── cumulus-vlm-client.ts      # Cumulus Labs VLM HTTP client (OpenAI-compatible)
    │   └── davinci-proxy.ts          # Spawns Python MCP, proxies tools
    ├── .env                          # Runtime config
    ├── .env.example                  # Documented config template
    ├── package.json
    └── tsconfig.json
```

## Implementation Steps

### Step 1: Scaffold mcp-use project

```bash
cd /Users/krishparmar/GitHub/videoeditor_mcp
npx create-mcp-use-app server --template blank
cd server
npm install openai @modelcontextprotocol/sdk
```

- `openai` — for calling the Cumulus Labs VLM endpoint (OpenAI-compatible client)
- `@modelcontextprotocol/sdk` — MCP client to proxy to the DaVinci Python server

### Step 2: Set up DaVinci Resolve MCP Python environment

```bash
cd /Users/krishparmar/GitHub/videoeditor_mcp/davinci-resolve-mcp
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

This creates the Python venv the proxy will use to spawn the DaVinci MCP server.

### Step 3: Build Cumulus Labs VLM Client — `server/src/cumulus-vlm-client.ts`

A thin wrapper around the OpenAI client:

```typescript
// Responsibilities:
// 1. Initialize OpenAI client pointing at Cumulus Labs VLM endpoint
// 2. analyzeVideo(videoPath, question) → string
//    - Reads local video file, base64-encodes it
//    - Sends as video_url content type with the question
//    - Returns the model's text response
// 3. analyzeVideoUrl(videoUrl, question) → string
//    - Same but for remote video URLs (no base64 needed)
```

**Key design decisions:**
- Uses `openai` npm package with `baseURL: process.env.CUMULUS_VLM_ENDPOINT`
- Video sent as `{ type: "video_url", video_url: { url: "data:video/mp4;base64,..." } }`
- For large files (>50MB), logs a warning — agent can use shorter clips or frame-based analysis
- Returns raw text — Claude (agent) parses and interprets the response

### Step 4: Register Cumulus Labs VLM Tool — `analyze-video` in `server/index.ts`

```typescript
server.tool(
  {
    name: "analyze-video",
    description: "Analyze video content using Cumulus Labs VLM. Send a local video file with a question and get a text response. Use this to understand video content, find timestamps of events, identify objects/people, describe scenes, etc. The question should be specific about what information you need.",
    schema: z.object({
      videoPath: z.string().describe("Absolute path to a local video file (e.g. /Users/user/video.mp4)"),
      question: z.string().describe("Question to ask about the video content. Be specific. For timestamps, ask for start/end times in HH:MM:SS format.")
    })
  },
  async ({ videoPath, question }) => {
    const response = await vlmClient.analyzeVideo(videoPath, question);
    return text(response);
  }
);
```

**Why one tool is enough:**
- Claude composes the right `question` for any use case (timestamps, descriptions, counts, etc.)
- No need for `find-video-segments` — Claude asks: "At what timestamps (HH:MM:SS) does a person jump? Return start_time and end_time."
- No need for `analyze-frame` — Claude asks about specific moments in its question
- Extensible: if we later need specialized behavior (e.g. frame extraction with ffmpeg), we add another tool

### Step 5: Build DaVinci Proxy — `server/src/davinci-proxy.ts`

```typescript
// Responsibilities:
// 1. initDavinciProxy(server: MCPServer) → Promise<void>
//    - Spawns Python DaVinci MCP server as child process via StdioClientTransport
//    - Connects MCP client to it
//    - Discovers all tools via client.listTools()
//    - Registers each tool in the mcp-use server as resolve-{name}
//
// 2. For each discovered tool:
//    server.tool(
//      { name: `resolve-${tool.name}`, description: tool.description, schema: z.record(z.any()) },
//      async (args) => {
//        const result = await mcpClient.callTool({ name: tool.name, arguments: args });
//        return text(JSON.stringify(result.content));
//      }
//    );
//
// 3. Cleanup: disconnect client + kill child process on server shutdown
```

**Spawn command:**
```typescript
const transport = new StdioClientTransport({
  command: path.resolve(davinciMcpPath, "venv/bin/python3"),
  args: [path.resolve(davinciMcpPath, "src/main.py")],
  env: {
    ...process.env,
    RESOLVE_SCRIPT_API: process.env.RESOLVE_SCRIPT_API,
    RESOLVE_SCRIPT_LIB: process.env.RESOLVE_SCRIPT_LIB,
    PYTHONPATH: `${process.env.RESOLVE_SCRIPT_API}/Modules/`
  }
});
```

**Key DaVinci tools that will be proxied (60+ tools total, all auto-discovered):**
- `resolve-list_timelines`, `resolve-get_current_timeline`, `resolve-create_timeline`
- `resolve-list_media_pool_clips`, `resolve-import_media`, `resolve-add_clip_to_timeline`
- `resolve-create_sub_clip` (cut clip by start_frame/end_frame)
- `resolve-add_marker`, `resolve-set_timeline_item_retime`
- Color, delivery, cache, proxy, transcription tools, etc.

**Schema approach:** We use `z.record(z.any())` (accepts any object) because:
- The Python server validates inputs on its side
- Dynamic JSON Schema → Zod conversion is fragile and complex
- The tool descriptions from the Python server tell Claude what parameters to pass

### Step 6: Wire it all together — `server/index.ts`

```typescript
import { MCPServer, text, error } from "mcp-use/server";
import { z } from "zod";
import { createCumulusVlmClient } from "./src/cumulus-vlm-client";
import { initDavinciProxy } from "./src/davinci-proxy";

const server = new MCPServer({
  name: "videoeditor-mcp",
  title: "Video Editor MCP",
  version: "1.0.0"
});

// Cumulus Labs VLM client
const vlmClient = createCumulusVlmClient();

// Register Cumulus Labs VLM tool
server.tool({ name: "analyze-video", ... }, async ({ videoPath, question }) => { ... });

// Register DaVinci proxy tools (async — discovers tools on startup)
await initDavinciProxy(server);

server.listen();
```

### Step 7: Environment configuration

**`server/.env.example`:**
```env
# Cumulus Labs VLM Configuration
CUMULUS_VLM_ENDPOINT=http://192.222.57.112:8000/v1
CUMULUS_VLM_MODEL=Qwen/Qwen3-VL-32B-Instruct-FP8

# DaVinci Resolve MCP
DAVINCI_MCP_PATH=../davinci-resolve-mcp

# DaVinci Resolve SDK paths (macOS)
RESOLVE_SCRIPT_API=/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting
RESOLVE_SCRIPT_LIB=/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so
```

**`server/.env`:** Copy of above with actual values.

## Example Agent Workflow

User: "Cut out the part where the person jumps"

1. Claude sees the user's intent: extract a segment from a video
2. Claude calls `resolve-list_timeline_clips` to see what's on the timeline and get file paths
3. Claude calls `analyze-video` with:
   - `videoPath`: the clip's file path
   - `question`: "At what timestamps (HH:MM:SS format) does a person jump? Provide the start_time when the jump begins and end_time when the jump ends."
4. Cumulus Labs VLM responds: "The person jumps from 00:00:12 to 00:00:17"
5. Claude converts timestamps to frames (using timeline framerate from step 2)
6. Claude calls `resolve-create_sub_clip` with `start_frame` and `end_frame`
7. Claude calls `resolve-add_clip_to_timeline` with the new subclip

All orchestration logic lives in Claude's reasoning — the tools are simple, focused, and composable.

## Verification

1. **Scaffold + build**: `cd server && npm run build` compiles without errors
2. **Cumulus Labs VLM tool in isolation**: `npm run dev` → open `localhost:3000/inspector` → call `analyze-video` with a test video + question → verify VLM response
3. **DaVinci proxy**: With DaVinci Resolve running → `npm run dev` → inspector shows `resolve-*` tools → call `resolve-list_timelines` → verify response
4. **End-to-end**: Connect Claude Desktop to the server → ask "what's in my current timeline?" → Claude chains `resolve-get_current_timeline` + `resolve-list_timeline_clips`
