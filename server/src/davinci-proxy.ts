import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPServer, text, error } from "mcp-use/server";
import { z } from "zod";
import path from "node:path";

let mcpClient: Client | null = null;
let transport: StdioClientTransport | null = null;

export async function initDavinciProxy(server: MCPServer): Promise<void> {
  const davinciMcpPath = path.resolve(
    process.env.DAVINCI_MCP_PATH || "../davinci-resolve-mcp"
  );

  const resolveScriptApi =
    process.env.RESOLVE_SCRIPT_API ||
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting";
  const resolveScriptLib =
    process.env.RESOLVE_SCRIPT_LIB ||
    "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so";

  const pythonPath = path.resolve(davinciMcpPath, "venv/bin/python3");
  const serverScript = path.resolve(davinciMcpPath, "src/main.py");

  console.log(`[DaVinci Proxy] Spawning Python MCP server...`);
  console.log(`[DaVinci Proxy]   Python: ${pythonPath}`);
  console.log(`[DaVinci Proxy]   Script: ${serverScript}`);

  transport = new StdioClientTransport({
    command: pythonPath,
    args: [serverScript],
    env: {
      ...process.env,
      RESOLVE_SCRIPT_API: resolveScriptApi,
      RESOLVE_SCRIPT_LIB: resolveScriptLib,
      PYTHONPATH: `${resolveScriptApi}/Modules/:${davinciMcpPath}/src:${davinciMcpPath}`,
    },
  });

  mcpClient = new Client({
    name: "videoeditor-davinci-proxy",
    version: "1.0.0",
  });

  await mcpClient.connect(transport);
  console.log(`[DaVinci Proxy] Connected to DaVinci Resolve MCP server`);

  // --- Proxy tools ---
  const { tools } = await mcpClient.listTools();
  console.log(`[DaVinci Proxy] Discovered ${tools.length} tools`);

  for (const tool of tools) {
    const proxyName = `resolve-${tool.name}`;
    const zodSchema = jsonSchemaToZod(tool.inputSchema);

    server.tool(
      {
        name: proxyName,
        description: tool.description || `DaVinci Resolve: ${tool.name}`,
        schema: zodSchema,
      },
      async (args: Record<string, any>) => {
        if (!mcpClient) return error("DaVinci Resolve proxy is not connected");
        try {
          const cleanArgs: Record<string, any> = {};
          for (const [k, v] of Object.entries(args)) {
            if (v !== null && v !== undefined) cleanArgs[k] = v;
          }
          const result = await mcpClient.callTool({
            name: tool.name,
            arguments: cleanArgs,
          });
          if (result.isError) {
            return error(`DaVinci error: ${formatToolResult(result.content)}`);
          }
          return text(formatToolResult(result.content));
        } catch (err: any) {
          return error(`Failed to call ${tool.name}: ${err.message}`);
        }
      }
    );
  }
  console.log(`[DaVinci Proxy] Registered ${tools.length} proxied tools`);

  // --- Proxy static resources as read-only tools ---
  try {
    const { resources } = await mcpClient.listResources();
    console.log(`[DaVinci Proxy] Discovered ${resources.length} resources`);

    for (const resource of resources) {
      const toolName = resourceUriToToolName(resource.uri);

      server.tool(
        {
          name: toolName,
          description: `[Read-only] ${resource.description || resource.name || resource.uri}`,
          schema: z.object({}),
        },
        async () => {
          if (!mcpClient) return error("DaVinci Resolve proxy is not connected");
          try {
            const result = await mcpClient.readResource({ uri: resource.uri });
            return text(formatResourceContents(result.contents));
          } catch (err: any) {
            return error(`Failed to read ${resource.uri}: ${err.message}`);
          }
        }
      );
    }
    console.log(`[DaVinci Proxy] Registered ${resources.length} resource tools (resolve-read-*)`);
  } catch (err: any) {
    console.warn(`[DaVinci Proxy] Resource listing not supported: ${err.message}`);
  }

  // --- Proxy resource templates as parameterized read-only tools ---
  try {
    const { resourceTemplates } = await mcpClient.listResourceTemplates();
    console.log(`[DaVinci Proxy] Discovered ${resourceTemplates.length} resource templates`);

    for (const tmpl of resourceTemplates) {
      const paramNames = extractTemplateParams(tmpl.uriTemplate);
      const toolName = resourceTemplateToToolName(tmpl.uriTemplate);

      const shape: Record<string, z.ZodTypeAny> = {};
      for (const param of paramNames) {
        shape[param] = z.string().describe(`Value for {${param}}`);
      }

      server.tool(
        {
          name: toolName,
          description: `[Read-only] ${tmpl.description || tmpl.name || tmpl.uriTemplate}`,
          schema: z.object(shape),
        },
        async (args: Record<string, any>) => {
          if (!mcpClient) return error("DaVinci Resolve proxy is not connected");
          try {
            let uri = tmpl.uriTemplate;
            for (const param of paramNames) {
              uri = uri.replace(`{${param}}`, encodeURIComponent(args[param]));
            }
            const result = await mcpClient.readResource({ uri });
            return text(formatResourceContents(result.contents));
          } catch (err: any) {
            return error(`Failed to read ${tmpl.uriTemplate}: ${err.message}`);
          }
        }
      );
    }
    console.log(`[DaVinci Proxy] Registered ${resourceTemplates.length} template tools`);
  } catch (err: any) {
    console.warn(`[DaVinci Proxy] Resource templates not supported: ${err.message}`);
  }
}

