/**
 * Drop-in replacement for resolve-executor.ts that calls the bridge over HTTP.
 * Same exported interface: executeResolveScript(code) and getResolveState().
 */

const BRIDGE_URL = process.env.RESOLVE_BRIDGE_URL!;
const BRIDGE_TOKEN = process.env.RESOLVE_BRIDGE_TOKEN || "";

async function bridgePost(endpoint: string, body?: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${BRIDGE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BRIDGE_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000), // 2 min timeout for long scripts
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bridge error (${resp.status}): ${text}`);
  }

  return resp.json();
}

export async function executeResolveScript(
  code: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return bridgePost("/execute", { code });
}

export async function getResolveState(): Promise<string> {
  const data = await bridgePost("/state");
  return data.state;
}
