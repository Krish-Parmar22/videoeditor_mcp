import { useState } from "react";
import {
  McpUseProvider,
  useWidget,
  useWidgetTheme,
  type WidgetMetadata,
} from "mcp-use/react";
import { z } from "zod";

// --- Schema ---

const propsSchema = z.object({
  videoPath: z.string(),
  question: z.string(),
  response: z.string(),
  videoName: z.string(),
  durationMs: z.number().optional(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "VLM video analysis result with confirmation actions",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

// --- Segment parsing ---

interface Segment {
  start: number;
  end: number;
  description: string;
  type?: string;
  impact?: number;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Try to extract structured segments from VLM response text. */
function parseSegments(responseText: string): Segment[] | null {
  try {
    // Find JSON array in the response (may be wrapped in markdown code blocks)
    const cleaned = responseText
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let arr: any[];
    try {
      arr = JSON.parse(cleaned);
    } catch {
      // Try to find array substring
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) return null;
      arr = JSON.parse(match[0]);
    }

    if (!Array.isArray(arr) || arr.length === 0) return null;

    const segments: Segment[] = [];
    for (const item of arr) {
      // Handle many different key names the VLM uses
      const start =
        item.start_sec ??
        item.start ??
        item.start_time ??
        item.start_timestamp ??
        (typeof item.timestamp === "string"
          ? parseFloat(item.timestamp.split("-")[0])
          : Array.isArray(item.timestamp)
            ? item.timestamp[0]
            : undefined);

      const end =
        item.end_sec ??
        item.end ??
        item.end_time ??
        item.end_timestamp ??
        (typeof item.timestamp === "string"
          ? parseFloat(item.timestamp.split("-")[1])
          : Array.isArray(item.timestamp)
            ? item.timestamp[1]
            : undefined);

      const description =
        item.description ?? item.desc ?? item.label ?? item.action ?? "";

      if (start == null || isNaN(Number(start))) continue;

      segments.push({
        start: Number(start),
        end: end != null && !isNaN(Number(end)) ? Number(end) : Number(start) + 2,
        description: String(description),
        type: item.type ?? item.category ?? undefined,
        impact:
          item.impact ?? item.rating ?? item.score ?? item.visual_impact ?? undefined,
      });
    }

    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

function segmentSummary(segments: Segment[]): string {
  return segments
    .map(
      (s) =>
        `- ${formatTime(s.start)}-${formatTime(s.end)}: ${s.description}${s.type ? ` [${s.type}]` : ""}${s.impact != null ? ` (impact: ${s.impact})` : ""}`
    )
    .join("\n");
}

// --- Colors ---

function useColors() {
  const theme = useWidgetTheme();
  return {
    bg: theme === "dark" ? "#1a1a2e" : "#ffffff",
    bgSecondary: theme === "dark" ? "#16213e" : "#f8f9fa",
    text: theme === "dark" ? "#e0e0e0" : "#1a1a1a",
    textSecondary: theme === "dark" ? "#a0a0b0" : "#666",
    border: theme === "dark" ? "#2a2a4a" : "#e0e0e0",
    accent: theme === "dark" ? "#4a9eff" : "#0066cc",
    accentGreen: theme === "dark" ? "#51cf66" : "#28a745",
    accentRed: theme === "dark" ? "#ff6b6b" : "#dc3545",
    codeBg: theme === "dark" ? "#0f0f23" : "#f5f5f5",
    questionBg: theme === "dark" ? "#1e2d4a" : "#e8f4fd",
    typeBg: theme === "dark" ? "#2a2a4a" : "#e9ecef",
  };
}

const TYPE_COLORS: Record<string, string> = {
  jump: "#ff6b6b",
  trick: "#ffd43b",
  grind: "#ff922b",
  transition: "#868e96",
  action: "#51cf66",
  dialogue: "#4a9eff",
  music: "#cc5de8",
};

// --- Components ---

function SegmentList({
  segments,
  colors,
}: {
  segments: Segment[];
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {segments.map((seg, i) => {
        const typeColor = seg.type
          ? TYPE_COLORS[seg.type.toLowerCase()] || colors.accent
          : undefined;

        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 6,
              backgroundColor: colors.bgSecondary,
              border: `1px solid ${colors.border}`,
            }}
          >
            {/* Time range */}
            <span
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                fontWeight: 600,
                color: colors.accent,
                whiteSpace: "nowrap",
                minWidth: 80,
                paddingTop: 1,
              }}
            >
              {formatTime(seg.start)}-{formatTime(seg.end)}
            </span>

            {/* Description + type */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, lineHeight: 1.4 }}>
                {seg.description}
              </span>
              {seg.type && (
                <span
                  style={{
                    display: "inline-block",
                    marginLeft: 6,
                    padding: "1px 7px",
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 8,
                    backgroundColor: typeColor
                      ? `${typeColor}22`
                      : colors.typeBg,
                    color: typeColor || colors.textSecondary,
                    textTransform: "uppercase",
                    letterSpacing: 0.3,
                  }}
                >
                  {seg.type}
                </span>
              )}
            </div>

            {/* Impact badge */}
            {seg.impact != null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color:
                    seg.impact >= 8
                      ? colors.accentGreen
                      : seg.impact >= 5
                        ? colors.accent
                        : colors.textSecondary,
                  whiteSpace: "nowrap",
                }}
              >
                {seg.impact}/10
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Main Widget ---

export default function VlmResult() {
  const { props, isPending, sendFollowUpMessage } = useWidget<Props>();
  const colors = useColors();
  const [userMessage, setUserMessage] = useState("");

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
          Analyzing video with VLM...
        </div>
      </McpUseProvider>
    );
  }

  const videoName =
    props.videoName ||
    (props.videoPath ? props.videoPath.split("/").pop() : "the video");

  const segments = props.response ? parseSegments(props.response) : null;
  const durationSec = props.durationMs
    ? (props.durationMs / 1000).toFixed(1)
    : null;

  // Build summary text for sendFollowUpMessage so agent doesn't re-analyze
  const findingsSummary = segments
    ? segmentSummary(segments)
    : props.response?.slice(0, 500) || "";

  return (
    <McpUseProvider autoSize>
      <div
        style={{
          padding: 16,
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: colors.accentGreen,
            }}
          />
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {segments
              ? `Found ${segments.length} segment${segments.length !== 1 ? "s" : ""}`
              : "VLM Analysis"}
          </h2>
          <span
            style={{
              fontSize: 12,
              color: colors.textSecondary,
              marginLeft: "auto",
            }}
          >
            {videoName}
            {durationSec && ` · ${durationSec}s`}
          </span>
        </div>

        {/* Question */}
        {props.question && (
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              backgroundColor: colors.questionBg,
              border: `1px solid ${colors.border}`,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: colors.accent,
                display: "block",
                marginBottom: 4,
              }}
            >
              Question
            </span>
            {props.question}
          </div>
        )}

        {/* Results — structured segments or plain text */}
        {segments ? (
          <SegmentList segments={segments} colors={colors} />
        ) : props.response ? (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: colors.codeBg,
              border: `1px solid ${colors.border}`,
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {props.response}
          </div>
        ) : null}

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() =>
              sendFollowUpMessage(
                `Here are the VLM findings for "${videoName}":\n${findingsSummary}\n\nShow me your editing plan based on these findings. List the clips, timestamps, and effects you'd use. Do NOT execute yet — wait for my approval.`
              )
            }
            style={{
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 500,
              border: "none",
              borderRadius: 6,
              backgroundColor: colors.accentGreen,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Plan Edits
          </button>
          <button
            onClick={() =>
              sendFollowUpMessage(
                `I need more detail on these findings for "${videoName}":\n${findingsSummary}\n\nAsk the VLM ONE follow-up question for more precision on timestamps and descriptions.`
              )
            }
            style={{
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 500,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              backgroundColor: "transparent",
              color: colors.text,
              cursor: "pointer",
            }}
          >
            More Detail
          </button>
          <button
            onClick={() =>
              sendFollowUpMessage(
                `The VLM analysis for "${videoName}" doesn't look right. Try ONE different question.`
              )
            }
            style={{
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 500,
              border: `1px solid ${colors.accentRed}`,
              borderRadius: 6,
              backgroundColor: "transparent",
              color: colors.accentRed,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>

        {/* Custom feedback input */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 12,
          }}
        >
          <input
            type="text"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && userMessage.trim()) {
                sendFollowUpMessage(userMessage.trim());
                setUserMessage("");
              }
            }}
            placeholder="Tell the agent what to do with these results..."
            style={{
              flex: 1,
              padding: "8px 12px",
              fontSize: 13,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              backgroundColor: colors.codeBg,
              color: colors.text,
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              if (userMessage.trim()) {
                sendFollowUpMessage(userMessage.trim());
                setUserMessage("");
              }
            }}
            disabled={!userMessage.trim()}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 500,
              border: "none",
              borderRadius: 6,
              backgroundColor: userMessage.trim() ? colors.accent : colors.border,
              color: "#fff",
              cursor: userMessage.trim() ? "pointer" : "default",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </McpUseProvider>
  );
}
