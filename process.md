# Video Editor MCP — Process & Demo Playbook

## Setup Steps

1. Install DaVinci Resolve (free), Claude App, cloned https://github.com/samuelgursky/davinci-resolve-mcp
2. Followed PLAN.md to build the MCP (mcp-use server wrapping Cumulus Labs VLM MCP + DaVinci proxy)
3. Enable scripting in DaVinci: Preferences -> System -> General -> "External scripting using" -> "Local"
4. Start server: `cd server && npm run dev`

---

## Capability Matrix

### Cumulus Labs VLM (analyze-video) can answer:
- **Temporal**: "When does X happen?" -> timestamps (HH:MM:SS)
- **Spatial**: "Where is the subject in frame?" -> position as percentages
- **Content**: "What's happening?" -> scene descriptions, actions, objects
- **Aesthetic**: "Is this shot well-lit? Shaky? Overexposed?" -> quality assessment
- **Emotional**: "What's the mood/energy of this moment?" -> tone classification
- **Counting**: "How many people/objects?" -> numbers
- **Text/OCR**: "What text appears on screen?" -> readable text
- **Comparison**: "Which shots are similar?" -> grouping

### DaVinci Tools (83 total, grouped):

| Category | Key Tools | What it controls |
|----------|-----------|-----------------|
| **Timeline Assembly** | create_timeline, create_sub_clip, add_clip_to_timeline, add_marker (16 colors) | Build edits from scratch, extract segments, organize with colored markers |
| **Transform** | set_timeline_item_transform (Pan, Tilt, ZoomX, ZoomY, Rotation, AnchorPointX/Y, Pitch, Yaw) | Ken Burns, reframing, picture-in-picture, dutch angles |
| **Crop** | set_timeline_item_crop (Left, Right, Top, Bottom, 0.0-1.0) | Letterboxing, aspect ratio conversion, focus reframing |
| **Composite** | set_timeline_item_composite (18 blend modes + opacity 0.0-1.0) | Overlays, double exposures, fade transitions, visual effects |
| **Retime** | set_timeline_item_retime (speed + NearestFrame/FrameBlend/OpticalFlow) | Slo-mo, speed ramps, timelapse, freeze frames |
| **Stabilization** | set_timeline_item_stabilization (Perspective/Similarity/Translation + strength) | Fix handheld shake, smooth action footage |
| **Audio** | set_timeline_item_audio (volume 0.0-2.0, pan -1.0 to 1.0, EQ) | Mix levels, spatial audio, silence/boost segments |
| **Keyframes** | add_keyframe, modify_keyframe, set_keyframe_interpolation (Linear/Bezier/Ease-In/Ease-Out) | Animate ANY property over time |
| **Color** | set_color_wheel_param (lift/gamma/gain/offset x RGBM), apply_lut, add_node, copy_grade | Full color grading pipeline |
| **Color Presets** | save_color_preset, apply_color_preset, export_lut | Reusable looks, batch grading |
| **Render** | add_to_render_queue, start_render, clear_render_queue | Export final output |
| **Transcription** | transcribe_audio, clear_transcription | Speech-to-text for dialogue-aware editing |
| **Organization** | create_bin, move_media_to_bin, import_media | Media management |
| **Project** | create_project, set_timeline_format_tool, set_color_science_mode_tool, set_color_space_tool | Project setup |

### The Power Multiplier: Keyframes

Keyframes turn static tools into animations. Any property (zoom, pan, opacity, volume, crop, rotation) can be keyframed with frame-level precision and interpolation curves. This is what makes the demos go from "neat" to "cinematic."

---

## Demo Scenarios

---

### Demo 1: "The Smart Highlight Reel"

**One-liner**: Drop a 5-min raw action clip. Say _"Make me a 60-second highlight reel with slo-mo on the best moments."_

**Source**: Raw footage of skateboarding, parkour, sports, or dance. Needs distinct peak-action moments mixed with downtime.

