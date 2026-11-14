# 📚 Proyecto 03: RAG Docs Assistant

Asistente técnico basado en **Retrieval-Augmented Generation (RAG)** que indexa la documentación de todo el monorepo y responde preguntas citando las fuentes, sin inventar.

---

## 🏗️ Arquitectura del Sistema

Pipeline RAG completo en TypeScript, sin base de datos vectorial externa (índice local en JSON):

1. **Indexador (`src/indexer/`):**
   - Busca todos los README: el de la raíz, `packages/*` y `projects/*` (cualquier proyecto nuevo se indexa solo).
   - **Chunking por secciones de markdown** (`chunker.ts`): cada fragmento lleva su jerarquía de títulos (ej: `02 - MCP Git > Conceptos Clave`), así no pierde el contexto. Las secciones largas se parten con solapamiento y los `#` dentro de bloques de código no se toman como títulos.
   - Genera los embeddings con `text-embedding-3-small` **en lotes** (un request por cada 100 fragmentos) y guarda en `src/vector-db.json` el modelo, la fecha y un hash de cada fuente.

2. **Recuperación híbrida (`src/retriever/hybrid.ts` + `bm25.ts`):**
   - **Semántica:** similitud coseno entre el embedding de la pregunta y los fragmentos.
   - **Léxica:** **BM25** propio (normaliza acentos y saca stopwords), que encuentra términos exactos como nombres de tools o archivos, donde los embeddings suelen fallar.
   - Los dos rankings se combinan con **Reciprocal Rank Fusion (RRF)**, sin tener que normalizar puntajes de escalas distintas.

3. **Re-ranking (`src/retriever/rerank.ts`):**
   - Los 12 mejores candidatos pasan por el LLM, que puntúa de 0 a 10 la relevancia de cada uno con **salida estructurada (JSON Schema)**. Quedan los 4 mejores con relevancia ≥ 3.

4. **Generación (`src/agent/ragAgent.ts`):**
   - Responde solo con los fragmentos seleccionados, cita las fuentes (`[1]`, `[2]`...) y dice claramente cuando la respuesta no está en la documentación.

5. **Detección de índice desactualizado:** al consultar, compara el hash de cada README con el del índice y avisa si hay que volver a indexar.

---

## ▶️ Uso

```bash
npm run index -w 03-rag-docs-assistant                                  # (re)indexa la documentación
npm run ask -w 03-rag-docs-assistant -- "¿Qué bloquea readProjectFile?"  # pregunta con re-ranking
npm run ask -w 03-rag-docs-assistant -- "pregunta" --no-rerank          # solo búsqueda híbrida
```

Los tests de `src/rag.test.ts` cubren el chunker, BM25, RRF y la búsqueda híbrida sin llamar a la API.
