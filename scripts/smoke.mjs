// End-to-end smoke test: starts the server over stdio like Claude Code does and calls its tools.
// Usage: node scripts/smoke.mjs <project-dir> [tool ...]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const project = process.argv[2];
const steps = process.argv.slice(3);
if (!project) throw new Error("pass a project dir");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/src/index.js", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  cwd: project,
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const calls = {
  status: ["accounts_status", {}],
  login: ["accounts_login", { services: ["chatgpt", "google"] }],
  codex: ["image_generate", { provider: "codex", prompt: "flat minimal icon of a green key on a white background, no text", aspect: "1:1" }],
  chatgpt: ["image_generate", { provider: "chatgpt", prompt: "flat minimal icon of a teal padlock on a mint background, no text", aspect: "1:1" }],
  flow: ["image_generate", { provider: "flow", prompt: "flat minimal illustration of a phone with a green shield, mint background, no text", aspect: "16:9" }],
  gemini: ["image_generate", { provider: "gemini", prompt: "flat minimal icon of a green envelope with a lock, white background, no text" }],
  quote: ["video_quote", { model: "veo-lite", aspect: "16:9" }],
  escape: ["image_generate", { provider: "codex", prompt: "test escape", output_path: "../outside.png" }],
  badext: ["image_generate", { provider: "codex", prompt: "test badext", output_path: "public/run.ps1" }],
};

for (const s of steps) {
  const [name, args] = s.startsWith("call:") ? JSON.parse(s.slice(5)) : s.startsWith("optimize:") ? ["media_optimize", { input_path: s.slice(9) }] : s.startsWith("login:") ? ["accounts_login", { services: s.slice(6).split(",") }] : s.startsWith("img:") ? ["image_generate", { provider: s.slice(4), prompt: "flat minimal icon of a green shield with a white check mark, mint background, no text" }] : calls[s];
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 15 * 60_000 });
  console.log(`\n== ${s} (${Math.round((Date.now() - t0) / 1000)}s) ${r.isError ? "ERROR" : "ok"}\n${r.content?.[0]?.text}`);
}
await client.close();