**Tool chain**:
```
1.  [READ]  resolve://timeline-clips                → get clip info, file path, framerate
2.  [VLM]   analyze-video                           → "List every distinct high-energy moment
                                                       (jumps, tricks, celebrations, impacts).
                                                       For each give start_time end_time in
                                                       HH:MM:SS. Rate each 1-10 for visual impact."
3.  [TOOL]  create_timeline("Highlight Reel")       → new timeline
4.  [TOOL]  create_sub_clip x N                     → extract each highlight segment
5.  [TOOL]  add_clip_to_timeline x N                → assemble in impact-ranked order
6.  [READ]  resolve://timeline-items                → get timeline item IDs
7.  [TOOL]  set_timeline_item_retime x N            → 0.4x speed + OpticalFlow on top moments
8.  [TOOL]  add_keyframe (speed) x N                → speed ramp: normal -> slo-mo -> normal
9.  [TOOL]  set_keyframe_interpolation (Bezier) x N → smooth speed transitions
10. [TOOL]  add_marker x N                          → Red=peak, Blue=transition, Green=celebration
11. [TOOL]  set_timeline_item_audio x N             → lower audio on slo-mo sections (volume 0.3)
12. [TOOL]  add_to_render_queue + start_render      → export
```

**What makes it impressive**: The agent REASONS about which moments deserve slo-mo based on Cumulus Labs VLM impact ratings. Builds keyframed speed ramps with bezier curves, not flat speed changes. Colored markers show the agent's decision-making process.

**Unique tools**: 10 tools + 2 resources, ~40 total calls

---

### Demo 2: "Mood-Based Color Grading"

**One-liner**: Load 6-8 clips. Say _"Analyze the mood of each clip and apply a matching color grade."_

**Source**: Clips with clearly different moods — sunny beach, dark alley, family dinner, rainy window, concert, quiet library. The more variety, the more dramatic.

**Tool chain**:
```
1.  [READ]  resolve://timeline-items                → get all clips + IDs
2.  [READ]  resolve://timeline-item/{id} x N        → file paths, durations
3.  [VLM]   analyze-video x N                       → "Classify mood: warm/joyful, cold/tense,
                                                       melancholic, energetic, serene, dramatic.
                                                       Describe dominant colors and lighting."
4.  [TOOL]  switch_page("color")                    → Color page
5.  [TOOL]  add_node("serial") x N                  → grading node per clip
6.  [TOOL]  set_color_wheel_param x N               → per mood:
             warm/joyful:  gain.red +0.05, lift.blue -0.03
             cold/tense:   gain.blue +0.06, lift.red -0.04
             melancholic:  gamma.master -0.04 (desaturated)
             energetic:    gain.red +0.03, gain.green +0.02
             dramatic:     lift.master -0.05, gain.master +0.04
7.  [TOOL]  save_color_preset x N                   → "Warm Joyful", "Cold Tense", etc.
8.  [TOOL]  copy_grade (matching moods)             → consistent look across similar clips
9.  [TOOL]  add_marker x N                          → color-coded by mood category
10. [TOOL]  export_lut x N                          → reusable LUTs per mood
```

**What makes it impressive**: Cumulus Labs VLM acts as a "creative director." The agent translates abstract concepts (mood) into concrete color science (wheel parameters). Saving presets + exporting LUTs shows the agent building a reusable creative toolkit. This is what a colorist does manually over hours.

**Unique tools**: 8 tools + 2 resources

---

### Demo 3: "Cinematic Ken Burns from Photos"

**One-liner**: Import 10 high-res photos. Say _"Turn these into a cinematic slideshow. Find the subject in each and create unique camera moves."_

**Source**: 10 high-resolution still photos. Mix of landscape, portrait, architecture, macro. Higher resolution = more room to zoom.

**Tool chain**:
```
1.  [TOOL]  import_media x 10                       → import all photos
2.  [TOOL]  create_timeline("Ken Burns Slideshow")  → new timeline
3.  [TOOL]  add_clip_to_timeline x 10               → add all photos (~5s each)
4.  [READ]  resolve://timeline-items                → get item IDs
5.  [VLM]   analyze-video x 10                      → "Where is the main subject? Report position
                                                       as % from left and % from top."
6.  [TOOL]  enable_keyframes x 10                   → enable keyframe mode
7.  [TOOL]  add_keyframe (ZoomX, frame=start) x 10  → starting zoom
8.  [TOOL]  add_keyframe (ZoomX, frame=end) x 10    → ending zoom
9.  [TOOL]  add_keyframe (ZoomY, start+end) x 10    → match ZoomX
10. [TOOL]  add_keyframe (Pan, start) x 10           → start horizontal position
11. [TOOL]  add_keyframe (Pan, end) x 10             → end position (centered on subject)
12. [TOOL]  add_keyframe (Tilt, start+end) x 10      → vertical positions
13. [TOOL]  set_keyframe_interpolation (Ease) x 20+  → smooth in/out
14. [TOOL]  set_timeline_item_composite (opacity)     → crossfade transitions
15. [TOOL]  add_keyframe (Opacity, last frames) x 9  → keyframed crossfades
16. [TOOL]  add_to_render_queue + start_render
```

