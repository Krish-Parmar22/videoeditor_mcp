import { useState } from "react";
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
  onboarding_complete: z.boolean(),
  resolve: z.object({
    connected: z.boolean(),
    error: z.string(),
  }),
  vlm: z.object({
    reachable: z.boolean(),
    endpoint: z.string(),
    model: z.string(),
    error: z.string(),
  }),
  config: z.any(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "First-time setup wizard for Video Editor MCP",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

// --- Colors ---

function useColors() {
  const theme = useWidgetTheme();
  return {
    bg: theme === "dark" ? "#111118" : "#ffffff",
    bgSecondary: theme === "dark" ? "#1a1a28" : "#f8f9fa",
    text: theme === "dark" ? "#e0e0e0" : "#1a1a1a",
    textSecondary: theme === "dark" ? "#8888a0" : "#888",
    border: theme === "dark" ? "#2a2a3a" : "#e0e0e0",
    accent: theme === "dark" ? "#4a9eff" : "#0066cc",
    green: theme === "dark" ? "#51cf66" : "#28a745",
    red: theme === "dark" ? "#ff6b6b" : "#dc3545",
    inputBg: theme === "dark" ? "#0d0d16" : "#fff",
    cardBg: theme === "dark" ? "#14141f" : "#fafafa",
  };
}

// --- Status Badge ---

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  const colors = useColors();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: ok ? `${colors.green}22` : `${colors.red}22`,
        color: ok ? colors.green : colors.red,
      }}
    >
      {ok ? "Connected" : label || "Not connected"}
    </span>
  );
}

// --- Main Widget ---

export default function SetupWizard() {
  const { props, isPending, sendFollowUpMessage } = useWidget<Props>();
  const { callToolAsync: testVlm, isPending: isTesting } = useCallTool("test-vlm-connection");
  const { callToolAsync: saveSetup, isPending: isSaving } = useCallTool("save-setup");
  const colors = useColors();

  const [vlmEndpoint, setVlmEndpoint] = useState("");
  const [vlmModel, setVlmModel] = useState("");
  const [vlmKey, setVlmKey] = useState("");
  const [vlmTestResult, setVlmTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
          Checking setup status...
        </div>
      </McpUseProvider>
    );
  }

  // Pre-fill from existing config
  const ep = vlmEndpoint || props.vlm?.endpoint || "";
  const mdl = vlmModel || props.vlm?.model || "";

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    fontSize: 13,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    backgroundColor: colors.inputBg,
    color: colors.text,
    outline: "none",
    boxSizing: "border-box" as const,
  };

  const handleTestVlm = async () => {
    if (!ep) return;
    setVlmTestResult(null);
    try {
      const result = await testVlm({ endpoint: ep });
      const content = (result as any)?.content;
      const txt = Array.isArray(content) ? content.map((c: any) => c.text).join("") : "";
      setVlmTestResult(txt.includes("reachable") ? "Connected!" : txt || "Unknown response");
    } catch (e: any) {
      setVlmTestResult(`Failed: ${e.message}`);
    }
  };

  const handleSave = async () => {
    try {
      await saveSetup({
        vlm_endpoint: ep,
        vlm_model: mdl || "Qwen/Qwen3-VL-32B-Instruct-FP8",
        vlm_api_key: vlmKey || "EMPTY",
      });
      setSaved(true);
    } catch {
      // ignore
    }
  };

  if (saved || props.onboarding_complete) {
    return (
      <McpUseProvider autoSize>
        <div
          style={{
            padding: 20,
            backgroundColor: colors.bg,
            color: colors.text,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>Ready</div>
          <div style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 16 }}>
            Setup complete. You can start editing.
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <StatusBadge ok={props.resolve?.connected} label={props.resolve?.error || "Not connected"} />
            <StatusBadge ok={props.vlm?.reachable} label={props.vlm?.error || "Not reachable"} />
          </div>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div
        style={{
          padding: 20,
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <h2 style={{ margin: "0 0 4px 0", fontSize: 18 }}>Setup Video Editor MCP</h2>
        <p style={{ margin: "0 0 20px 0", fontSize: 13, color: colors.textSecondary }}>
          Configure your connections before editing.
        </p>

        {/* Step 1: DaVinci Resolve */}
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.cardBg,
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>DaVinci Resolve</h3>
            <StatusBadge ok={props.resolve?.connected} label={props.resolve?.error || "Not detected"} />
          </div>
          {!props.resolve?.connected && (
            <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>
              Make sure DaVinci Resolve is running with scripting enabled:
              <br />
              Preferences &rarr; System &rarr; General &rarr; External scripting &rarr; Local
            </div>
          )}
        </div>

        {/* Step 2: VLM Endpoint */}
        <div
          style={{
            padding: 14,
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.cardBg,
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Vision Model (VLM)</h3>
            <StatusBadge ok={props.vlm?.reachable} label={props.vlm?.error || "Not configured"} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: colors.textSecondary, display: "block", marginBottom: 3 }}>
                Endpoint URL
              </label>
              <input
                type="text"
                value={ep}
                onChange={(e) => setVlmEndpoint(e.target.value)}
                placeholder="http://192.168.1.100:8000/v1"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: colors.textSecondary, display: "block", marginBottom: 3 }}>
                Model
              </label>
              <input
                type="text"
                value={mdl}
                onChange={(e) => setVlmModel(e.target.value)}
                placeholder="Qwen/Qwen3-VL-32B-Instruct-FP8"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: colors.textSecondary, display: "block", marginBottom: 3 }}>
                API Key (if needed)
              </label>
              <input
                type="password"
                value={vlmKey}
                onChange={(e) => setVlmKey(e.target.value)}
                placeholder="Leave empty if not required"
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={handleTestVlm}
                disabled={!ep || isTesting}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 500,
                  border: "none",
                  borderRadius: 6,
                  backgroundColor: colors.accent,
                  color: "#fff",
                  cursor: !ep || isTesting ? "not-allowed" : "pointer",
                  opacity: !ep || isTesting ? 0.5 : 1,
                }}
              >
                {isTesting ? "Testing..." : "Test Connection"}
              </button>
              {vlmTestResult && (
                <span
                  style={{
                    fontSize: 12,
                    color: vlmTestResult.includes("Connected") ? colors.green : colors.red,
                  }}
                >
                  {vlmTestResult}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            width: "100%",
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            borderRadius: 8,
            backgroundColor: colors.green,
            color: "#fff",
            cursor: isSaving ? "not-allowed" : "pointer",
            opacity: isSaving ? 0.6 : 1,
          }}
        >
          {isSaving ? "Saving..." : "Save & Start Editing"}
        </button>
      </div>
    </McpUseProvider>
  );
}
