# Video Editor MCP

hi, i'm krish. i made this because i genuinely suck at video editing. like, i'll spend 2 hours trying to cut a 5-minute clip down to 15 seconds and it still looks bad. every time i open davinci resolve i feel like i'm defusing a bomb. there had to be a better way.

so i built an MCP server that lets an AI agent do the editing for me. i just say "make me a highlight reel" or "cut out the boring parts" and it actually does it. in davinci resolve. for real.

## how it works

this is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server — the open standard that lets AI agents use tools. instead of the AI just talking to you, MCP lets it actually *do* things. in this case, the "things" are watching videos and editing them in DaVinci Resolve.

the AI agent (Claude) connects to this MCP server and gets access to tools. it decides which tools to call and in what order based on what you ask. the server also renders interactive widgets (timeline viewer, video preview, VLM results) directly in the conversation — that's the MCP Apps extension.

the idea is simple: connect an AI that can **see** video to an AI that can **edit** video.

```
You: "make a 15 second highlight reel with slo-mo on the best parts"
  |
  v
Claude (AI agent, connected via MCP)
  |
  ├── calls get-resolve-state tool
  │   → gets current project info, timeline, clips, fps
  |
  ├── calls analyze-video tool → hits Cumulus Labs VLM (Qwen3-VL on GPU)
  │   → VLM watches the actual video and returns timestamps of best moments
  |
  ├── calls execute-resolve-script tool
  │   → runs Python code in DaVinci Resolve to build the edit
  |
  └── calls get-resolve-state again
      → shows you the final timeline with video preview in a widget
```

three tools, one prompt, six widgets. the agent chains them together based on what you ask — you never touch the Resolve UI.

## the stack

**MCP Server** — built with [mcp-use](https://mcp-use.com), TypeScript. runs as an MCP App with interactive widgets (timeline viewer, VLM results, script output). authenticated via Supabase OAuth.

**Vision Language Model** — [Cumulus Labs](https://cumuluslabs.ai) running Qwen3-VL-32B on GPU. this is what "watches" the video. you send it a clip and ask "when does the person jump?" and it tells you the timestamps. it's the eyes of the operation.

**Video Editor** — [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) via the Python scripting API. the agent writes Python code that controls Resolve — importing media, building timelines, adding subclips, setting properties. it's the hands.

**the connection**: the MCP server talks to the VLM over HTTP (OpenAI-compatible endpoint on Cumulus Labs infrastructure) and to DaVinci via a local Python subprocess. for remote deployment, a lightweight HTTP bridge runs on the machine with DaVinci and is reachable over Tailscale.

## what you can do

- "cut out the person jumping" — VLM finds the timestamps, agent removes those segments
- "make a 15 second highlight reel with slo-mo" — VLM identifies best moments, agent assembles them
- "add music to this edit" — agent imports audio and adds it to the timeline
- "what's happening in this video?" — VLM describes the content, timestamps, mood
- "switch to the other timeline" — click a button in the widget UI

## widgets

the MCP App renders interactive UI inline in the conversation:

- **Timeline Viewer** — video preview player, visual clip bars, click to select, timeline switching
- **VLM Results** — parsed segment list with timestamps, type badges, impact scores, action buttons
- **Script Output** — success/failure status, formatted stdout/stderr, refresh button
- **Setup Wizard** — first-run onboarding for DaVinci connection and VLM endpoint

## setup

1. install [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) (free version works)
2. enable scripting: Preferences > System > General > External scripting > Local
3. clone this repo and install:
   ```bash
   cd server
   npm install
   cp .env.example .env
   # edit .env with your VLM endpoint and Supabase credentials
   ```
4. run: `npm run dev`
5. open the inspector at `http://localhost:3000/inspector` or connect via Claude Desktop

## remote deployment

for running the MCP server in the cloud while DaVinci stays on your machine:

1. start the bridge on your machine: `BRIDGE_TOKEN=your-secret npm run bridge`
2. deploy: `mcp-use deploy --env RESOLVE_BRIDGE_URL=http://<tailscale-ip>:3001 --env RESOLVE_BRIDGE_TOKEN=your-secret`
3. connect Claude Desktop to the deployed URL

requires [Tailscale](https://tailscale.com) for the private network between cloud and local machine.

## tools

| tool | what it does |
|---|---|
| `get-resolve-state` | returns full project state as JSON (timeline, clips, markers, media pool) |
| `analyze-video` | sends video to Cumulus Labs VLM with a question, returns analysis |
| `execute-resolve-script` | runs Python in DaVinci Resolve's scripting environment |
| `detect-setup-status` | checks DaVinci connection + VLM endpoint status |
| `test-vlm-connection` | pings a VLM endpoint to verify it works |
| `save-setup` | saves configuration for persistent setup |
