#!/usr/bin/env node
// Wrapper that sets cwd and suppresses non-JSON stdout for stdio MCP transport
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const child = spawn("npx", ["mcp-use", "start", "--port", "0"], {
  cwd: __dirname,
  env: { ...process.env },
  stdio: ["pipe", "pipe", "inherit"],
});

process.stdin.pipe(child.stdin);

let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Only pass through JSON-RPC (starts with { or Content-Length header)
    if (trimmed[0] === "{" || trimmed.startsWith("Content-Length")) {
      process.stdout.write(line + "\n");
    } else {
      process.stderr.write(line + "\n");
    }
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
