import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { executeResolveScript, getResolveState } from "./resolve-executor.js";
import { createCumulusVlmClient } from "./cumulus-vlm-client.js";

const vlmClient = createCumulusVlmClient();

const PORT = parseInt(process.env.BRIDGE_PORT || "3001");
const TOKEN = process.env.BRIDGE_TOKEN || "";

if (!TOKEN) {
  console.error("BRIDGE_TOKEN env var required for security");
  process.exit(1);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  // Auth check
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method === "POST" && req.url === "/execute") {
      const body = JSON.parse(await readBody(req));
      const result = await executeResolveScript(body.code);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } else if (req.method === "POST" && req.url === "/state") {
      const state = await getResolveState();
      res.writeHead(200);
      res.end(JSON.stringify({ state }));
    } else if (req.method === "POST" && req.url === "/analyze-video") {
      const body = JSON.parse(await readBody(req));
      const response = await vlmClient.analyzeVideo(body.videoPath, body.question);
      res.writeHead(200);
      res.end(JSON.stringify({ response }));
    } else if (req.method === "GET" && req.url?.startsWith("/api/video")) {
      // Serve video files for widget preview
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const filePath = url.searchParams.get("path");
      if (!filePath) { res.writeHead(400); res.end("Missing path"); return; }
      const resolved = path.resolve(filePath);
      const ext = path.extname(resolved).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
      const mime = mimeMap[ext] || "video/mp4";
      try {
        const info = await stat(resolved);
        const buf = await readFile(resolved);
        res.writeHead(200, { "Content-Length": String(info.size), "Content-Type": mime, "Access-Control-Allow-Origin": "*" });
        res.end(buf);
      } catch {
        res.writeHead(404); res.end("File not found");
      }
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (err: any) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DaVinci Resolve bridge listening on 0.0.0.0:${PORT}`);
  console.log(`Tailscale: http://100.92.227.112:${PORT}`);
});
