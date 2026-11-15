import fs from "node:fs/promises";
import path from "node:path";
import type { Finding, Usage } from "./types.js";

/**
 * Una línea por llamada. Por privacidad NO guarda el contenido de los mensajes:
 * solo metadata, uso, costo y los hallazgos (que nunca incluyen el valor sensible).
 */
export interface LogEntry {
  ts: string;
  agentId: string;
  runId: string;
  endpoint: string;
  model: string;
  /** allowed: pasó; blocked: lo cortó un guardrail; budget/rate_limited: lo cortó el control de costos. */
  outcome: "allowed" | "blocked" | "budget_exceeded" | "rate_limited" | "upstream_error" | "bad_request";
  status: number;
  latencyMs: number;
  usage?: Usage;
  costUsd?: number;
  findings: Finding[];
  messages?: number;
}

export interface Logger {
  write(entry: LogEntry): Promise<void>;
}

/** Escribe JSONL en `<dir>/proxy-YYYY-MM-DD.jsonl`. */
export class JsonlLogger implements Logger {
  constructor(private dir: string) {}
  async write(entry: LogEntry) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.appendFile(path.join(this.dir, `proxy-${entry.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(entry)}\n`);
  }
}

export class MemoryLogger implements Logger {
  entries: LogEntry[] = [];
  async write(entry: LogEntry) {
    this.entries.push(entry);
  }
}
