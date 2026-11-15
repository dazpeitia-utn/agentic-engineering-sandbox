# 🧠 Proyecto 11: Long-Term Memory Agent

Un asistente que **recuerda entre sesiones**: hechos del usuario, sus preferencias y lo que pasó antes. Al final de cada sesión decide qué guardar, qué actualizar y qué olvidar. Cada sesión es un proceso nuevo; lo único compartido es el store de memorias en disco.

---

## 🧠 Conceptos

| Concepto | Cómo está hecho |
|---|---|
| **Tipos de memoria** | `semantic` (hechos: "vive en Rosario"), `episodic` (qué pasó: "se mudó la semana pasada"), `procedural` (cómo le gusta trabajar: "prefiere respuestas cortas"). La memoria *de trabajo* es el contexto de la sesión. |
| **Store** | `src/store.ts`: JSON con escritura atómica. Cada memoria tiene tema (`subject`), importancia 1–5, fechas de creación, actualización y último acceso, cantidad de accesos, vencimiento opcional, embedding e **historial de versiones**. |
| **Recuperación** | Relevancia = 0.7 × coseno + 0.3 × BM25 (piezas del [RAG del 03](../03-rag-docs-assistant)), combinada con **recencia** (vida media de 30 días desde el último acceso) e **importancia**. Devuelve el top-k y el LLM decide qué usar. |
| **Escritura en dos pasos** | (1) **Extracción**: el LLM propone memorias candidatas a partir de **lo que dijo el usuario** (nunca de las respuestas del asistente), reutilizando los temas que ya existen. (2) **Reconciliación**: cada candidata se compara con las memorias parecidas y el LLM decide `add` / `update` / `noop`, como hace Mem0. Hay además una **regla determinística**: un hecho con el mismo tema que uno guardado nunca se agrega como nuevo, se actualiza. |
| **Olvido** | Memorias con vencimiento (`ttlDays`: "esta semana estoy de vacaciones"), `forget --expired`, borrado a pedido ("olvidate de...") y `forget <id>`. |
| **Privacidad** | Contraseñas, claves, tarjetas y CUITs **nunca** se guardan: se descartan antes de llegar al store, con los detectores del [proxy de guardrails (07)](../07-guardrails-eval-proxy). |

---

## ▶️ Uso

```bash
npm run memory -w 11-long-term-memory -- session "Soy Ana, programo en TypeScript." "Vivo en Córdoba."
npm run memory -w 11-long-term-memory -- session "¿En qué lenguaje programo?"        # otra sesión: lo recuerda
npm run memory -w 11-long-term-memory -- chat                                          # interactivo (línea vacía = fin)
npm run memory -w 11-long-term-memory -- list
npm run memory -w 11-long-term-memory -- show <id>
npm run memory -w 11-long-term-memory -- edit <id> "nuevo contenido"
npm run memory -w 11-long-term-memory -- forget <id>        # o: forget --expired

npm run evals -w 08-eval-harness -- run memory --repeats 3   # suite de evaluación
```

Las memorias quedan en `data/memories.json` (o en `MEMORY_FILE`), una carpeta **ignorada por git** porque contiene datos personales.

---

## 🔬 Lo que mostraron las pruebas reales

Con un usuario ficticio ("Ana") en 4 sesiones separadas:

| Primera versión | Versión final |
|---|---|
| ✅ Recordó TypeScript y VS Code en otra sesión | ✅ |
| ✅ "Sigo usando VS Code" → `noop`, sin duplicar | ✅ |
| ✅ La contraseña del banco no llegó a disco | ✅ |
| ❌ "Me mudé a Rosario" se guardó como episodio aparte, y **"¿Dónde vivo?" respondió Córdoba**. En esa misma sesión volvió a extraer "vive en Córdoba" **de la respuesta equivocada del asistente** | ✅ "Vivís en Rosario": `ciudad` se actualizó y la versión de Córdoba quedó en el historial |

Arreglos que salieron de esto:
1. **El extractor solo ve lo que dijo el usuario.** Un error del asistente no puede convertirse en memoria.
2. **El extractor recibe los temas existentes** y tiene que reutilizarlos.
3. **Regla determinística de "mismo tema"**, aplicada sobre el store actual. Esto también evita duplicados dentro de una misma sesión.

La **suite `memory` del 08** (recordar y actualizar, privacidad y duplicados) encontró además dos regresiones que yo mismo había introducido:
- **Umbrales calibrados con datos falsos.** Con embeddings reales, "¿Dónde vivo?" contra "Vive en Rosario" da **0.22** de similitud; mi umbral de 0.25 (calibrado con el embedder falso de los tests) la descartaba. Lo mismo pasó con un corte relativo que hacía perder un tema en preguntas con dos temas. Ahora se devuelve el top-k con un umbral bajo.
- **El evaluador era demasiado estricto.** Contaba como duplicado un hecho y un episodio del mismo tema, que es justo el diseño buscado.

Resultado final: **100% (6/6 corridas)**. Costo total de las pruebas del 11: unos US$0.15.

> **Mejora al proyecto 07:** probando la privacidad descubrí que el detector de credenciales del proxy atrapaba `password=Hunter2`, pero no "mi contraseña del banco es Hunter2!!". Ahora detecta también credenciales en lenguaje natural, sin tachar frases como "la contraseña es importante".

---

## 📂 Estructura

```text
11-long-term-memory/
├── src/
│   ├── store.ts        # MemoryStore: persistencia, búsqueda híbrida + recencia + importancia, vencimiento, historial
│   ├── session.ts      # respond (lectura) y writeMemories (extracción + reconciliación + privacidad)
│   ├── cli.ts          # session, chat, list, show, edit, forget
│   └── memory.test.ts  # store, privacidad y reconciliación con LLM y embedder falsos
└── data/               # memorias (ignorado por git)
```
