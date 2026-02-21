import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const RESOLVE_SCRIPT_API =
  process.env.RESOLVE_SCRIPT_API ||
  "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting";
const RESOLVE_SCRIPT_LIB =
  process.env.RESOLVE_SCRIPT_LIB ||
  "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so";
const PYTHON = process.env.RESOLVE_PYTHON || "python3";
const TIMEOUT_MS = 60_000;

const BLOCKED_PATTERNS = [
  "os.system(", "os.popen(", "subprocess.", "__import__(",
  "shutil.rmtree", "os.remove(", "os.unlink(",
  "import socket", "import http", "import urllib",
  "eval(", "exec(", "compile(",
  "os.exec", "os.spawn", "importlib",
  "import requests", "import httpx",
];

const PREAMBLE = `
import sys, os, json

# Setup DaVinci Resolve environment
_api = os.environ.get("RESOLVE_SCRIPT_API", "${RESOLVE_SCRIPT_API}")
_modules = os.path.join(_api, "Modules")
if _modules not in sys.path:
    sys.path.append(_modules)

import DaVinciResolveScript as dvr
resolve = dvr.scriptapp("Resolve")
if not resolve:
    print("ERROR: Cannot connect to DaVinci Resolve. Is it running with Local scripting enabled?")
    sys.exit(1)

pm = resolve.GetProjectManager()
project = pm.GetCurrentProject()
media_pool = project.GetMediaPool() if project else None
timeline = project.GetCurrentTimeline() if project else None

def get_clip_by_name(name):
    """Find a media pool clip by name, searching root and subfolders."""
    if not media_pool:
        return None
    root = media_pool.GetRootFolder()
    if not root:
        return None
    for clip in (root.GetClipList() or []):
        if clip and clip.GetName() == name:
            return clip
    for folder in (root.GetSubFolderList() or []):
        for clip in (folder.GetClipList() or []):
            if clip and clip.GetName() == name:
                return clip
    return None

# --- User script begins below ---
`.trimStart();

const STATE_SCRIPT = `
import json

state = {}

# Project
state["project"] = project.GetName() if project else None

# All timelines
if project:
    tl_count = project.GetTimelineCount()
    state["all_timelines"] = []
    for i in range(tl_count):
        tl = project.GetTimelineByIndex(i + 1)
        state["all_timelines"].append(tl.GetName() if tl else f"Timeline {i+1}")
else:
    state["all_timelines"] = []

# Current timeline
if timeline:
    fps = float(timeline.GetSetting("timelineFrameRate"))
    state["timeline"] = {
        "name": timeline.GetName(),
        "fps": fps,
        "start_frame": timeline.GetStartFrame(),
        "end_frame": timeline.GetEndFrame(),
        "duration_frames": timeline.GetEndFrame() - timeline.GetStartFrame(),
        "duration_seconds": round((timeline.GetEndFrame() - timeline.GetStartFrame()) / fps, 2) if fps else 0,
        "start_timecode": timeline.GetStartTimecode(),
        "resolution": {
            "width": timeline.GetSetting("timelineResolutionWidth"),
            "height": timeline.GetSetting("timelineResolutionHeight"),
        },
        "video_tracks": timeline.GetTrackCount("video"),
        "audio_tracks": timeline.GetTrackCount("audio"),
    }

    # Timeline clips with file paths
    clips = []
    for track_idx in range(1, timeline.GetTrackCount("video") + 1):
        items = timeline.GetItemListInTrack("video", track_idx)
        for item in (items or []):
            clip_data = {
                "name": item.GetName(),
                "track": track_idx,
                "start_frame": item.GetStart(),
                "end_frame": item.GetEnd(),
                "duration_frames": item.GetDuration(),
            }
            try:
                mpi = item.GetMediaPoolItem()
                if mpi:
                    clip_data["file_path"] = mpi.GetClipProperty("File Path")
            except:
                pass
            clips.append(clip_data)
    state["timeline_clips"] = clips

    # Markers
    markers = timeline.GetMarkers() or {}
    state["markers"] = {str(k): v for k, v in markers.items()}
else:
    state["timeline"] = None
    state["timeline_clips"] = []
    state["markers"] = {}

# Media pool
pool_clips = []
if media_pool:
    root = media_pool.GetRootFolder()
    if root:
        for clip in (root.GetClipList() or []):
            try:
                props = clip.GetClipProperty() or {}
                pool_clips.append({
                    "name": clip.GetName(),
                    "file_path": props.get("File Path", "") if isinstance(props, dict) else "",
                    "duration": props.get("Duration", "") if isinstance(props, dict) else "",
                    "type": props.get("Type", "") if isinstance(props, dict) else "",
                })
            except:
                pool_clips.append({"name": clip.GetName()})
        for folder in (root.GetSubFolderList() or []):
            for clip in (folder.GetClipList() or []):
                try:
                    props = clip.GetClipProperty() or {}
                    pool_clips.append({
                        "name": clip.GetName(),
                        "bin": folder.GetName(),
                        "file_path": props.get("File Path", "") if isinstance(props, dict) else "",
                        "duration": props.get("Duration", "") if isinstance(props, dict) else "",
                        "type": props.get("Type", "") if isinstance(props, dict) else "",
                    })
                except:
                    pool_clips.append({"name": clip.GetName(), "bin": folder.GetName()})
state["media_pool"] = pool_clips

print(json.dumps(state, indent=2, default=str))
`.trimStart();

function validateCode(code: string): string | null {
  const lower = code.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return `Blocked: script contains "${pattern}" which is not allowed for safety`;
    }
  }
  return null;
}

function runPython(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const tmpFile = path.join(tmpdir(), `resolve_script_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    let stdout = "";
    let stderr = "";
    let settled = false;

    writeFile(tmpFile, script, "utf-8").then(() => {
      const proc = spawn(PYTHON, [tmpFile], {
        env: {
          ...process.env,
          RESOLVE_SCRIPT_API,
          RESOLVE_SCRIPT_LIB,
          PYTHONPATH: `${RESOLVE_SCRIPT_API}/Modules/`,
        },
        timeout: TIMEOUT_MS,
      });

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        unlink(tmpFile).catch(() => {});
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        unlink(tmpFile).catch(() => {});
        resolve({ stdout: "", stderr: err.message, exitCode: 1 });
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        unlink(tmpFile).catch(() => {});
        resolve({ stdout: stdout.trim(), stderr: "Script timed out after 60 seconds", exitCode: 1 });
      }, TIMEOUT_MS + 1000);
    });
  });
}

export async function executeResolveScript(code: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const violation = validateCode(code);
  if (violation) {
    return { stdout: "", stderr: violation, exitCode: 1 };
  }

  const fullScript = PREAMBLE + "\n" + code;
  return runPython(fullScript);
}

export async function getResolveState(): Promise<string> {
  const fullScript = PREAMBLE + "\n" + STATE_SCRIPT;
  const result = await runPython(fullScript);

  if (result.exitCode !== 0) {
    return JSON.stringify({
      error: result.stderr || "Failed to get resolve state",
      stdout: result.stdout,
    });
  }

  return result.stdout;
}
