# Video Editor MCP

hi, i'm krish. i made this because i genuinely suck at video editing. like, i'll spend 2 hours trying to cut a 5-minute clip down to 15 seconds and it still looks bad. every time i open davinci resolve i feel like i'm defusing a bomb. there had to be a better way.

so i built an MCP App that lets an AI agent do the editing for me. i just say "make me a highlight reel" or "cut out the boring parts" and it actually does it. in davinci resolve. for real.

---

## how it works

this is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) App — the open standard that lets AI agents use tools and render interactive UI. the agent connects to this server and gets access to tools for video understanding and editing. it decides what to call and in what order based on what you ask.

the core idea: connect an AI that can **see** video content to an AI that can **edit** video.

```
You: "make a 15 second highlight reel with slo-mo on the best parts"

                        ┌─────────────────────┐
                        │   Claude (Agent)     │
                        │   connected via MCP  │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │ get-resolve-    │  │  analyze-video   │  │ execute-resolve │
    │ state           │  │                  │  │ -script         │
    │                 │  │  Cumulus Labs    │  │                 │
    │ gets timeline,  │  │  VLM (Qwen3-VL) │  │ runs Python in  │
    │ clips, fps,     │  │  watches video,  │  │ DaVinci Resolve │
    │ media pool      │  │  finds moments   │  │ builds the edit │
    └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
             │                    │                    │
             ▼                    ▼                    ▼
    ┌──────────────────────────────────────────────────────────┐
    │              Interactive Widget UI                        │
    │  timeline viewer · VLM results · script output           │
    │  video preview · segment list · action buttons           │
    │  text input for feedback · "Open in DaVinci" button      │
    └──────────────────────────────────────────────────────────┘
```

the agent follows a strict workflow:
1. **understand** — reads the current DaVinci state, analyzes the video with VLM
2. **plan** — presents the editing plan and **stops to wait for your feedback**
3. **execute** — only after you approve, runs one script to make all the edits
4. **verify** — shows you the final timeline so you can review

you stay in control the whole time. the agent never edits without your approval.

---

## the stack

**MCP Server** — TypeScript, built with [mcp-use](https://mcp-use.com). runs as an MCP App with 4 interactive widgets rendered inline in the conversation. authenticated via Supabase OAuth. deployed on [Manufact Cloud](https://manufact.com).

**Vision Language Model** — [Cumulus Labs](https://cumuluslabs.ai) running **Qwen3-VL-32B** on GPU. this is what "watches" the video — you send it a clip and ask "when does the person jump?" and it returns timestamps, descriptions, and impact ratings. it's the eyes.

**Video Editor** — [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) via the Python scripting API. the agent writes Python code that controls Resolve — importing media, building timelines, adding subclips with frame-level precision, applying zoom effects, adding markers. it's the hands.

**Remote Bridge** — for cloud deployment, a lightweight HTTP bridge runs on your local machine alongside DaVinci. the deployed server reaches it through [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), so Claude Desktop can connect to the cloud MCP while DaVinci edits happen locally.

---

## what you can say

| you say | what happens |
|---|---|
| "make a 15 second highlight reel with slo-mo" | VLM identifies best moments, agent builds timeline with subclips and effects |
| "cut out the boring parts" | VLM finds low-energy segments, agent removes them |
| "what's happening in this video?" | VLM describes every scene with timestamps |
| "add music to this edit" | agent imports audio file and adds it to the timeline |
| "switch to the other timeline" | click a button in the widget, DaVinci switches |
| "make it more dramatic" | agent adjusts cuts, adds zoom, changes pacing |

---

## widgets

the MCP App renders interactive UI directly in the conversation:

**Timeline Viewer** — embedded video preview player, visual clip bars proportional to duration, colored markers, timeline switching buttons, clip detail panel with frame info, "Open in DaVinci" button

**VLM Results** — parsed segment list with time ranges, type badges (jump, grind, transition), impact scores, "Plan Edits" / "More Detail" / "Retry" buttons, plus a text input to type custom feedback

**Script Output** — success/failure badge, monospace stdout, red stderr, "Refresh Timeline" button, "Help Fix Error" for failures, text input for feedback

**Setup Wizard** — first-run onboarding that detects DaVinci connection status, lets you enter and test your VLM endpoint, saves configuration

---

## architecture

```
Claude Desktop
    │
    │  MCP (via mcp-remote)
    ▼
Manufact Cloud (deployed MCP server)
    │
    ├── analyze-video ──► Tailscale Funnel ──► Bridge (laptop) ──► reads video file
    │                                                              ──► sends to Cumulus VLM
    │
    ├── execute-resolve-script ──► Tailscale Funnel ──► Bridge ──► Python subprocess
    │                                                              ──► DaVinci Resolve
    │
    └── get-resolve-state ──► Tailscale Funnel ──► Bridge ──► DaVinci Resolve
```

everything runs through the bridge on your laptop. the cloud server never touches video files or DaVinci directly.

---

## setup

### local development

```bash
# 1. install DaVinci Resolve (free version works)
#    enable scripting: Preferences > System > General > External scripting > Local

# 2. clone and install
git clone https://github.com/Krish-Parmar22/videoeditor_mcp
cd videoeditor_mcp/server
npm install
cp .env.example .env
# edit .env with your VLM endpoint

# 3. run
npm run dev
# open http://localhost:3000/inspector
```

### cloud deployment

```bash
# 1. on your laptop — start the bridge
./start-bridge.sh

# 2. in another terminal — expose via Tailscale
tailscale funnel 3001

# 3. deploy to Manufact Cloud
npx mcp-use deploy --env-file .env.deploy --name videoeditor-mcp

# 4. connect Claude Desktop (add to claude_desktop_config.json)
{
  "mcpServers": {
    "video-editor": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-app.run.mcp-use.com/sse"]
    }
  }
}
```

---

## tools

| tool | what it does |
|---|---|
| `get-resolve-state` | full project state as JSON — timeline, clips, fps, markers, media pool |
| `analyze-video` | sends video to Cumulus Labs VLM, returns scene analysis with timestamps |
| `execute-resolve-script` | runs Python in DaVinci Resolve — imports, cuts, effects, markers |
| `detect-setup-status` | checks DaVinci + VLM connection status |
| `test-vlm-connection` | pings a VLM endpoint to verify it works |
| `save-setup` | saves onboarding config to disk |

---

## security

- path traversal protection on video file serving (allowed directories only)
- Python code blocklist (no eval, exec, subprocess, network access)
- case-insensitive pattern matching on blocked code
- bearer token auth on the bridge
- Supabase OAuth on the deployed server
- no secrets in git (env files gitignored)

---

## built with

- [mcp-use](https://mcp-use.com) — MCP server framework with widget support
- [Cumulus Labs](https://cumuluslabs.ai) — GPU-hosted Qwen3-VL vision model
- [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) — professional video editor
- [Tailscale](https://tailscale.com) — private networking for remote bridge
- [Supabase](https://supabase.com) — OAuth authentication
- [Manufact Cloud](https://manufact.com) — MCP server deployment
