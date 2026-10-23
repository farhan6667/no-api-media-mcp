import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How this copy was installed, so every command the server prints actually works for it.
 *
 * The package name is not reserved on the npm registry by default. Printing `npx -y no-api-media-mcp@latest`
 * to someone who installed from a git checkout would make their MCP client fetch and run whatever is
 * published under that name, by anyone, on every start. So the client config always points at this very
 * copy with an absolute path, and npm commands are only suggested to people who installed from npm.
 */

/** dist/src/index.js of this copy. */
export const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "index.js");

/** True when this copy lives under a node_modules folder (installed from npm), false for a git checkout. */
export function installedFromNpm(entry: string = ENTRY): boolean {
  return entry.split(/[\\/]/).includes("node_modules");
}

/** The command line that starts this exact copy. */
export function launchArgs(entry: string = ENTRY): { command: string; args: string[] } {
  return { command: "node", args: [entry] };
}

/** How to update, worded for the way this copy was installed. */
export function updateCommand(fromNpm: boolean = installedFromNpm()): string {
  return fromNpm ? "npm install -g no-api-media-mcp@latest" : "git pull, then npm ci and npm run build, in your no-api-media-mcp folder";
}

/**
 * npm's own CLI script next to the running Node, started with Node itself. No npm.cmd: Windows refuses to
 * spawn .cmd files without a shell, and looking one up by name could find a planted copy in the project.
 */
export function npmCliPath(): string | undefined {
  const base = dirname(process.execPath);
  const candidates =
    platform() === "win32"
      ? [join(base, "node_modules", "npm", "bin", "npm-cli.js")]
      : [join(base, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), join(base, "node_modules", "npm", "bin", "npm-cli.js")];
  return candidates.find((c) => existsSync(c));
}
