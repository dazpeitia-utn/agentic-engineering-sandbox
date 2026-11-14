import { consoleLogger, createOpenAI, defaultModel, loadMcpTools, runAgent } from "@sandbox/agent-core";
import { GitMcpClient } from "../client/mcpClient.js";
import { parseVerdict, type Verdict } from "./verdict.js";

const BASE_PROMPT =
  "Eres un Ingeniero de Software Senior experto en Code Review. " +
  "Analiza el código buscando bugs, problemas de seguridad, errores de tipos, malas prácticas o mejoras de rendimiento, " +
  "y da una devolución técnica constructiva y profesional, indicando archivo y línea cuando puedas.\n\n" +
  "Termina SIEMPRE con una última línea exacta:\n" +
  "VEREDICTO: BLOQUEAR  → solo si hay problemas críticos (bugs claros, vulnerabilidades, secretos expuestos, código que no compila).\n" +
  "VEREDICTO: APROBADO  → en cualquier otro caso (las sugerencias menores no bloquean).";

export interface ReviewOptions {
  /** Si se indica, revisa los commits entre base y head (modo pre-push) en vez de los cambios locales. */
  range?: { base: string; head: string };
  /** Directorio del repositorio a revisar (default: el actual). */
  cwd?: string;
  quiet?: boolean;
}

export interface ReviewResult {
  review: string | null;
  verdict: Verdict;
}

export async function runGitReviewerAgent({ range, cwd, quiet = false }: ReviewOptions = {}): Promise<ReviewResult> {
  const mcpClient = new GitMcpClient();
  await mcpClient.connect(cwd, quiet);

  try {
    // Descubrimiento dinámico: las tools vienen del servidor MCP, no están hardcodeadas acá.
    const tools = await loadMcpTools(mcpClient.sdk);
    if (!quiet) console.log(`🛠️ [Agente] Herramientas descubiertas vía MCP:`, tools.map((t) => t.name));

    const user = range
      ? `Revisa los commits que se van a pushear, entre ${range.base} y ${range.head}. ` +
        `Usa get_commit_log para entender la intención y get_range_diff para ver los cambios.`
      : "Revisa los cambios locales pendientes: primero get_git_status y luego get_git_diff.";

    const result = await runAgent({
      client: createOpenAI(),
      model: defaultModel(),
      system: BASE_PROMPT,
      user,
      tools,
      maxIterations: 8,
      onEvent: quiet ? undefined : consoleLogger("🔍"),
    });

    if (result.stoppedReason === "max_iterations") {
      return { review: null, verdict: "unknown" };
    }
    return { review: result.finalText, verdict: parseVerdict(result.finalText ?? "") };
  } finally {
    await mcpClient.disconnect(quiet);
  }
}
