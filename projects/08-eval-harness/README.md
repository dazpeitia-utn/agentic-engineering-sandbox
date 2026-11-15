# 📏 Proyecto 08: Eval Harness

Un framework de **evaluaciones** para medir los agentes del monorepo con datasets versionados, evaluadores que el agente nunca ve y comparación entre versiones. Nació del hallazgo del proyecto 06: un `slugify` que pasó sus tests y fue aprobado por el revisor LLM, pero tenía un bug.

> **Idea central:** "los tests pasan" y "el LLM aprueba" son señales que produce el mismo sistema que estamos evaluando. Un eval necesita una verdad independiente: chequeos ocultos, propiedades, mutantes.

---

## ▶️ Uso

```bash
npm run evals -w 08-eval-harness -- list                                   # suites disponibles (💲 = usa la API)
npm run evals -w 08-eval-harness -- run slugify-fixtures                   # sin API
npm run evals -w 08-eval-harness -- run bug-fixer --repeats 3              # agente 04
npm run evals -w 08-eval-harness -- run unit-tester --repeats 2            # agente 01
npm run evals -w 08-eval-harness -- run orchestrator --variant thorough    # agente 06 con otra variante de prompts
npm run evals -w 08-eval-harness -- run bug-fixer --only off-by-one --model gpt-4o-mini
npm run evals -w 08-eval-harness -- compare reports/<suite>/<antes>.json reports/<suite>/<despues>.json
```

Cada corrida imprime cada caso, guarda un reporte JSON en `reports/<suite>/` (pass rate, puntaje por evaluador, costo, tokens, latencia p50/p95, coincidencia de los jueces y commit evaluado, con `+dirty` si había cambios sin commitear) y sale con código 1 si algún caso falla. `compare` sale con código 1 si hay regresiones, así que se puede usar en CI.

---

## 🧱 Cómo está armado

| Pieza | Qué es |
|---|---|
| **Suite** | Un dataset de casos + variantes + cómo correr el target + evaluadores (`src/suites/`). |
| **Caso** | Una entrada con sus datos ocultos (`src/datasets/`). Cada caso corre en su propia carpeta en `.runs/`. |
| **Variante** | Una versión de lo que se evalúa (prompt, modelo, motor). Permite comparar dos versiones del mismo agente. |
| **Evaluador** | Devuelve un puntaje 0–1 y si pasa. Los **decisivos** definen si el caso pasa; los **no decisivos** (jueces) se miden contra los decisivos. |
| **Costo** | Cada caso usa un cliente que cuenta tokens y calcula el costo con los precios del proxy (07). |

### Tipos de evaluadores

| Evaluador | Tipo | Qué detecta |
|---|---|---|
| `slugify_properties` | **Property-based** (`fast-check`) | Genera 400 textos con acentos, eñes y signos y verifica 4 propiedades: coincide con un oráculo, formato válido, ignora acentos e idempotencia. Cuando falla, **achica el contraejemplo** al mínimo. |
| `hidden_checks` | Chequeos ocultos | Casos que el agente nunca ve: detectan parches que solo hacen pasar el test visible. |
| `mutation_score` | **Mutation testing** | Mete bugs a propósito en el código y corre los tests que generó el agente: un buen test los detecta. |
| `patch_size` | Código | Líneas cambiadas: el parche debe ser mínimo. |
| `llm_judge` | **LLM-as-judge** con rúbrica (no decisivo) | Evalúa la causa raíz y la explicación. Se mide su coincidencia con los evaluadores determinísticos (% y **kappa de Cohen**). |
| `reviewer_approved` | El revisor del propio 06 (no decisivo) | ¿Cuánto se puede confiar en la aprobación del orquestador? |

Los **datasets también tienen tests** (`src/datasets/datasets.test.ts`): cada bug tiene un parche de referencia, cada mutante debe cambiar el código y los chequeos ocultos se validan contra implementaciones escritas a mano. Escribiendo el dataset, un CUIT "válido" mío resultó tener mal el dígito verificador: un error así en el dataset habría hecho fallar a cualquier agente.

---

## 🔬 Resultados de las corridas reales

### 1. El bug de `slugify` (sin API)

`slugify-fixtures` evalúa las dos implementaciones que generó el 06 y que **pasaron sus tests y fueron aprobadas por el revisor**:

