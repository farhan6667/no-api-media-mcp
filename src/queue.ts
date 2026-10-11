import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * A tiny first-come-first-served queue shared by every copy of this server on the machine, so several
 * Claude sessions waiting for the one signed-in browser line up fairly and can each say where they are.
 * One empty file per waiting process, named <time>-<pid>-<random>; the order of the names is the order
 * of the queue. Tickets left behind by a process that died are cleaned up by whoever looks next.
 */
export function queueDir(home: string): string {
  return join(home, "browser-queue");
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else, so it is still alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const TICKET = /^(\d{13})-(\d+)-[a-z0-9]+$/;

export function joinQueue(home: string, now = Date.now()): string {
  const dir = queueDir(home);
  mkdirSync(dir, { recursive: true });
  const ticket = join(dir, `${String(now).padStart(13, "0")}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  writeFileSync(ticket, "");
  return ticket;
}

/** How many live tickets are ahead of this one. Dead processes' tickets are removed on the way. */
export function aheadOf(ticket: string, isAlive: (pid: number) => boolean = alive): number {
  const dir = dirname(ticket);
  const me = basename(ticket);
  let ahead = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const f of entries) {
    const m = TICKET.exec(f);
    if (!m || f === me) continue;
    if (!isAlive(Number(m[2]))) {
      rmSync(join(dir, f), { force: true });
      continue;
    }
    if (f < me) ahead++;
  }
  return ahead;
}

export function leaveQueue(ticket: string) {
  rmSync(ticket, { force: true });
}

/** "about 3 min" from a millisecond estimate, or undefined when there's nothing honest to say. */
export function formatEta(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  const min = Math.round(ms / 60_000);
  return min < 1 ? "under a minute" : `about ${min} min`;
}

/** Number of live waiters in the queue, cleaning up dead ones. */
export function waiting(home: string, isAlive: (pid: number) => boolean = alive): number {
  const dir = queueDir(home);
  let n = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const f of entries) {
    const m = TICKET.exec(f);
    if (!m) continue;
    if (isAlive(Number(m[2]))) n++;
    else rmSync(join(dir, f), { force: true });
  }
  return n;
}

/**
 * Which copy of this server currently owns the browser, so a waiter can tell a busy session (worth
 * waiting for) from a profile held by something else, like the sign-in window (not worth waiting for).
 */
export function hostFile(home: string): string {
  return join(home, "browser-host.pid");
}

export function markHost(home: string) {
  mkdirSync(home, { recursive: true });
  writeFileSync(hostFile(home), String(process.pid));
}

export function clearHost(home: string) {
  try {
    if (readFileSync(hostFile(home), "utf8").trim() === String(process.pid)) rmSync(hostFile(home), { force: true });
  } catch {
    /* no host file */
  }
}

export function hostAlive(home: string, isAlive: (pid: number) => boolean = alive): boolean {
  try {
    const pid = Number(readFileSync(hostFile(home), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && isAlive(pid);
  } catch {
    return false;
  }
}
