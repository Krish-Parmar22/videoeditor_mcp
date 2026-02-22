import { MCPServer, text, error, markdown, widget, oauthSupabaseProvider } from "mcp-use/server";
import { z } from "zod";
import path from "node:path";
import { appendFile, mkdir, stat, open } from "node:fs/promises";
import os from "node:os";
import { createCumulusVlmClient } from "./src/cumulus-vlm-client.js";
const { executeResolveScript, getResolveState } = process.env.RESOLVE_BRIDGE_URL
  ? await import("./src/resolve-bridge-client.js")
  : await import("./src/resolve-executor.js");
import { loadConfig, saveConfig, needsOnboarding, applyConfigToEnv } from "./src/config.js";

// Apply saved config to env vars on startup
await applyConfigToEnv();

// --- Session Logger ---
// Logs every tool call + result to server/logs/session.jsonl

const LOG_DIR = path.join(import.meta.dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "session.jsonl");

async function logEntry(entry: Record<string, unknown>) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    await appendFile(LOG_FILE, line, "utf-8");
  } catch {
    // never block the tool call if logging fails
  }
}

function extractOutput(result: any): string | undefined {
  try {
    // CallToolResult has content: [{ type: "text", text: "..." }, ...]
    const content = result?.content;
    if (!Array.isArray(content)) return undefined;
    return content
      .filter((c: any) => c.type === "text" && c.text)
      .map((c: any) => c.text)
      .join("\n");
  } catch {
    return undefined;
  }
}

function loggedTool<T extends Record<string, unknown>>(
  toolName: string,
  handler: (args: T) => Promise<any>
) {
  return async (args: T) => {
    await logEntry({ type: "tool_call", tool: toolName, args });
    const start = Date.now();
    try {
      const result = await handler(args);
      const output = extractOutput(result);
      await logEntry({
        type: "tool_result",
        tool: toolName,
        durationMs: Date.now() - start,
        isError: result?.isError ?? false,
        output,
      });
      return result;
    } catch (err: any) {
      await logEntry({
        type: "tool_error",
        tool: toolName,
        durationMs: Date.now() - start,
        error: err.message,
      });
      throw err;
    }
  };
}

const server = new MCPServer({
  name: "videoeditor-mcp",
  title: "Video Editor MCP",
  version: "2.0.0",
  description:
    "AI video editing: Cumulus Labs VLM for video understanding + DaVinci Resolve Python scripting for editing",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
  oauth: process.env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID
    ? oauthSupabaseProvider()
    : undefined,
});

// --- Tool 1: Cumulus Labs VLM ---

const vlmClient = createCumulusVlmClient();

// In bridge mode, VLM analysis goes through the bridge (file is on the laptop)
const isBridgeMode = !!process.env.RESOLVE_BRIDGE_URL;
let analyzeVideoFn: (videoPath: string, question: string) => Promise<string>;
if (isBridgeMode) {
  const { analyzeVideoViaBridge } = await import("./src/resolve-bridge-client.js");
  analyzeVideoFn = analyzeVideoViaBridge;
} else {
  analyzeVideoFn = vlmClient.analyzeVideo;
}

server.tool(
  {
    name: "analyze-video",
    description:
      "Analyze video content using Cumulus Labs VLM (Qwen3-VL). " +
      "Send a local video file with a question and get a text response. " +
      "Use for: finding timestamps of events, identifying objects/people, " +
      "describing scenes, classifying mood/content, tracking subject positions. " +
      "RULES: (1) Call get-resolve-state FIRST and WAIT for it before calling this tool. " +
      "(2) Analyze the FULL video in ONE call — do NOT split into time segments. " +
      "(3) Maximum 2 calls per conversation. Each takes 15-90 seconds. " +
      "(4) Ask for ALL info in ONE question: timestamps, descriptions, ratings. " +
      "(5) Do NOT call this in parallel with other tools. " +
      "(6) NEVER send a second analyze-video call if one is already pending. Wait for it to finish.",
    schema: z.object({
      videoPath: z
        .string()
        .describe("Absolute path to a local video file"),
      question: z
        .string()
        .describe("Question about the video. Be specific about format you want (JSON, timestamps, etc.)"),
    }),
    widget: {
      name: "vlm-result",
      invoking: "Analyzing video with VLM...",
      invoked: "Analysis complete",
    },
  },
  loggedTool("analyze-video", async ({ videoPath, question }: { videoPath: string; question: string }) => {
    try {
      const vlmStart = Date.now();
      const response = await analyzeVideoFn(videoPath, question);
      const durationMs = Date.now() - vlmStart;
      const videoName = path.basename(videoPath);
      return widget({
        props: { videoPath, question, response, videoName, durationMs },
        output: text(response),
      });
    } catch (err: any) {
      return error(`VLM analysis failed: ${err.message}`);
    }
  })
);

