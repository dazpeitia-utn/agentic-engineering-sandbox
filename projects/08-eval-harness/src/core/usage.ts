import type { ChatClient } from "@sandbox/agent-core";
import { costOf, DEFAULT_PRICING } from "07-guardrails-eval-proxy/budget";

/**
 * Envuelve un cliente para contar tokens y costo de todas las llamadas que
 * hace un agente durante un caso. Reutiliza los precios del proxy (07).
 */
export class UsageTracker {
  promptTokens = 0;
  completionTokens = 0;
  costUsd = 0;
  calls = 0;

  wrap(inner: ChatClient): ChatClient {
    return {
      chat: {
        completions: {
          create: async (params) => {
            const response = await inner.chat.completions.create(params);
            this.calls++;
            this.promptTokens += response.usage?.prompt_tokens ?? 0;
            this.completionTokens += response.usage?.completion_tokens ?? 0;
            this.costUsd += costOf(params.model, response.usage, DEFAULT_PRICING);
            return response;
          },
        },
      },
    };
  }
}