**What makes it impressive**: 80-100+ tool calls. Cumulus Labs VLM finds what's interesting in each photo, agent creates UNIQUE camera moves per photo (push-in on landscapes, pull-out on portraits, pan across panoramas). Bezier interpolation makes it buttery smooth. Not cookie-cutter.

**Unique tools**: 9 tools, ~80-100 total calls

---

### Demo 4: "Auto-Reframe for TikTok"

**One-liner**: Take a 16:9 video. Say _"Reframe this for TikTok vertical. Follow the main subject."_

**Source**: Talking-head, interview, or single-subject clip in widescreen 16:9. Subject should move around the frame somewhat.

**Tool chain**:
```
1.  [READ]  resolve://current-timeline               → framerate, resolution
2.  [READ]  resolve://timeline-items                  → clip IDs
3.  [TOOL]  create_timeline("Social 9x16")           → new timeline
4.  [TOOL]  set_timeline_format_tool(1080, 1920, fps) → 9:16 vertical format
5.  [TOOL]  add_clip_to_timeline                      → add the clip
6.  [VLM]   analyze-video                             → "Track the main person's face position.
                                                        Sample every 2 seconds. Report timestamp
                                                        and horizontal position as % from left."
7.  [TOOL]  enable_keyframes                          → enable keyframes
8.  [TOOL]  set_timeline_item_crop (top/bottom)       → crop to 9:16 area
9.  [TOOL]  add_keyframe (Pan) x N                    → keyframe horizontal position every 2s
10. [TOOL]  set_keyframe_interpolation (Bezier) x N   → smooth panning
11. [TOOL]  set_timeline_item_transform (Zoom)        → slight zoom to fill frame
12. [TOOL]  add_to_render_queue + start_render
```

**What makes it impressive**: Replicates a feature that costs $20/month from dedicated SaaS tools. Cumulus Labs VLM does "face tracking" by sampling positions, agent converts to keyframed pan with smooth interpolation. Subject stays centered automatically.

**Unique tools**: 8 tools + 2 resources

---

### Demo 5: "Scene-Aware Audio Mix"

**One-liner**: Load a vlog with mixed environments. Say _"Analyze each scene and set appropriate audio levels."_

**Source**: Vlog or documentary with scene changes — interview segments, outdoor b-roll with ambient noise, music at a venue. Audio levels should be noticeably inconsistent.

**Tool chain**:
```
1.  [READ]  resolve://timeline-items                  → all clips + IDs
2.  [VLM]   analyze-video                             → "Classify each scene by audio type:
                                                        dialogue/ambient/music/action/silence.
                                                        Give timestamps for each."
3.  [TOOL]  create_sub_clip x N                       → split at scene boundaries
4.  [TOOL]  create_timeline("Mixed Edit")             → new timeline
5.  [TOOL]  add_clip_to_timeline x N                  → assemble segments
6.  [READ]  resolve://timeline-items                  → new item IDs
7.  [TOOL]  set_timeline_item_audio x N               → per type:
             dialogue: volume 1.4       ambient: volume 0.5
             music:    volume 0.8       action:  volume 1.0
             silence:  volume 0.2
8.  [TOOL]  add_keyframe (Volume, transitions) x N    → smooth volume fades between scenes
9.  [TOOL]  set_keyframe_interpolation (Ease) x N     → no hard audio cuts
10. [TOOL]  add_marker x N                            → Purple=dialogue, Green=ambient, Yellow=music
11. [TOOL]  transcribe_audio (dialogue clips)         → speech-to-text for reference
```

**What makes it impressive**: Cumulus Labs VLM classifies audio scenes VISUALLY (sees someone talking vs. empty landscape). Agent builds a full audio mix with keyframed volume transitions. Adding transcription on dialogue clips shows multi-modal reasoning.

**Unique tools**: 9 tools + 2 resources

---

### Demo 6: "The Full Production Pipeline" (THE FINALE)

**One-liner**: Import 15 raw clips + music. Say _"Organize, build a rough cut, color grade by mood, slo-mo action shots, stabilize handheld, mix audio, and render."_