// --- Tool 2: Execute DaVinci Resolve Python Script ---

server.tool(
  {
    name: "execute-resolve-script",
    description:
      "Execute Python code in the DaVinci Resolve scripting environment. " +
      "Pre-initialized variables: resolve, pm (ProjectManager), project, media_pool, timeline, get_clip_by_name(name). " +
      "Use print() for output. " +
      "KEY API METHODS — use ONLY these: " +
      "Import: media_pool.ImportMedia([path]) | " +
      "Timeline: media_pool.CreateEmptyTimeline(name), project.SetCurrentTimeline(tl) | " +
      "Subclip: media_pool.AppendToTimeline([{'mediaPoolItem': clip, 'startFrame': N, 'endFrame': N}]) | " +
      "Delete: timeline.DeleteClips(items, True) | " +
      "Get clips: timeline.GetItemListInTrack('video', 1) | " +
      "Properties: item.SetProperty('Volume', 1.0), item.SetProperty('ZoomX', 1.2), item.SetProperty('Opacity', 0.5) | " +
      "SLO-MO: SetProperty('Speed') DOES NOT WORK. For slow motion, double the frame range at import: e.g. for 0.5x on 24 frames, use startFrame=0 endFrame=48. The extra frames play at normal speed = slo-mo effect. | " +
      "FPS: float(timeline.GetSetting('timelineFrameRate')) | " +
      "Markers: timeline.AddMarker(frame, 'Red', 'Name', 'Note', 1) | " +
      "RULES: (1) NEVER call this without user approval first — present your plan and WAIT for the user to say go. " +
      "(2) ONE script for ALL edits. (3) No debug/explore scripts. " +
      "(4) ALWAYS call get-resolve-state after this tool. " +
      "(5) NEVER call this in the same turn as analyze-video.",
    schema: z.object({
      code: z
        .string()
        .describe(
          "Python code to execute. Variables available: resolve, pm, project, media_pool, timeline, get_clip_by_name(). Use print() for output."
        ),
      description: z
        .string()
        .optional()
        .describe("Brief description of what this script does"),
    }),
    widget: {
      name: "script-result",
      invoking: "Running DaVinci Resolve script...",
      invoked: "Script complete",
    },
  },
  loggedTool("execute-resolve-script", async ({ code, description }: { code: string; description?: string }) => {
    if (description) {
      console.error(`[Resolve Script] ${description}`);
    }

    const result = await executeResolveScript(code);
    const success = result.exitCode === 0;

    if (!success) {
      return widget({
        props: { description: description || null, ...result, success },
        output: error(`Script failed:\n${result.stderr || result.stdout || "Script failed with no output"}`),
      });
    }

    return widget({
      props: { description: description || null, ...result, success },
      output: text(result.stdout || "(no output)"),
    });
  })
);

// --- Tool 3: Get DaVinci Resolve State ---

server.tool(
  {
    name: "get-resolve-state",
    description:
      "Get complete DaVinci Resolve project state as JSON. Returns: " +
      "project name, all timelines, current timeline (fps, resolution, duration, start_timecode), " +
      "timeline clips (name, track, start/end frame, file_path), media pool clips (name, file_path, duration). " +
      "Call this FIRST before any editing. Call ONCE at start, ONCE after edits. " +
      "Do NOT call this in parallel with analyze-video.",
    schema: z.object({}),
    widget: {
      name: "timeline-viewer",
      invoking: "Loading project state...",
      invoked: "Project state loaded",
    },
  },
  loggedTool("get-resolve-state", async () => {
    try {
      const stateJson = await getResolveState();
      const parsed = JSON.parse(stateJson);
      // Pass server port so widget can construct video URLs
      parsed._serverPort = server.serverPort || PORT;
      // In bridge mode, video files are on the laptop — use bridge URL for preview
      if (process.env.RESOLVE_BRIDGE_URL) {
        parsed._videoBaseUrl = process.env.RESOLVE_BRIDGE_URL;
      }
      return widget({
        props: parsed,
        output: text(stateJson),
      });
    } catch (err: any) {
      return error(`Failed to get state: ${err.message}`);
    }
  })
);

// --- Onboarding Tools ---

