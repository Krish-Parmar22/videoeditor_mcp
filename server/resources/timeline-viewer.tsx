import { useState, useRef, useEffect } from "react";
import {
  McpUseProvider,
  useWidget,
  useWidgetTheme,
  useCallTool,
  type WidgetMetadata,
} from "mcp-use/react";
import { z } from "zod";

// --- Schema ---

const clipSchema = z.object({
  name: z.string(),
  track: z.number(),
  start_frame: z.number(),
  end_frame: z.number(),
  duration_frames: z.number(),
  file_path: z.string().optional(),
});

const poolClipSchema = z.object({
  name: z.string(),
  file_path: z.string().optional(),
  duration: z.string().optional(),
  type: z.string().optional(),
  bin: z.string().optional(),
});

const propsSchema = z.object({
  project: z.string().nullable(),
  all_timelines: z.array(z.string()),
  timeline: z
    .object({
      name: z.string(),
      fps: z.number(),
      start_frame: z.number(),
      end_frame: z.number(),
      duration_frames: z.number(),
      duration_seconds: z.number(),
      start_timecode: z.string().optional(),
      resolution: z
        .object({
          width: z.union([z.string(), z.number()]),
          height: z.union([z.string(), z.number()]),
        })
        .optional(),
      video_tracks: z.number().optional(),
      audio_tracks: z.number().optional(),
    })
    .nullable(),
  timeline_clips: z.array(clipSchema),
  markers: z.record(z.string(), z.any()),
  media_pool: z.array(poolClipSchema),
  _serverPort: z.number().optional(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Timeline viewer with video preview for DaVinci Resolve",
  props: propsSchema,
  exposeAsTool: false,
  metadata: {
    csp: { connectDomains: ["http://localhost:*"] },
  },
};

type Props = z.infer<typeof propsSchema>;
type Clip = z.infer<typeof clipSchema>;

// --- Helpers ---

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function videoUrl(serverPort: number, filePath: string): string {
  return `http://localhost:${serverPort}/api/video?path=${encodeURIComponent(filePath)}`;
}

// --- Colors ---

const TRACK_COLORS = [
  "#4a9eff", "#51cf66", "#ff6b6b", "#ffd43b",
  "#cc5de8", "#20c997", "#ff922b", "#845ef7",
];

const MARKER_COLORS: Record<string, string> = {
  Red: "#ff4444", Blue: "#4a9eff", Green: "#51cf66", Yellow: "#ffd43b",
  Cyan: "#22d3ee", Pink: "#f472b6", Purple: "#a855f7",
};

function useColors() {
  const theme = useWidgetTheme();
  return {
    bg: theme === "dark" ? "#111118" : "#ffffff",
    bgSecondary: theme === "dark" ? "#1a1a28" : "#f8f9fa",
    bgTrack: theme === "dark" ? "#0d0d16" : "#f0f0f4",
    text: theme === "dark" ? "#e0e0e0" : "#1a1a1a",
    textSecondary: theme === "dark" ? "#8888a0" : "#888",
    border: theme === "dark" ? "#2a2a3a" : "#e0e0e0",
    accent: theme === "dark" ? "#4a9eff" : "#0066cc",
    selected: theme === "dark" ? "#1e3050" : "#e3f2fd",
    panelBg: theme === "dark" ? "#14141f" : "#fafafa",
  };
}

// --- Video Preview ---

function VideoPreview({
  clip,
  serverPort,
  fps,
  colors,
}: {
  clip: Clip | null;
  serverPort: number;
  fps: number;
  colors: ReturnType<typeof useColors>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  const src = clip?.file_path ? videoUrl(serverPort, clip.file_path) : null;

  // Seek to clip's start time when clip changes
  useEffect(() => {
    if (videoRef.current && clip && fps > 0) {
      const startSec = clip.start_frame / fps;
      videoRef.current.currentTime = startSec;
      setPlaying(false);
    }
  }, [clip?.start_frame, clip?.file_path, fps]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setPlaying(!playing);
  };

  if (!src) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: "16/9",
          backgroundColor: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          color: "#555",
          fontSize: 14,
        }}
      >
        Select a clip to preview
      </div>
    );
  }

  return (
    <div style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onClick={togglePlay}
        style={{
          width: "100%",
          display: "block",
          backgroundColor: "#000",
          cursor: "pointer",
        }}
      />
      {/* Overlay controls */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "8px 12px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          onClick={togglePlay}
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            fontSize: 18,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            color: "#ddd",
          }}
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#aaa",
          }}
        >
          {clip?.name}
        </span>
      </div>
    </div>
  );
}

// --- Timeline Track ---