**Source**: 15 varied clips that tell a loose story (day in the life, travel montage, event coverage). Mix of handheld/tripod, indoor/outdoor, action/calm. Plus one music track.

**Tool chain**:
```
PHASE 1: ORGANIZE
1.  [TOOL]  import_media x 16                         → import clips + audio
2.  [VLM]   analyze-video x 15                        → classify each clip:
                                                        type (action/dialogue/b-roll/transition)
                                                        mood (energetic/calm/dramatic/joyful)
                                                        quality (shaky? underexposed?)
3.  [TOOL]  create_bin("Action") + create_bin("Dialogue") + create_bin("B-Roll")
4.  [TOOL]  move_media_to_bin x 15                    → sort clips into bins

PHASE 2: ASSEMBLE
5.  [TOOL]  create_timeline("Main Edit")              → new timeline
6.  [TOOL]  create_sub_clip x N                       → trim to best segments
7.  [TOOL]  add_clip_to_timeline x N                  → assemble: dialogue -> b-roll -> action
8.  [TOOL]  add_clip_to_timeline (music)              → add music track

PHASE 3: TIMING
9.  [READ]  resolve://timeline-items                  → get item IDs
10. [TOOL]  set_timeline_item_retime (action clips)   → 0.5x + OpticalFlow
11. [TOOL]  add_keyframe (speed ramps) x N            → ramp in/out of slo-mo
12. [TOOL]  set_keyframe_interpolation (Bezier) x N   → smooth ramps

PHASE 4: FIX
13. [VLM]   analyze-video (shaky clips)               → "Rate camera shake 1-10"
14. [TOOL]  set_timeline_item_stabilization x N        → Perspective, strength from VLM

PHASE 5: COLOR
15. [TOOL]  switch_page("color")
16. [TOOL]  add_node("serial") x N                    → grading node per clip
17. [TOOL]  set_color_wheel_param x N                 → mood-based grades
18. [TOOL]  copy_grade (matching moods)               → consistent look
19. [TOOL]  save_color_preset x N                     → save the looks

PHASE 6: AUDIO
20. [TOOL]  set_timeline_item_audio x N               → dialogue 1.3, b-roll 0.4, music 0.7
21. [TOOL]  add_keyframe (Volume) x N                 → fade music under dialogue

PHASE 7: FINISH
22. [TOOL]  add_marker x N                            → Red=action, Blue=dialogue, Green=b-roll
23. [TOOL]  add_to_render_queue("YouTube 1080p")
24. [TOOL]  start_render
```

**What makes it impressive**: 24 steps, 7 phases, 18 distinct tools, 100+ total calls. Full post-production pipeline. The agent makes creative decisions (what deserves slo-mo, what needs stabilization, what color grade matches what mood) all informed by Cumulus Labs VLM analysis. What normally takes an editor hours, done in minutes.

**Unique tools**: 18 tools + 1 resource, ~100+ total calls

---

## Tool Usage Heatmap

| Tool | Demos | Role |
|------|-------|------|
| **analyze-video (Cumulus Labs VLM)** | 1,2,3,4,5,6 | The brain |
| **add_keyframe** | 1,3,4,5,6 | The power move (animates everything) |
| **set_keyframe_interpolation** | 1,3,4,5,6 | Makes it cinematic |
| **create_sub_clip** | 1,5,6 | Surgical extraction |
| **add_clip_to_timeline** | 1,2,3,4,5,6 | Assembly |
| **set_timeline_item_retime** | 1,6 | Slo-mo / speed ramps |
| **set_color_wheel_param** | 2,6 | Color grading |
| **set_timeline_item_audio** | 1,5,6 | Audio mixing |
| **set_timeline_item_transform** | 3,4 | Camera moves / reframing |
| **add_marker** | 1,2,5,6 | Visual organization |
| **set_timeline_item_stabilization** | 6 | Quality fix |
| **set_timeline_item_composite** | 3 | Visual effects |
| **transcribe_audio** | 5 | Speech-to-text |
| **switch_page** | 2,6 | Navigate DaVinci pages |
| **create_timeline** | 1,3,4,5,6 | New timelines |
| **create_bin / move_media_to_bin** | 6 | Organization |
| **copy_grade** | 2,6 | Batch grading |
| **save_color_preset / export_lut** | 2,6 | Reusable looks |

---