server.tool(
  {
    name: "detect-setup-status",
    description:
      "Check what's configured: DaVinci Resolve connection, VLM endpoint, saved config. " +
      "Call this first if the user needs to set up or reconfigure the editor.",
    schema: z.object({}),
    widget: {
      name: "setup-wizard",
      invoking: "Checking setup...",
      invoked: "Setup status loaded",
    },
  },
  async () => {
    const config = await loadConfig();

    // Check DaVinci Resolve
    let resolveConnected = false;
    let resolveError = "";
    try {
      const result = await executeResolveScript('print("OK")');
      resolveConnected = result.exitCode === 0 && result.stdout.includes("OK");
      if (!resolveConnected) resolveError = result.stderr || "Could not connect";
    } catch (e: any) {
      resolveError = e.message;
    }

    // Check VLM endpoint
    let vlmReachable = false;
    let vlmError = "";
    const vlmEndpoint = process.env.CUMULUS_VLM_ENDPOINT || config.vlm_endpoint;
    if (vlmEndpoint) {
      try {
        const resp = await fetch(`${vlmEndpoint}/models`, { signal: AbortSignal.timeout(5000) });
        vlmReachable = resp.ok;
        if (!resp.ok) vlmError = `HTTP ${resp.status}`;
      } catch (e: any) {
        vlmError = e.message;
      }
    } else {
      vlmError = "No endpoint configured";
    }

    const status = {
      onboarding_complete: config.onboarding_complete,
      resolve: { connected: resolveConnected, error: resolveError },
      vlm: {
        reachable: vlmReachable,
        endpoint: vlmEndpoint || "",
        model: process.env.CUMULUS_VLM_MODEL || config.vlm_model || "",
        error: vlmError,
      },
      config,
    };

    return widget({
      props: status,
      output: text(JSON.stringify(status, null, 2)),
    });
  }
);

