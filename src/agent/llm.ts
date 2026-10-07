import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface LlmReply { content: string | null; tool_calls: ToolCall[] }
export type Llm = (messages: Msg[], tools: ToolDef[]) => Promise<LlmReply>;

/** Estimated USD per 1M tokens (in, out). Deliberately on the high side. */
const PRICE: Record<string, [number, number]> = { default: [0.75, 4.5] };
const TTS_USD_PER_CHAR = 0.00004;

/** Persistent spend log with a hard cap. Shared by chat and TTS. */
export class SpendGuard {
  constructor(private file: string, private capUsd: number) {}
  total(): number {
    if (!existsSync(this.file)) return 0;
    return readFileSync(this.file, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd as number), 0);
  }
  assertBudget() {
    if (this.total() >= this.capUsd) throw new Error(`spend cap $${this.capUsd} reached (est $${this.total().toFixed(3)})`);
  }
  record(kind: string, usd: number, extra: Record<string, unknown> = {}) {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), kind, usd, ...extra }) + "\n");
  }
  recordChat(model: string, inTok: number, outTok: number) {
    const [pi, po] = PRICE[model] ?? PRICE.default;
    this.record("chat", (inTok * pi + outTok * po) / 1e6, { model, inTok, outTok });
  }
  recordTts(chars: number) { this.record("tts", chars * TTS_USD_PER_CHAR, { chars }); }
}

/** Any OpenAI-compatible chat-completions endpoint (OpenAI, Nebius Token Factory, ...). */
export function openAiCompatibleLlm(o: { apiKey: string; model: string; baseUrl?: string; guard: SpendGuard }): Llm {
  const base = (o.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return async (messages, tools) => {
    o.guard.assertBudget();
    const body = {
      model: o.model,
      max_completion_tokens: 700,
      messages: messages.map((m) =>
        m.role === "assistant" && m.tool_calls
          ? { role: "assistant", content: m.content, tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })) }
          : m),
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
    };
    const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`llm http ${r.status}`);
    const j = (await r.json()) as any;
    o.guard.recordChat(o.model, j.usage?.prompt_tokens ?? 0, j.usage?.completion_tokens ?? 0);
    const m = j.choices[0].message;
    return {
      content: m.content ?? null,
      tool_calls: (m.tool_calls ?? []).map((t: any) => ({ id: t.id, name: t.function.name, args: JSON.parse(t.function.arguments || "{}") })),
    };
  };
}