## What to Source

| Demo | Clips Needed | Audio | Duration | Ideal Content |
|------|-------------|-------|----------|---------------|
| 1. Highlight Reel | 1 long action clip | None (original) | 5 min raw | Skateboarding, parkour, sports, dance |
| 2. Mood Grading | 6-8 varied mood clips (30s each) | None | ~4 min total | Beach + alley + dinner + rain + concert + library |
| 3. Ken Burns | 10 high-res photos | Optional music | N/A | Landscape, portrait, architecture, macro |
| 4. Social Reframe | 1 talking-head 16:9 clip | None (original) | 2 min | Person moving in frame |
| 5. Audio Mix | 1 vlog/doc with mixed scenes | None (original) | 3 min | Varied environments, inconsistent audio |
| 6. Full Pipeline | 15 varied clips + 1 music track | 1 track (3 min) | ~8 min raw | Day-in-the-life, travel, event coverage |

---

## Recommended Demo Order (for a presentation)

1. **Demo 1 - Highlight Reel**: Fast, visual, immediately impressive. ~2 min runtime.
2. **Demo 4 - Social Reframe**: Practical, relatable. Shows Cumulus Labs VLM face tracking. ~1 min.
3. **Demo 2 - Mood Grading**: Artistic, creative. Cumulus Labs VLM as creative director. ~2 min.
4. **Demo 6 - Full Pipeline**: THE FINALE. Everything at once. Jaw-dropper. ~5 min.

Skip 3 and 5 for time — they're strong but less visually dramatic.

---

## Quick Reference: Natural Language -> Tool Chains

These are things you can just SAY to the agent and it will figure out the tools:

| You say | Agent does |
|---------|-----------|
| "Cut out the person jumping" | Cumulus Labs VLM find timestamps -> create_sub_clip -> add_clip_to_timeline |
| "Make this slo-mo with a smooth ramp" | set_timeline_item_retime -> add_keyframe (speed) -> set_keyframe_interpolation (Bezier) |
| "This looks too cold, warm it up" | switch_page(color) -> add_node -> set_color_wheel_param (gain.red up, lift.blue down) |
| "Stabilize the shaky parts" | Cumulus Labs VLM rate shake -> set_timeline_item_stabilization (strength from rating) |
| "Make the dialogue louder" | Cumulus Labs VLM find dialogue segments -> set_timeline_item_audio (volume 1.4) |
| "Add a slow zoom on the landscape" | enable_keyframes -> add_keyframe (ZoomX start=1.0, end=1.15) -> Ease interpolation |
| "Organize my clips by type" | Cumulus Labs VLM classify -> create_bin x N -> move_media_to_bin x N |
| "Reframe this vertical for TikTok" | set_timeline_format_tool(1080,1920) -> Cumulus Labs VLM track face -> keyframed Pan |
| "Grade this like a Michael Mann film" | add_node -> set_color_wheel_param (cold blues, crushed blacks, desaturated) |
| "Cross-dissolve between these clips" | set_timeline_item_composite -> add_keyframe (Opacity) at tail/head |
| "Render this for YouTube" | add_to_render_queue("YouTube 1080p") -> start_render |
| "Mark all the best moments" | Cumulus Labs VLM find highlights -> add_marker (Red) at each timestamp |
| "Transcribe the interview" | transcribe_audio(clip_name, "en-US") |
| "Save this color look for later" | save_color_preset -> export_lut |

---

## Recent Changes

### Fixed: `create_sub_clip` now works

**Problem:** Used `MediaPool.CreateSubClip()` which doesn't exist in DaVinci Resolve's API.

**Fix:** Replaced with `MediaPool.AppendToTimeline()` using subclip dictionaries — the correct DaVinci 20.x API. Now takes `clip_name`, `start_frame`, `end_frame` and appends that segment to the current timeline.

**Verified:** "Successfully added segment of 'running_and_jumping_original.mp4' to timeline (frames 72-144, 72 frames)"

**Files changed:** `davinci-resolve-mcp/src/api/media_operations.py`, `davinci-resolve-mcp/src/resolve_mcp_server.py`

### Added: Resource Proxying (31 read tools + 7 template tools)

The Python DaVinci MCP has 38 read-only resources (timeline info, clips, media pool, color presets, etc.) that weren't being forwarded. Now all resources are proxied as `resolve-read-*` tools:

