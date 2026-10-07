# Devpost description draft (Alexa+ track)

Demo video (2:28, English narration, unlisted YouTube): https://youtu.be/SZEdZX-qNFk

**Sufra: Egyptian-Arabic restaurant ordering for Alexa+ via MCP**

Millions of restaurant orders in Egypt still happen by phone call or chat, in dialect, with edits like "same as Friday, no onions".
Sufra is an MCP server (Streamable HTTP, spec 2025-11-25, OAuth 2.1 + PKCE discovery) that gives an Alexa+-style assistant the tools to search a menu
(Egyptian aliases), build a cart with modifiers, quote with 14% VAT, confirm and place an order, check status, and remember past orders and preferences across sessions.

Alexa+ is simulated in a web app (voice in via browser speech recognition, spoken replies, cards, live MCP tool trace) because no Alexa+ device or Egyptian-Arabic Alexa+ access was available for testing; the same MCP server can be connected to a real Alexa+ client over a public HTTPS URL.

How it was built: Node 22 + TypeScript, official MCP SDK, 26 automated tests (protocol version, auth, PKCE, order flow, memory, Arabic search), spend-capped LLM host (OpenAI-compatible).
Creative-track fit: agentic workflow, state across sessions, purchasing flow with explicit confirmation, cards.
Demo data: fictional restaurant and menu. Friction log included in the repo.