function TimelineTrack({
  clips,
  trackIdx,
  totalFrames,
  selectedClip,
  onSelectClip,
  colors,
}: {
  clips: Clip[];
  trackIdx: number;
  totalFrames: number;
  selectedClip: Clip | null;
  onSelectClip: (clip: Clip) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const color = TRACK_COLORS[(trackIdx - 1) % TRACK_COLORS.length];

  return (
    <div
      style={{
        position: "relative",
        height: 44,
        background: colors.bgTrack,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 6,
          top: 4,
          fontSize: 10,
          color: colors.textSecondary,
          zIndex: 1,
          fontWeight: 600,
        }}
      >
        V{trackIdx}
      </span>
      {clips.map((clip, i) => {
        const left = (clip.start_frame / totalFrames) * 100;
        const width = (clip.duration_frames / totalFrames) * 100;
        const isSelected =
          selectedClip?.name === clip.name &&
          selectedClip?.start_frame === clip.start_frame;

        return (
          <div
            key={`${clip.name}-${i}`}
            onClick={() => onSelectClip(clip)}
            title={`${clip.name} (${clip.duration_frames} frames)`}
            style={{
              position: "absolute",
              left: `${left}%`,
              width: `${Math.max(width, 1.5)}%`,
              top: 6,
              bottom: 6,
              backgroundColor: isSelected ? color : `${color}bb`,
              borderRadius: 4,
              cursor: "pointer",
              border: isSelected ? "2px solid #fff" : `1px solid ${color}`,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              paddingLeft: 6,
              paddingRight: 4,
              fontSize: 11,
              fontWeight: 500,
              color: "#fff",
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
              whiteSpace: "nowrap",
              transition: "background-color 0.1s, border 0.1s",
              boxShadow: isSelected ? "0 0 8px rgba(74,158,255,0.4)" : "none",
            }}
          >
            {width > 6 && (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                {clip.name}
              </span>
            )}
            {width > 12 && (
              <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 4 }}>
                {clip.duration_frames}f
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Clip Detail Panel ---

function ClipDetail({
  clip,
  fps,
  serverPort,
  colors,
  onAnalyze,
}: {
  clip: Clip;
  fps: number;
  serverPort: number;
  colors: ReturnType<typeof useColors>;
  onAnalyze: () => void;
}) {
  const startSec = fps > 0 ? (clip.start_frame / fps).toFixed(2) : "?";
  const endSec = fps > 0 ? (clip.end_frame / fps).toFixed(2) : "?";
  const durSec = fps > 0 ? (clip.duration_frames / fps).toFixed(2) : "?";

  return (
    <div
      style={{
        padding: 12,
        backgroundColor: colors.selected,
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
          {clip.name}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "2px 12px",
            fontSize: 12,
            color: colors.textSecondary,
          }}
        >
          <span>Start: {startSec}s</span>
          <span>End: {endSec}s</span>
          <span>Duration: {durSec}s</span>
          <span>Track: V{clip.track}</span>
          <span>Frames: {clip.duration_frames}</span>
          <span>FPS: {fps}</span>
        </div>
        {clip.file_path && (
          <div
            style={{
              fontSize: 11,
              color: colors.textSecondary,
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {clip.file_path}
          </div>
        )}
      </div>
      {clip.file_path && (
        <button
          onClick={onAnalyze}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 500,
            border: "none",
            borderRadius: 6,
            backgroundColor: colors.accent,
            color: "#fff",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Analyze with VLM
        </button>
      )}
    </div>
  );
}

// --- Main Widget ---

export default function TimelineViewer() {
  const { props, isPending, sendFollowUpMessage } = useWidget<Props>();
  const { callToolAsync: runScript, isPending: isSwitching } = useCallTool("execute-resolve-script");
  const { callTool: refreshState } = useCallTool("get-resolve-state");
  const colors = useColors();
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [showPool, setShowPool] = useState(false);

  const switchTimeline = async (name: string) => {
    if (name === props.timeline?.name) return;
    await runScript({
      code: `tl = project.GetTimelineByIndex(1)\nfor i in range(1, project.GetTimelineCount() + 1):\n    t = project.GetTimelineByIndex(i)\n    if t and t.GetName() == ${JSON.stringify(name)}:\n        project.SetCurrentTimeline(t)\n        print(f"Switched to: {t.GetName()}")\n        break`,
      description: `Switch to timeline: ${name}`,
    });
    setSelectedClip(null);
    refreshState({});
  };

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
          Loading project state...
        </div>
      </McpUseProvider>
    );
  }

  const tl = props.timeline;
  const fps = tl?.fps || 0;
  const totalFrames = tl?.duration_frames || 0;
  const allTimelines = props.all_timelines || [];
  const timelineClips = props.timeline_clips || [];
  const safeMarkers = props.markers || {};
  const mediaPool = props.media_pool || [];
  const serverPort = props._serverPort || 3000;

  // Group clips by track
  const tracks = new Map<number, Clip[]>();
  for (const clip of timelineClips) {
    const arr = tracks.get(clip.track) || [];
    arr.push(clip);
    tracks.set(clip.track, arr);
  }
  const sortedTracks = Array.from(tracks.entries()).sort(([a], [b]) => a - b);

  // Auto-select first clip if none selected
  const activeClip = selectedClip || timelineClips[0] || null;

  return (
    <McpUseProvider autoSize>
      <div
        style={{
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            padding: "10px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {props.project || "No Project"}
            </h2>
          </div>
          {/* Timeline switcher — always show if there are timelines */}
          {allTimelines.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {allTimelines.map((name) => {
                const isActive = name === tl?.name;
                return (
                  <button
                    key={name}
                    onClick={() => switchTimeline(name)}
                    disabled={isActive || isSwitching}
                    style={{
                      padding: "4px 12px",
                      fontSize: 11,
                      fontWeight: isActive ? 600 : 400,
                      borderRadius: 6,
                      backgroundColor: isActive ? colors.accent : colors.bgTrack,
                      color: isActive ? "#fff" : colors.text,
                      border: `1px solid ${isActive ? colors.accent : colors.border}`,
                      cursor: isActive || isSwitching ? "default" : "pointer",
                      opacity: isSwitching && !isActive ? 0.5 : 1,
                    }}
                  >
                    {isSwitching && !isActive ? "switching..." : name}
                  </button>
                );
              })}
            </div>
          )}
          {tl && (
            <span style={{ fontSize: 11, color: colors.textSecondary, fontFamily: "monospace" }}>
              {fps}fps · {tl.resolution ? `${tl.resolution.width}x${tl.resolution.height}` : ""} · {tl.duration_seconds.toFixed(1)}s
            </span>
          )}
        </div>

        {/* Video preview */}
        <div style={{ padding: 12, paddingBottom: 8 }}>
          <VideoPreview
            clip={activeClip}
            serverPort={serverPort}
            fps={fps}
            colors={colors}
          />
        </div>

        {/* Timeline tracks */}
        {tl && timelineClips.length > 0 ? (
          <div
            style={{
              margin: "0 12px",
              borderRadius: 8,
              overflow: "hidden",
              border: `1px solid ${colors.border}`,
            }}
          >
            {/* Marker lane */}
            {Object.keys(safeMarkers).length > 0 && (
              <div
                style={{
                  position: "relative",
                  height: 14,
                  background: colors.bgTrack,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                {Object.entries(safeMarkers).map(([frame, marker]) => {
                  const pct = (Number(frame) / totalFrames) * 100;
                  const c = MARKER_COLORS[marker.color] || "#ff4444";
                  return (
                    <div
                      key={frame}
                      title={`${marker.name || "Marker"} @ frame ${frame}`}
                      style={{
                        position: "absolute",
                        left: `${pct}%`,
                        top: 2,
                        bottom: 2,
                        width: 3,
                        backgroundColor: c,
                        borderRadius: 1,
                      }}
                    />
                  );
                })}
              </div>
            )}

            {sortedTracks.map(([trackIdx, trackClips]) => (
              <TimelineTrack
                key={trackIdx}
                clips={trackClips}
                trackIdx={trackIdx}
                totalFrames={totalFrames}
                selectedClip={activeClip}
                onSelectClip={setSelectedClip}
                colors={colors}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              margin: "0 12px",
              padding: 24,
              textAlign: "center",
              color: colors.textSecondary,
              border: `1px dashed ${colors.border}`,
              borderRadius: 8,
            }}
          >
            {tl ? "No clips on timeline" : "No timeline selected"}
          </div>
        )}

        {/* Clip detail panel */}
        {activeClip && (
          <div style={{ padding: "8px 12px 0" }}>
            <ClipDetail
              clip={activeClip}
              fps={fps}
              serverPort={serverPort}
              colors={colors}
              onAnalyze={() =>
                sendFollowUpMessage(
                  `Analyze the video "${activeClip.name}" at path "${activeClip.file_path}" using the VLM. Find all notable moments with timestamps.`
                )
              }
            />
          </div>
        )}

        {/* Media pool — collapsible */}
        {mediaPool.length > 0 && (
          <div style={{ padding: "8px 12px 12px" }}>
            <button
              onClick={() => setShowPool(!showPool)}
              style={{
                background: "none",
                border: "none",
                color: colors.textSecondary,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                padding: "4px 0",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {showPool ? "▾" : "▸"} Media Pool ({mediaPool.length})
            </button>
            {showPool && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {mediaPool.map((item, i) => (
                  <div
                    key={`${item.name}-${i}`}
                    style={{
                      padding: 8,
                      fontSize: 12,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      backgroundColor: colors.bgSecondary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                    {item.duration && (
                      <div style={{ color: colors.textSecondary, fontSize: 11 }}>
                        {item.duration}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </McpUseProvider>
  );
}