| Tool | What it reads |
|------|---------------|
| `resolve-read-current-timeline` | Timeline name, fps, resolution, duration |
| `resolve-read-timeline-clips` | All clips with start_frame, end_frame, track |
| `resolve-read-timeline-items` | All items with IDs (needed for transform/retime) |
| `resolve-read-media-pool-clips` | Available source media |
| `resolve-read-project-settings` | All project settings |
| `resolve-read-color-presets` | Available color presets |
| `resolve-read-delivery-render-presets` | Render presets |
| `resolve-read-timeline-item` | Specific item properties (param: `timeline_item_id`) |
| `resolve-read-color-wheels` | Color wheel params (param: `node_index`) |

**Total tools: 123** (83 action + 31 read + 7 parameterized read + 1 aggregator + 1 VLM)

### Added: `get-editing-context` — One-Call State Aggregator

Single tool call that reads 4 resources in parallel and returns everything the agent needs:
- Current project name
- Current timeline (name, fps, resolution, start timecode)
- All timeline clips (positions, durations)
- Media pool clips

Agent calls this FIRST before any editing operation. Resilient to individual resource failures.

### Added: `video-editing-assistant` — Workflow Prompt

MCP prompt that teaches the agent:
1. The `get-editing-context` → `analyze-video` → convert timestamps → execute tools pattern
2. Timestamp-to-frame conversion formula: `frame = (h*3600 + m*60 + s) * fps`
3. Which `resolve-read-*` tools to use for state, which action tools for edits
4. Key rules: always read context first, never assume frame rate, verify after changes

Discoverable by any MCP client via `listPrompts()`.

### Architecture Update

```
Claude (Agent)
    |
    v
[mcp-use Server]  (123 tools + 1 prompt)
    |
    ├── analyze-video ──> Cumulus Labs VLM (Qwen3-VL)
    ├── get-editing-context ──> reads 4 resources in parallel
    ├── resolve-read-* (38 tools) ──> readResource() / readResourceTemplate()
    ├── resolve-* (83 tools) ──> callTool()
    └── video-editing-assistant prompt ──> workflow guide
                |
            [stdio MCP]
                |
                v
        Python DaVinci MCP → DaVinci Resolve (local)
```

### Verified E2E

| Test | Result |
|------|--------|
| `get-editing-context` | Returns project, timeline (fps=24, 1920x1080), clips |
| `resolve-read-current-timeline` | `{name: "Timeline 1", fps: 24.0, resolution: {1920x1080}}` |
| `analyze-video` | VLM returns jump timestamps from video |
| `resolve-create_sub_clip` | Adds frame segment to DaVinci timeline |
| `resolve-add_marker` | Places colored markers |
| `video-editing-assistant` prompt | Discoverable, returns workflow guide |

---

## MCP App Widgets (v2.1)

### Changes

Converted from text-only MCP server to an MCP App with interactive React widgets rendered inline in the conversation.

**Architecture change:**
```
BEFORE: Tool call → returns text() → user sees nothing visual
AFTER:  Tool call → returns widget({ props, output }) → user sees interactive React UI
```

**3 widgets added** in `server/resources/`:

| Widget | Tool | What It Shows |
|--------|------|---------------|
| `timeline-viewer.tsx` | `get-resolve-state` | Visual timeline with clip bars (proportional width), markers as colored lines, media pool grid, clip detail on click, "Analyze with VLM" button |
| `vlm-result.tsx` | `analyze-video` | Question/response display, "Apply Edits" / "More Detail" / "Retry" action buttons via sendFollowUpMessage |
| `script-result.tsx` | `execute-resolve-script` | Success/failure badge, stdout in monospace, stderr in red, "Refresh Timeline" button (calls get-resolve-state via useCallTool), "Help Fix Error" button |

**Key patterns used:**
- `widget()` response helper: sends `props` to widget UI + `output` text to LLM
- `useWidgetTheme()` for dark/light mode support
- `sendFollowUpMessage()` for buttons that trigger new LLM turns
- `useCallTool("get-resolve-state")` for refresh button in script-result widget
- `McpUseProvider autoSize` wraps all widgets for auto iframe sizing

**Files modified:**
- `server/index.ts` — added `widget` config to all 3 tools, changed returns from `text()` to `widget()`
- `server/resources/timeline-viewer.tsx` — NEW
- `server/resources/vlm-result.tsx` — NEW
- `server/resources/script-result.tsx` — NEW

