/**
 * Detectores de datos sensibles basados en patrones. Cada uno sabe encontrar
 * y tachar un tipo de dato; los guards de entrada y salida los reutilizan.
 */

export interface Detector {
  /** Nombre corto, ej: "openai_key". Aparece en el texto tachado: [REDACTED:openai_key]. */
  type: string;
  pattern: RegExp;
  /** Validación extra de cada coincidencia (ej: Luhn para tarjetas). */
  validate?: (match: string) => boolean;
}

/** Algoritmo de Luhn: descarta números de 16 dígitos que no pueden ser tarjetas. */
export function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const SECRET_DETECTORS: Detector[] = [
  { type: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { type: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: "openai_key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { type: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "github_token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { type: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { type: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    type: "credential_assignment",
    pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|contrase(?:ñ|n)a)\s*[:=]\s*["']?[^\s"'`,;]{8,}/gi,
  },
];

export const PII_DETECTORS: Detector[] = [
  { type: "credit_card", pattern: /\b(?:\d[ -]?){12,18}\d\b/g, validate: luhn },
  { type: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "cuit_cuil", pattern: /\b(?:20|23|24|27|30|33|34)-?\d{8}-?\d\b/g },
];

export interface DetectionResult {
  text: string;
  /** Cantidad de coincidencias por tipo. */
  counts: Record<string, number>;
}

/** Busca (y opcionalmente tacha) todas las coincidencias de los detectores indicados. */
export function scan(text: string, detectors: Detector[], redact: (type: string) => boolean): DetectionResult {
  const counts: Record<string, number> = {};
  let result = text;
  for (const detector of detectors) {
    result = result.replace(detector.pattern, (match) => {
      if (detector.validate && !detector.validate(match)) return match;
      counts[detector.type] = (counts[detector.type] ?? 0) + 1;
      return redact(detector.type) ? `[REDACTED:${detector.type}]` : match;
    });
  }
  return { text: result, counts };
}
