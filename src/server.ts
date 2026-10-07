import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { Store } from "./core/memory.js";
import { DEMO_CUSTOMER, seedDemo } from "./core/seed.js";
import { createSimulator } from "./simulator.js";

const env = process.env;
const dataDir = env.SUFRA_DATA_DIR ?? join(fileURLToPath(new URL("..", import.meta.url)), "data");
mkdirSync(dataDir, { recursive: true });
const token = env.SUFRA_BEARER_TOKEN || "sufra-demo-token";

const store = new Store(join(dataDir, "memory.json"));
if (store.history(DEMO_CUSTOMER, 1).length === 0) seedDemo(store);

const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? "127.0.0.1";
let sim: Awaited<ReturnType<typeof createSimulator>> | undefined;
const server = createApp({
  store, customerId: DEMO_CUSTOMER,
  auth: { token, allowedRedirectHosts: (env.SUFRA_ALLOWED_REDIRECT_HOSTS ?? "pitangui.amazon.com,layla.amazon.com,alexa.amazon.co.jp").split(",") },
  extra: async (req, res, url) => (sim ? sim.handler(req, res, url) : false),
});

server.listen(port, host, async () => {
  const p = (server.address() as AddressInfo).port;
  sim = await createSimulator({ store, mcpUrl: `http://127.0.0.1:${p}/mcp`, token, dataDir, env });
  console.log(`Sufra agent on http://${host}:${p}  (simulator: /, MCP: /mcp, mode: ${sim.mode})`);
});