**Build:** `mcp-use build` compiles all 3 widgets successfully (3 widget bundles in dist/resources/widgets/)

---

## VLM Widget UX Fix + Prompt Efficiency

### Problem
Testing with skating.mp4 revealed: agent made 20 VLM calls (11+ min total), chunking video into 30s segments. Widget showed raw JSON, user couldn't understand results, buttons gave no context so agent re-analyzed.

### Fixes
1. **vlm-result.tsx** — Parses VLM JSON responses into structured segment list (time range, description, type badge, impact score). Falls back to plain text if not JSON. Buttons now include the actual findings in sendFollowUpMessage so agent doesn't re-analyze.
2. **index.ts** — Added `durationMs` prop to analyze-video (shows "Analyzed in 33.5s"). Added "VLM Efficiency Rules" to workflow prompt: analyze full video in ONE call, max 3 VLM calls per request, don't split into segments.
3. **Session logging** — Every tool call + output logged to `server/logs/session.jsonl` for debugging.

---

## Timeline Widget v2 — Video Preview + Better UI

### Changes
1. **Video serving route** — Added `/api/video?path=<filepath>` to `index.ts` via `server.app`. Streams local video files with range request support (seeking works). CORS enabled.
2. **timeline-viewer.tsx** — Full rewrite:
   - **Video preview** at top — `<video>` tag loads from the server route, click to play/pause, timecode overlay, auto-seeks to selected clip's start time
   - **Timeline tracks** — improved clip bars with names and frame counts, highlight glow on selected clip
   - **Clip detail panel** — shows start/end/duration in seconds + frames, file path, "Analyze with VLM" button
   - **Collapsible media pool** — hidden by default, expandable
   - **CSP configured** — `connectDomains: ["http://localhost:*"]` allows video loading
3. **Server port passed as prop** — `get-resolve-state` adds `_serverPort` to props so widget constructs correct video URLs

---

## Workflow Prompt Rewrite — Stop Chaotic Agent Behavior

### Problem
Session logs showed agent making 20+ VLM calls, 8+ debug scripts, firing tools in parallel causing widgets to appear out of order. User had to scroll up and down constantly.

### Fix
Rewrote WORKFLOW_PROMPT in `server/index.ts` with:
1. **Strict 4-phase workflow** — Understand → Plan → Execute → Verify, each with explicit rules
2. **Sequential tool ordering** — "DO NOT fire get-resolve-state and analyze-video at the same time"
3. **Anti-patterns section** — explicit "DO NOT" list based on observed bad behavior (no debug scripts, no re-analysis, no parallel VLM+state calls, max 2 VLM calls)
4. **Removed "Supports concurrent calls"** from analyze-video tool description
5. **Simplified example** — one clean highlight reel script instead of verbose multi-step walkthrough

---

## Production Readiness — Auth, Onboarding, Security

### Security Fixes
- **Path traversal fix** — `/api/video` now validates paths against allowed directories (~/Downloads, ~/Movies, ~/Desktop, ~/Documents, /tmp/resolve_preview)
- **CORS fix** — removed wildcard `*`, uses request origin or localhost
- **Range request validation** — bounds checking before buffer allocation
- **Python blocklist** — added `eval`, `exec`, `compile`, `os.exec*`, `os.spawn*`, `importlib`, `requests`, `httpx`. Case-insensitive matching.
- **Logs gitignored** — `logs/` added to `.gitignore`

### Supabase OAuth
- Added `oauthSupabaseProvider()` to MCPServer config (conditional — only when env var set)
- Supabase project: `YC-MCP-Hackathon` (hipzdfjljxcxkllkpjcd)
- Auto-handles JWT verification, `/authorize`, `/token`, `ctx.auth` in all tools

### Onboarding
- **Config module** (`server/src/config.ts`) — persists to `~/.videoeditor-mcp/config.json`, loads on startup
- **3 new tools**: `detect-setup-status` (checks DaVinci + VLM), `test-vlm-connection`, `save-setup`
- **Setup wizard widget** (`server/resources/setup-wizard.tsx`) — step-by-step: DaVinci status, VLM endpoint input + test button, save config
- Config applied to env vars on startup so VLM client and executor use saved settings

### New Files
- `server/src/config.ts` — config load/save/apply
- `server/resources/setup-wizard.tsx` — onboarding widget

### Total: 4 widgets, 6 tools, 1 prompt
