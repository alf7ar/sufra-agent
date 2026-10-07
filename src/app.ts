import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize as pnorm, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/server.js";
import { Store } from "./core/memory.js";
import { AuthConfig, authorize, authServerMetadata, checkBearer, protectedResourceMetadata, token } from "./mcp/auth.js";

export interface AppOptions {
  store: Store;
  customerId: string;
  now?: () => Date;
  auth: AuthConfig;
  /** Extra routes (simulator /api/*). Return true if handled. */
  extra?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
}

const WEB = join(fileURLToPath(new URL("../web", import.meta.url)));
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg" };

export async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > limit) throw new Error("body_too_large"); chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString("utf8");
}

export function createApp(opts: AppOptions): Server {
  const now = opts.now ?? (() => new Date());
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") return protectedResourceMetadata(req, res);
      if (path === "/.well-known/oauth-authorization-server") return authServerMetadata(req, res);
      if (path === "/authorize" && req.method === "GET") return authorize(url, res, opts.auth);
      if (path === "/token" && req.method === "POST") return token(new URLSearchParams(await readBody(req)), res, opts.auth);

      if (path === "/mcp") {
        // DNS-rebinding protection: browsers send Origin; it must match Host.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) { res.writeHead(403).end("forbidden origin"); return; }
        if (!checkBearer(req, opts.auth.token)) { res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" })); return; }
        if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(); return; }
        const body = JSON.parse(await readBody(req));
        const server = createMcpServer({ store: opts.store, customerId: opts.customerId, now });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (opts.extra && (await opts.extra(req, res, url))) return;

      if (req.method === "GET") {
        const rel = path === "/" ? "/index.html" : path;
        const file = pnorm(join(WEB, rel));
        if (file.startsWith(WEB + sep)) {
          try {
            const data = await readFile(file);
            res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(data);
            return;
          } catch { /* fallthrough */ }
        }
      }
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server_error", message: (e as Error).message }));
    }
  });
}
