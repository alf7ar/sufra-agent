import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AgentHost } from "./agent/host.js";
import { Llm, SpendGuard, openAiCompatibleLlm } from "./agent/llm.js";
import { rulesLlm } from "./agent/rules.js";
import { quote } from "./core/cart.js";
import { Store } from "./core/memory.js";
import { DEMO_CUSTOMER, seedDemo } from "./core/seed.js";
import { egp } from "./core/menu.js";
import { readBody } from "./app.js";

export interface SimOptions { store: Store; mcpUrl: string; token: string; dataDir: string; env: NodeJS.ProcessEnv }

/** HTTP routes for the Alexa+ simulator web app (/api/*). */
export async function createSimulator(o: SimOptions) {
  const guard = new SpendGuard(join(o.dataDir, "openai_cost.jsonl"), Number(o.env.SUFRA_SPEND_CAP_USD ?? 2));
  const key = o.env.OPENAI_API_KEY;
  const llm: Llm = key ? openAiCompatibleLlm({ apiKey: key, model: o.env.SUFRA_MODEL ?? "gpt-5.4-mini", baseUrl: o.env.SUFRA_LLM_BASE_URL, guard }) : rulesLlm;
  const mode = key ? "llm" : "rules";
  const host = new AgentHost(o.mcpUrl, o.token, llm);
  await host.connect();
  const ttsDir = join(o.dataDir, "tts");
  const hits: number[] = [];
  const limited = () => { const t = Date.now(); while (hits.length && hits[0] < t - 60_000) hits.shift(); hits.push(t); return hits.length > 40; };

  const state = () => {
    const cart = o.store.getCart(DEMO_CUSTOMER);
    const q = cart.length ? quote(cart) : undefined;
    return { mode, voice: !!key, spendUsd: Number(guard.total().toFixed(4)), cart: q && { ...q, totalEgp: egp(q.total), vatEgp: egp(q.vat), subtotalEgp: egp(q.subtotal) }, history: o.store.history(DEMO_CUSTOMER, 5).map((x) => ({ id: x.id, placedAt: x.placedAt, totalEgp: egp(x.quote.total) })), preferences: o.store.getPrefs(DEMO_CUSTOMER) };
  };
  const send = (res: ServerResponse, code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));

  const handler = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith("/api/")) return false;
    if (url.pathname === "/api/state" && req.method === "GET") { send(res, 200, state()); return true; }
    if (req.method !== "POST") { send(res, 405, { error: "method" }); return true; }
    if (limited()) { send(res, 429, { error: "rate_limited" }); return true; }
    const body = JSON.parse((await readBody(req)) || "{}");
    if (url.pathname === "/api/chat") {
      const text = String(body.text ?? "").slice(0, 500);
      if (!text.trim()) { send(res, 400, { error: "empty" }); return true; }
      try { send(res, 200, { ...(await host.turn(text)), state: state() }); }
      catch (e) { send(res, 502, { error: (e as Error).message }); }
      return true;
    }
    if (url.pathname === "/api/reset") {
      o.store.clear(); seedDemo(o.store); host.reset();
      send(res, 200, state()); return true;
    }
    if (url.pathname === "/api/tts") {
      if (!key) { send(res, 501, { error: "no_openai_key" }); return true; }
      const text = String(body.text ?? "").slice(0, 400);
      const file = join(ttsDir, createHash("sha256").update(text).digest("hex").slice(0, 24) + ".mp3");
      try {
        if (!existsSync(file)) {
          guard.assertBudget();
          const r = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "coral", input: text, instructions: "Speak in a warm, natural Egyptian Arabic accent, like a friendly restaurant host. Fairly quick pace.", response_format: "mp3" }) });
          if (!r.ok) throw new Error(`tts http ${r.status}`);
          mkdirSync(ttsDir, { recursive: true });
          writeFileSync(file, Buffer.from(await r.arrayBuffer()));
          guard.recordTts(text.length);
        }
        res.writeHead(200, { "content-type": "audio/mpeg" }).end(readFileSync(file));
      } catch (e) { send(res, 502, { error: (e as Error).message }); }
      return true;
    }
    send(res, 404, { error: "not_found" });
    return true;
  };
  return { handler, host, mode };
}