// --- get-editing-context convenience tool ---

export function registerEditingContextTool(server: MCPServer): void {
  server.tool(
    {
      name: "get-editing-context",
      description:
        "Get complete DaVinci Resolve editing context in one call. Returns: " +
        "current project name, current timeline (name, frame rate, resolution, start timecode), " +
        "all timeline clips (with positions and durations), and media pool clips. " +
        "Call this FIRST before any editing operation to understand the current state.",
      schema: z.object({}),
    },
    async () => {
      if (!mcpClient) return error("DaVinci Resolve proxy is not connected");

      async function safeRead(uri: string): Promise<any> {
        try {
          const res = await mcpClient!.readResource({ uri });
          return parseResourceText(res.contents);
        } catch (err: any) {
          return { error: err.message };
        }
      }

      const [project, timeline, clips, media] = await Promise.all([
        safeRead("resolve://current-project"),
        safeRead("resolve://current-timeline"),
        safeRead("resolve://timeline-clips"),
        safeRead("resolve://media-pool-clips"),
      ]);

      return text(JSON.stringify({
        current_project: project,
        current_timeline: timeline,
        timeline_clips: clips,
        media_pool_clips: media,
      }, null, 2));
    }
  );
}

// --- Helpers ---

function resourceUriToToolName(uri: string): string {
  return `resolve-read-${uri.replace("resolve://", "").replace(/\//g, "-")}`;
}

function resourceTemplateToToolName(uriTemplate: string): string {
  const slug = uriTemplate
    .replace("resolve://", "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    .replace(/\//g, "-");
  return `resolve-read-${slug}`;
}

function extractTemplateParams(uriTemplate: string): string[] {
  return Array.from(uriTemplate.matchAll(/\{([^}]+)\}/g), (m) => m[1]);
}

function formatResourceContents(contents: any[]): string {
  return contents
    .map((c: any) => {
      if (c.text) return c.text;
      if (c.blob) return `[blob: ${c.uri}]`;
      return JSON.stringify(c);
    })
    .join("\n");
}

function parseResourceText(contents: any[]): any {
  const raw = contents.map((c: any) => c.text || "").join("");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatToolResult(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((item: any) => {
        if (item.type === "text") return item.text;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2);
}

// --- JSON Schema → Zod conversion ---

function jsonSchemaToZod(schema: unknown): z.ZodObject<any> {
  if (!schema || typeof schema !== "object") return z.object({});
  const s = schema as any;
  if (!s.properties || typeof s.properties !== "object") return z.object({});

  const required: string[] = s.required || [];
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, prop] of Object.entries(s.properties) as [string, any][]) {
    let field = jsonSchemaFieldToZod(prop);
    const desc = prop.description || prop.title || "";
    if (desc) field = field.describe(desc);
    if (!required.includes(name)) field = field.optional();
    shape[name] = field;
  }

  return z.object(shape);
}

function jsonSchemaFieldToZod(prop: any): z.ZodTypeAny {
  if (!prop) return z.any();

  if (prop.anyOf || prop.oneOf) {
    const variants = (prop.anyOf || prop.oneOf) as any[];
    const nonNull = variants.filter((v) => v.type !== "null" && v !== "null");
    if (nonNull.length === 1) {
      const base = jsonSchemaFieldToZod(nonNull[0]);
      return nonNull.length < variants.length ? base.nullable() : base;
    }
    return z.any();
  }

  const type = prop.type;
  if (type === "string") {
    if (prop.enum) return z.enum(prop.enum as [string, ...string[]]);
    if (prop.default !== undefined) return z.string().default(prop.default);
    return z.string();
  }
  if (type === "integer" || type === "number") {
    let num = type === "integer" ? z.number().int() : z.number();
    if (prop.default !== undefined) num = num.default(prop.default) as any;
    return num;
  }
  if (type === "boolean") {
    if (prop.default !== undefined) return z.boolean().default(prop.default);
    return z.boolean();
  }
  if (type === "array") {
    return z.array(prop.items ? jsonSchemaFieldToZod(prop.items) : z.any());
  }
  if (type === "object") {
    if (prop.properties) return jsonSchemaToZod(prop);
    return z.record(z.string(), z.any());
  }
  return z.any();
}

export async function shutdownDavinciProxy(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
  }
  if (transport) {
    await transport.close();
    transport = null;
  }
  console.log("[DaVinci Proxy] Disconnected");
}
