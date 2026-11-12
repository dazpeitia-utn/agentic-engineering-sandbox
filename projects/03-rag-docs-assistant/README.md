# 📚 Proyecto 03: RAG Docs Assistant

Asistente técnico basado en **Retrieval-Augmented Generation (RAG)** diseñado para indexar dinámicamente la documentación de todos los proyectos del monorepo y responder consultas arquitectónicas o de implementación con precisión contextual.

---

## 🏗️ Arquitectura del Sistema

El proyecto implementa un pipeline RAG completo en TypeScript sin depender de bases de datos vectoriales externas pesadas, utilizando almacenamiento vectorial local en JSON y cálculo matemático directo:

1. **Indexador Dinámico (`src/indexer/indexDocs.ts`):**
   - Escanea automáticamente todos los subdirectorios dentro de `projects/` en busca de archivos `README.md` (escalable a cualquier cantidad de proyectos futuros).
   - Fragmenta el contenido en bloques semánticos (*chunking*) y genera vectores de incrustación (*embeddings*) mediante el modelo `text-embedding-3-small` de OpenAI.
   - Persiste los vectores y metadatos en `src/vector-db.json`.

2. **Recuperador Semántico (`src/retriever/searchDocs.ts`):**
   - Convierte la consulta del usuario en un vector utilizando el mismo espacio de embeddings.
   - Calcula la **similitud de coseno** contra todos los fragmentos almacenados y recupera los `topK` resultados más relevantes.

3. **Agente Generador (`src/agent/ragAgent.ts`):**
   - Inyecta los fragmentos recuperados como contexto estricto en el prompt de `gpt-4o`, evitando alucinaciones y garantizando respuestas fundamentadas únicamente en la documentación del repositorio.