server.tool(
  {
    name: "test-vlm-connection",
    description: "Test if a VLM endpoint is reachable. Used during setup.",
    schema: z.object({
      endpoint: z.string().describe("VLM endpoint URL to test, e.g. http://192.168.1.100:8000/v1"),
    }),
  },
  async ({ endpoint }) => {
    try {
      const resp = await fetch(`${endpoint}/models`, { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json();
        return text(`VLM endpoint reachable. Models: ${JSON.stringify(data)}`);
      }
      return error(`VLM endpoint returned HTTP ${resp.status}`);
    } catch (e: any) {
      return error(`Cannot reach VLM endpoint: ${e.message}`);
    }
  }
);

server.tool(
  {
    name: "save-setup",
    description: "Save onboarding configuration. Called after setup wizard is complete.",
    schema: z.object({
      vlm_endpoint: z.string().optional().describe("VLM endpoint URL"),
      vlm_model: z.string().optional().describe("VLM model name"),
      vlm_api_key: z.string().optional().describe("VLM API key"),
      media_paths: z.array(z.string()).optional().describe("Allowed media directories"),
    }),
  },
  async (args) => {
    const config = await saveConfig(args);
    // Re-apply to env
    await applyConfigToEnv();
    return text(`Setup saved. Config: ${JSON.stringify(config, null, 2)}`);
  }
);

// --- Workflow Prompt ---

const WORKFLOW_PROMPT = `You are an AI video editing assistant. You have 3 tools:

1. **get-resolve-state** — Get current project/timeline/clips as JSON. No parameters. Fast (~200ms).
2. **analyze-video** — Send a video to Cumulus Labs VLM (Qwen3-VL) with a question. Slow (15-90 seconds). Returns text.
3. **execute-resolve-script** — Run Python code in DaVinci Resolve. Returns stdout.

## STRICT Workflow — Follow This Exact Order

### Phase 1: UNDERSTAND (before any editing)
1. Call **get-resolve-state** ONCE. Wait for it to complete.
2. Then call **analyze-video** ONCE on the FULL video with ONE comprehensive question.
   - Ask for ALL info in a single question: timestamps, descriptions, ratings, types.
   - Do NOT split the video into time segments. The VLM handles full videos up to 5 minutes.
3. Wait for VLM to complete before doing anything else.
4. DO NOT fire get-resolve-state and analyze-video at the same time.

### Phase 2: PLAN AND WAIT — MANDATORY STOP
- Present your editing plan to the user as a short numbered list.
- Show: what clips, timestamps, slo-mo segments, estimated total duration.
- Then STOP. End your message. Do NOT call any tools.
- WAIT for the user to reply with approval, feedback, or changes.
- Only proceed to Phase 3 AFTER the user explicitly says to go ahead (e.g. "do it", "looks good", "go").
- If the user gives feedback, adjust your plan and present it again. Wait again.
- NEVER skip this phase. NEVER execute edits without user approval.

### Phase 3: EXECUTE (only after user says go)
- The user MUST have approved your plan in the previous message before you call any edit tools.
- If you are unsure whether the user approved, ASK. Do not assume.
- Write ONE execute-resolve-script that does ALL the edits in a single call.
- The API reference below has every method you need. Do NOT run exploratory scripts.
- If a script fails, fix the code and retry ONCE. Do not run debug/explore scripts.

### Phase 4: VERIFY (one call)
- Call **get-resolve-state** ONCE to confirm the result.
- Tell the user what changed.

## Pre-initialized Python Variables

These are available in every execute-resolve-script call:
- \`resolve\` — The Resolve application object
- \`pm\` — ProjectManager
- \`project\` — Current project (or None)
- \`media_pool\` — Current project's MediaPool (or None)
- \`timeline\` — Current timeline (or None)
- \`get_clip_by_name(name)\` — Find a media pool clip by name

## DaVinci Resolve Python API Reference

### Import Media
\`\`\`python
clips = media_pool.ImportMedia(["/path/to/video.mp4"])
print(f"Imported {len(clips)} clip(s)")
\`\`\`

### Create Timeline
\`\`\`python
tl = media_pool.CreateEmptyTimeline("My Timeline")
project.SetCurrentTimeline(tl)
print(f"Created timeline: {tl.GetName()}")
\`\`\`

### Add Full Clip to Timeline
\`\`\`python
clips = media_pool.ImportMedia(["/path/to/video.mp4"])
media_pool.AppendToTimeline(clips)
\`\`\`

### Add Subclip (Frame Range) to Timeline
\`\`\`python
clip = get_clip_by_name("video.mp4")
media_pool.AppendToTimeline([{
    "mediaPoolItem": clip,
    "startFrame": 72,   # 0-based, relative to clip start
    "endFrame": 144,    # exclusive
}])
\`\`\`

### Delete Clips from Timeline
\`\`\`python
items = timeline.GetItemListInTrack("video", 1) or []
timeline.DeleteClips(items, True)  # True = ripple delete (close gaps)
\`\`\`

### Add Marker
\`\`\`python
timeline.AddMarker(frame, "Red", "Name", "Comment", 1)
# Colors: Blue, Cyan, Green, Yellow, Red, Pink, Purple, Fuchsia, Rose, Lavender, Sky, Mint, Lemon, Sand, Cocoa, Cream
\`\`\`

### Get Timeline Clips
\`\`\`python
items = timeline.GetItemListInTrack("video", 1) or []
for item in items:
    print(f"{item.GetName()}: frames {item.GetStart()}-{item.GetEnd()}, duration {item.GetDuration()}")
\`\`\`

### Get File Path from Timeline Item
\`\`\`python
mpi = item.GetMediaPoolItem()
path = mpi.GetClipProperty("File Path")
\`\`\`

### Frame Rate & Timestamp Conversion
\`\`\`python
fps = float(timeline.GetSetting("timelineFrameRate"))
# Seconds to frames: frame = int(seconds * fps)
# Example: 3 seconds at 24fps = 72 frames
\`\`\`

### Set Clip Properties (Transform, Retime, Audio)
\`\`\`python
item.SetProperty("Pan", 0.5)        # Horizontal position
item.SetProperty("Tilt", 0.0)       # Vertical position
item.SetProperty("ZoomX", 1.2)      # Horizontal zoom
item.SetProperty("ZoomY", 1.2)      # Vertical zoom
item.SetProperty("Rotation", 15.0)  # Degrees
item.SetProperty("Opacity", 0.5)    # 0.0-1.0
item.SetProperty("CropLeft", 0.1)   # 0.0-1.0
# NOTE: SetProperty("Speed") DOES NOT WORK in DaVinci Resolve API.
# For slow motion, use longer frame ranges at AppendToTimeline time:
# Normal 1s clip at 24fps = 24 frames. For 0.5x slo-mo, use 48 frames.
# The extra frames play at normal timeline speed = slow motion effect.
item.SetProperty("Volume", 1.4)     # Audio volume (1.0 = unity)
\`\`\`

### Page Navigation
\`\`\`python
resolve.OpenPage("edit")   # edit, color, deliver, media, fusion, fairlight
\`\`\`

### Media Pool Organization
\`\`\`python
root = media_pool.GetRootFolder()
new_bin = media_pool.AddSubFolder(root, "Action Clips")
media_pool.SetCurrentFolder(new_bin)
\`\`\`

### Switch Timeline
\`\`\`python
tl = project.GetTimelineByName("Timeline 1")
project.SetCurrentTimeline(tl)
\`\`\`

## Example: Build a Highlight Reel

Single execute-resolve-script that does everything:
\`\`\`python
clip = get_clip_by_name("video.mp4")
fps = float(timeline.GetSetting("timelineFrameRate"))

# Clear timeline
items = timeline.GetItemListInTrack("video", 1) or []
if items:
    timeline.DeleteClips(items, True)

# Add segments from VLM analysis (timestamps converted to frames)
segments = [
    {"start": int(3.0 * fps), "end": int(6.5 * fps)},   # Kickflip
    {"start": int(18.0 * fps), "end": int(22.0 * fps)},  # Big jump
    {"start": int(45.0 * fps), "end": int(50.0 * fps)},  # Grind
]

for seg in segments:
    media_pool.AppendToTimeline([{
        "mediaPoolItem": clip,
        "startFrame": seg["start"],
        "endFrame": seg["end"],
    }])
    print(f"Added frames {seg['start']}-{seg['end']}")

print(f"Done. {len(segments)} clips on timeline.")
\`\`\`

## DO NOT — These Cause Bad UX

- DO NOT fire get-resolve-state and analyze-video at the same time. Run state FIRST, then VLM. Parallel calls create confusing widget ordering.
- DO NOT split a video into time segments for separate VLM calls. ONE call for the FULL video. Maximum 2 VLM calls per user request.
- DO NOT run "debug", "explore", or "check" scripts. The API reference above has everything. If a script fails, read the error and fix the code.
- DO NOT re-analyze a video you already analyzed in this conversation. Use the results you have.
- DO NOT split edits into multiple execute-resolve-script calls. Batch everything into ONE script.
- DO NOT call get-resolve-state between edit steps. Call it ONCE at the start and ONCE at the end.
- DO NOT tell the user to do anything manually in DaVinci Resolve. Everything must be done through scripts. If something can't be done via API, skip it silently — never say "do this manually".

## Key Rules

- Use print() for ALL output — that's what gets returned to you
- Use json.dumps() for structured data output
- VLM returns timestamps in seconds → multiply by fps to get frame numbers
- Frame numbers in subclip dicts are 0-based relative to clip start
- Wrap risky operations in try/except for clean error messages`;

server.prompt(
  {
    name: "video-editing-assistant",
    description:
      "Complete workflow guide for AI video editing with DaVinci Resolve Python API reference.",
    schema: z.object({}),
  },
  async () => {
    return markdown(WORKFLOW_PROMPT);
  }
);

// --- Video file serving route ---

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

// Allowed directories for video serving (prevent path traversal)
const ALLOWED_VIDEO_DIRS = [
  path.join(os.homedir(), "Downloads"),
  path.join(os.homedir(), "Movies"),
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Documents"),
  "/tmp/resolve_preview",
];

function isPathAllowed(resolvedPath: string): boolean {
  return ALLOWED_VIDEO_DIRS.some((dir) => resolvedPath.startsWith(dir + path.sep) || resolvedPath === dir);
}

server.app.get("/api/video", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath) return c.text("Missing path parameter", 400);

  const resolved = path.resolve(filePath);

  // Security: only serve files from allowed directories
  if (!isPathAllowed(resolved)) {
    return c.text("Access denied", 403);
  }

  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (!MIME_TYPES[ext]) {
    return c.text("Not a supported video format", 400);
  }

  try {
    const info = await stat(resolved);
    const mime = MIME_TYPES[ext];
    const origin = c.req.header("origin") || `http://localhost:${PORT}`;

    // Support range requests for seeking
    const range = c.req.header("range");
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const rangeStart = parseInt(parts[0], 10);
      const rangeEnd = parts[1] ? parseInt(parts[1], 10) : info.size - 1;

      // Validate range bounds
      if (isNaN(rangeStart) || rangeStart < 0 || rangeEnd >= info.size || rangeStart > rangeEnd) {
        return c.text("Invalid range", 416);
      }

      const chunkSize = rangeEnd - rangeStart + 1;
      const fh = await open(resolved, "r");
      const buf = Buffer.alloc(chunkSize);
      await fh.read(buf, 0, chunkSize, rangeStart);
      await fh.close();

      return new Response(buf, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${rangeStart}-${rangeEnd}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": mime,
          "Access-Control-Allow-Origin": origin,
        },
      });
    }

    const fh = await open(resolved, "r");
    const buf = Buffer.alloc(info.size);
    await fh.read(buf, 0, info.size, 0);
    await fh.close();

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Length": String(info.size),
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": origin,
      },
    });
  } catch {
    return c.text("File not found", 404);
  }
});

// --- Start server ---

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.error(`Video Editor MCP v2 — 3 tools + 1 prompt — port ${PORT}`);
server.listen(PORT);
