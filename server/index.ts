import { MCPServer, text, error, markdown } from "mcp-use/server";
import { z } from "zod";
import { createCumulusVlmClient } from "./src/cumulus-vlm-client.js";
import {
  initDavinciProxy,
  shutdownDavinciProxy,
  registerEditingContextTool,
} from "./src/davinci-proxy.js";

const server = new MCPServer({
  name: "videoeditor-mcp",
  title: "Video Editor MCP",
  version: "1.0.0",
  description:
    "AI-powered video editing: Cumulus Labs VLM video analysis + DaVinci Resolve control",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

// --- Cumulus Labs VLM Tool ---

const vlmClient = createCumulusVlmClient();

server.tool(
  {
    name: "analyze-video",
    description:
      "Analyze video content using Cumulus Labs VLM (Vision Language Model). " +
      "Send a local video file with a question and get a text response. " +
      "Use this to understand video content, find timestamps of events, " +
      "identify objects/people, describe scenes, count occurrences, etc. " +
      "The question should be specific about what information you need. " +
      "For timestamps, ask for start/end times in HH:MM:SS format.",
    schema: z.object({
      videoPath: z
        .string()
        .describe(
          "Absolute path to a local video file (e.g. /Users/user/Videos/clip.mp4)"
        ),
      question: z
        .string()
        .describe(
          "Question to ask about the video content. Be specific. " +
            "For timestamps, ask for start/end times in HH:MM:SS format."
        ),
    }),
  },
  async ({ videoPath, question }) => {
    try {
      const response = await vlmClient.analyzeVideo(videoPath, question);
      return text(response);
    } catch (err: any) {
      return error(`Cumulus Labs VLM analysis failed: ${err.message}`);
    }
  }
);

// --- DaVinci Resolve Proxy ---

try {
  await initDavinciProxy(server);
  registerEditingContextTool(server);
} catch (err: any) {
  console.error(
    `[DaVinci Proxy] Failed to initialize: ${err.message}. DaVinci tools will not be available.`
  );
}

// --- Workflow Prompt ---

const WORKFLOW_PROMPT = `You are a video editing assistant with access to two systems:

1. **Cumulus Labs VLM** (analyze-video tool) — Understands video content visually
2. **DaVinci Resolve** (resolve-* tools) — Professional video editor running locally

## Workflow: Natural Language → Video Edit

When the user asks to make an edit based on video content (e.g., "cut out the person jumping"):

### Step 1: Get Editing Context
Call \`get-editing-context\` FIRST. This returns:
- Current project and timeline name
- Frame rate (fps) — CRITICAL for timestamp conversion
- Timeline start timecode and resolution
- All timeline clips with start_frame, end_frame, duration
- Media pool clips (available source media)

### Step 2: Analyze Video with VLM
Call \`analyze-video\` with:
- \`videoPath\`: File path of the clip (get from media pool info or ask the user)
- \`question\`: Be specific. For timestamps, ask in HH:MM:SS format.

Example: "At what timestamps does a person jump? Return start_time and end_time in HH:MM:SS format as a JSON array."

### Step 3: Convert Timestamps to Frames
DaVinci works in FRAMES. Convert: \`frame = (hours*3600 + minutes*60 + seconds) * fps\`

### Step 4: Execute the Edit
Use the appropriate resolve-* tools:
- \`resolve-create_sub_clip\` — Add a segment (start_frame to end_frame) of a clip to the timeline
- \`resolve-add_clip_to_timeline\` — Add a full clip from media pool
- \`resolve-add_marker\` — Mark a specific frame (Green=start, Red=end)
- \`resolve-set_timeline_item_retime\` — Change clip speed
- \`resolve-set_timeline_item_composite\` — Blend mode and opacity
- \`resolve-set_timeline_item_transform\` — Pan, tilt, zoom, rotation
- \`resolve-set_timeline_item_crop\` — Crop edges
- \`resolve-apply_lut\` — Apply a color LUT
- \`resolve-set_color_wheel_param\` — Adjust lift/gamma/gain/offset

### Step 5: Verify
Read state again with \`get-editing-context\` or \`resolve-read-timeline-clips\` to confirm changes.

## Reading State (resolve-read-* tools)
- \`resolve-read-current-timeline\` — Timeline info with frame rate
- \`resolve-read-timeline-clips\` — All clips on the timeline
- \`resolve-read-timeline-items\` — Items with IDs (needed for transform/retime/etc.)
- \`resolve-read-media-pool-clips\` — Available source media
- \`resolve-read-color-presets\` — Available color presets
- \`resolve-read-delivery-render-presets\` — Render presets

## Key Rules
- ALWAYS call \`get-editing-context\` before editing
- NEVER assume frame rate — read it from the timeline
- VLM returns timestamps; DaVinci needs frames — ALWAYS convert
- After changes, verify by reading state again`;

server.prompt(
  {
    name: "video-editing-assistant",
    description:
      "Workflow guide for AI video editing: teaches VLM-to-DaVinci chaining, " +
      "timestamp-to-frame conversion, and which tools to use when.",
    schema: z.object({}),
  },
  async () => {
    return markdown(WORKFLOW_PROMPT);
  }
);

// --- Graceful shutdown ---

process.on("SIGINT", async () => {
  await shutdownDavinciProxy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdownDavinciProxy();
  process.exit(0);
});

// --- Start server ---

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log(`Video Editor MCP server running on port ${PORT}`);
server.listen(PORT);
