# Video Editor MCP

Built by Krish Parmar. Won **2nd place** at the [MCP Apps Hackathon](https://events.ycombinator.com/manufact-hackathon26) by Manufact (YC S25) at Y Combinator.

**Powered by**

**[Cumulus Labs](https://cumuluslabs.io) VLM (Qwen3-VL-32B)** — GPU-hosted vision intelligence that watches your video and understands what's happening, frame by frame.

An MCP App that lets an AI agent edit video in DaVinci Resolve. Just say "make me a highlight reel" or "cut out the boring parts" and it actually does it.

---

## how it works

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) App — the open standard that lets AI agents use tools and render interactive UI. The agent connects to this server and gets access to tools for video understanding and editing. It decides what to call and in what order based on what you ask.

The core idea: connect an AI that can **see** video content to an AI that can **edit** video.

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

The agent follows a strict workflow:
1. **understand** — reads the current DaVinci state, analyzes the video with VLM
2. **plan** — presents the editing plan and **stops to wait for your feedback**
3. **execute** — only after you approve, runs one script to make all the edits
4. **verify** — shows you the final timeline so you can review

You stay in control the whole time. The agent never edits without your approval.

---

## the stack

**MCP Server** — TypeScript, built with [mcp-use](https://mcp-use.com). Runs as an MCP App with 4 interactive widgets rendered inline in the conversation. Authenticated via Supabase OAuth. Deployed on [Manufact Cloud](https://manufact.com).

**Vision Language Model** — [Cumulus Labs](https://cumuluslabs.ai) running **Qwen3-VL-32B** on GPU. This is what "watches" the video — you send it a clip and ask "when does the person jump?" and it returns timestamps, descriptions, and impact ratings. It's the eyes.

**Video Editor** — [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) via the Python scripting API. The agent writes Python code that controls Resolve — importing media, building timelines, adding subclips with frame-level precision, applying zoom effects, adding markers. It's the hands.

**Remote Bridge** — for cloud deployment, a lightweight HTTP bridge runs on your local machine alongside DaVinci. The deployed server reaches it through [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), so Claude Desktop can connect to the cloud MCP while DaVinci edits happen locally.

---

## widgets

The MCP App renders interactive UI directly in the conversation:

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

Everything runs through the bridge on your laptop. The cloud server never touches video files or DaVinci directly.

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

## built with

- [mcp-use](https://mcp-use.com) — MCP server framework with widget support
- [Cumulus Labs](https://cumuluslabs.ai) — GPU-hosted Qwen3-VL vision model
- [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) — professional video editor
- [Tailscale](https://tailscale.com) — private networking for remote bridge
- [Supabase](https://supabase.com) — OAuth authentication
- [Manufact Cloud](https://manufact.com) — MCP server deployment
