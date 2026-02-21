import {
  McpUseProvider,
  useWidget,
  useWidgetTheme,
  useCallTool,
  type WidgetMetadata,
} from "mcp-use/react";
import { z } from "zod";

// --- Schema ---

const propsSchema = z.object({
  description: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  success: z.boolean(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "DaVinci Resolve script execution result",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

// --- Colors ---

function useColors() {
  const theme = useWidgetTheme();
  return {
    bg: theme === "dark" ? "#1a1a2e" : "#ffffff",
    text: theme === "dark" ? "#e0e0e0" : "#1a1a1a",
    textSecondary: theme === "dark" ? "#a0a0b0" : "#666",
    border: theme === "dark" ? "#2a2a4a" : "#e0e0e0",
    accent: theme === "dark" ? "#4a9eff" : "#0066cc",
    codeBg: theme === "dark" ? "#0f0f23" : "#f5f5f5",
    successBg: theme === "dark" ? "#0f2e1a" : "#e8f5e9",
    successText: theme === "dark" ? "#51cf66" : "#2e7d32",
    successBorder: theme === "dark" ? "#1a4a2a" : "#c8e6c9",
    errorBg: theme === "dark" ? "#2e0f0f" : "#ffebee",
    errorText: theme === "dark" ? "#ff6b6b" : "#c62828",
    errorBorder: theme === "dark" ? "#4a1a1a" : "#ffcdd2",
  };
}

// --- Main Widget ---

export default function ScriptResult() {
  const { props, isPending, sendFollowUpMessage } = useWidget<Props>();
  const { callTool: refreshState, isPending: isRefreshing } =
    useCallTool("get-resolve-state");
  const colors = useColors();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
          Running script...
        </div>
      </McpUseProvider>
    );
  }

  // Safe defaults — props may be partially populated before tool result arrives
  const success = props.success ?? false;
  const stdout = props.stdout ?? "";
  const stderr = props.stderr ?? "";
  const exitCode = props.exitCode ?? 1;
  const description = props.description ?? null;

  const statusBg = success ? colors.successBg : colors.errorBg;
  const statusText = success ? colors.successText : colors.errorText;
  const statusBorder = success
    ? colors.successBorder
    : colors.errorBorder;

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
        {/* Status header */}
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
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 12,
              backgroundColor: statusBg,
              color: statusText,
              border: `1px solid ${statusBorder}`,
            }}
          >
            {success ? "SUCCESS" : `FAILED (exit ${exitCode})`}
          </div>
          {description && (
            <span style={{ fontSize: 13, color: colors.textSecondary }}>
              {description}
            </span>
          )}
        </div>

        {/* stdout */}
        {stdout && (
          <div style={{ marginBottom: stderr ? 10 : 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: colors.textSecondary,
                marginBottom: 4,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Output
            </div>
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                backgroundColor: colors.codeBg,
                border: `1px solid ${colors.border}`,
                fontSize: 12,
                lineHeight: 1.5,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {stdout}
            </pre>
          </div>
        )}

        {/* stderr */}
        {stderr && (
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: colors.errorText,
                marginBottom: 4,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Errors
            </div>
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                backgroundColor: colors.errorBg,
                border: `1px solid ${colors.errorBorder}`,
                color: colors.errorText,
                fontSize: 12,
                lineHeight: 1.5,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {stderr}
            </pre>
          </div>
        )}

        {/* No output */}
        {!stdout && !stderr && (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              color: colors.textSecondary,
              fontSize: 13,
            }}
          >
            Script completed with no output
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => refreshState({})}
            disabled={isRefreshing}
            style={{
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 500,
              border: "none",
              borderRadius: 6,
              backgroundColor: colors.accent,
              color: "#fff",
              cursor: isRefreshing ? "not-allowed" : "pointer",
              opacity: isRefreshing ? 0.6 : 1,
            }}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Timeline"}
          </button>
          {!success && (
            <button
              onClick={() =>
                sendFollowUpMessage(
                  `The DaVinci Resolve script failed with error:\n${stderr || stdout}\n\nPlease fix the script and try again.`
                )
              }
              style={{
                padding: "7px 16px",
                fontSize: 12,
                fontWeight: 500,
                border: `1px solid ${colors.errorBorder}`,
                borderRadius: 6,
                backgroundColor: "transparent",
                color: colors.errorText,
                cursor: "pointer",
              }}
            >
              Help Fix Error
            </button>
          )}
        </div>
      </div>
    </McpUseProvider>
  );
}
