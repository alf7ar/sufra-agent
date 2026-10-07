import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Llm, Msg, ToolDef } from "./llm.js";

export const SYSTEM_PROMPT = `انت "سفرة"، مساعد صوتي بيطلب أكل من مطعم "سفرة الحارة" للعميل. اتكلم باللهجة المصرية، ردود قصيرة جدًا (جملة أو اتنين) لأن الرد هيتقري بصوت.
- استخدم الأدوات دايمًا؛ ماتخمنش الأسعار أو الأصناف.
- لو العميل قال "زي الجمعة" أو "نفس الطلب" استخدم reorder_last، ولو قال "من غير بصل" حطها في without.
- قبل place_order لازم تقول الإجمالي (quote_total) وتاخد "أيوه/تمام" صريحة من العميل.
- لو صنف مش متاح اقترح بديل من search_menu.
- الأسعار بالجنيه المصري والضريبة ١٤٪ بتتضاف في الإجمالي.`;

export interface TurnResult { reply: string; steps: { tool: string; args: unknown; result: any; isError: boolean }[] }

/** Chat host: runs an LLM tool-calling loop where every tool is an MCP call to our own server. */
export class AgentHost {
  private client: Client;
  private tools: ToolDef[] = [];
  history: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  constructor(private mcpUrl: string, private token: string, private llm: Llm) {
    this.client = new Client({ name: "sufra-simulator-host", version: "0.1.0" });
  }
  async connect() {
    await this.client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${this.token}` } } }));
    this.tools = (await this.client.listTools()).tools.map((t) => ({ name: t.name, description: t.description ?? "", parameters: t.inputSchema as Record<string, unknown> }));
  }
  reset() { this.history = [{ role: "system", content: SYSTEM_PROMPT }]; }
  async close() { await this.client.close(); }

  async turn(userText: string): Promise<TurnResult> {
    this.history.push({ role: "user", content: userText });
    const steps: TurnResult["steps"] = [];
    for (let i = 0; i < 6; i++) {
      const r = await this.llm(this.history, this.tools);
      this.history.push({ role: "assistant", content: r.content, tool_calls: r.tool_calls.length ? r.tool_calls : undefined });
      if (!r.tool_calls.length) return { reply: r.content ?? "", steps };
      for (const c of r.tool_calls) {
        const res = await this.client.callTool({ name: c.name, arguments: c.args });
        const text = (res.content as { type: string; text?: string }[]).map((x) => x.text ?? "").join("\n");
        steps.push({ tool: c.name, args: c.args, result: res.structuredContent, isError: !!res.isError });
        this.history.push({ role: "tool", tool_call_id: c.id, content: text });
      }
    }
    return { reply: "حصلت مشكلة، ممكن تعيد طلبك؟", steps };
  }
}