| Implementación | Resultado | Contraejemplo mínimo |
|---|---|---|
| `reference` (a mano) | ✅ 4/4 propiedades | — |
| `buggy-06-langgraph` | ❌ | `"î"` → `"o"` (tablas de acentos desalineadas) |
| `custom-06` | ❌ | `"_"` → `"_"` (`\w` incluye el guion bajo) |

En la corrida real del orquestador apareció un tercer bug (`"Â"` → error de slug vacío) y otro más (`"a;a"` → `"aa"`). **Ninguno lo detectaron los tests del agente ni el revisor LLM.**

### 2. Bug Fixer (04): el eval encontró *reward hacking*

| Corrida | Pass rate | Costo |
|---|---|---|
| Antes (4 casos × 3) | 83% (10/12) | US$0.25 |
| Después del fix | **100% (12/12)** | US$0.24 |

Las dos fallas eran el mismo patrón: en vez de arreglar `src/total.ts`, el agente **creaba un archivo nuevo `src/total.js` con el código correcto**. Como el test importa `"./total.js"`, el test visible pasaba con el bug intacto. Los chequeos ocultos y el juez lo detectaron. El fix en el 04 tiene dos capas:
- **Permiso estructural:** solo puede modificar archivos que ya existen. Es la capa que importa: un prompt se puede ignorar, un permiso no.
- **Prompt:** le explica que `./x.js` en un import corresponde a `x.ts`.

El **juez LLM coincidió 100% con los evaluadores determinísticos (kappa 1.00, n=12)** en esta suite.

### 3. Unit Tester (01): mutation testing

Pass rate 100% (6/6). Mutation score: `math` 4/4, `clamp` 5/5, `palindromo` 3/4. En `palindromo` **siempre sobrevive el mismo mutante**: sacar el manejo de acentos. Los tests generados nunca prueban acentos. Es el mismo punto ciego que tuvo el 06 con `slugify`.

### 4. Orchestrator (06): un cambio de prompt "obvio" no mejoró nada

Variante `thorough`: el tester agrega "casos de borde exhaustivos" y el desarrollador "prefiere APIs estándar".

| | baseline | thorough |
|---|---|---|
| Pass rate (3 tareas × 2) | 67% | 67% |
| `slugify` | 0% | 50% ⬆️ |
| `formatear-bytes` | 100% | 50% ⬇️ |
| `validar-cuit` | 100% | 100% |
| Costo | US$0.24 | **US$1.01 (×4)** |
| Coincidencia del revisor del 06 con la verdad | 67% · kappa 0.00 | 67% · kappa 0.25 |

El tester "exhaustivo" **inventó requisitos** que la tarea no pedía ("lanzar error por encima de TB", esperar `"1.5009765625 KB"` cuando la tarea pide un decimal). El desarrollador gastó sus 3 intentos tratando de cumplir tests incorrectos. Pedir más casos de borde sin un oráculo también produce tests equivocados. Y el **kappa ≈ 0 del revisor** dice que su aprobación casi no aporta información: aprobó todos los `slugify` con bugs.

Además, la primera corrida encontró un **bug en el propio 06**: su validación del plan rechazaba nombres en camelCase (`src/validarCuit.ts`), y por eso 2 de las 3 tareas ni arrancaban. Ya está corregido.

> **Costo total de las corridas reales documentadas acá:** unos US$2 de la cuenta de OpenAI.

---

## 📂 Estructura

```text
08-eval-harness/
├── src/
│   ├── cli.ts                    # list · run · compare
│   ├── core/                     # runner, tipos, costo, estadísticas (percentiles, kappa), comparación, formato
│   ├── evaluators/               # property-based de slugify, chequeos ocultos, LLM judge, carga de módulos
│   ├── datasets/                 # casos versionados + tests de los propios datasets
│   └── suites/                   # slugify-fixtures, bug-fixer, unit-tester, orchestrator
├── fixtures/slugify/             # las implementaciones reales que generó el 06 (la evidencia)
├── .runs/                        # carpeta de cada caso (ignorada por git)
└── reports/                      # reportes JSON (ignorados por git)
```

`npm test` desde la raíz corre los tests del harness (runner, comparación, kappa, la suite `slugify-fixtures` y los datasets) sin llamar a la API.
