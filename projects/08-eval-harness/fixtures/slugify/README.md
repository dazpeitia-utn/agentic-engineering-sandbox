# Fixtures de `slugify`

| Archivo | Origen | ¿Es correcto? |
|---|---|---|
| `reference.ts` | Escrito a mano | ✅ Es el oráculo de la suite. |
| `buggy-06-langgraph.ts` | Generado por el proyecto 06 (motor LangGraph). Pasó sus 7 tests y el revisor LLM lo aprobó. | ❌ Las tablas de acentos están desalineadas: `"Fête"` → `"fite"`, `"ç"` → `"n"`. |
| `custom-06.ts` | Generado por el proyecto 06 (motor propio). Pasó sus 7 tests y el revisor LLM lo aprobó. | ❌ Usa `[^\w]+`, y `\w` incluye `_`: `"a_b"` queda `"a_b"` en vez de `"a-b"`. |

Los archivos generados se copiaron tal cual salieron de las corridas reales del 06; no hay que corregirlos, porque son la evidencia.
