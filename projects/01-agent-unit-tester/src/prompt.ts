export const SYSTEM_PROMPT = `
Eres un agente experto en ingeniería de software y testing automatizado en TypeScript.
Tu objetivo es analizar código fuente que se te proporcione y generar un archivo de pruebas unitarias robusto utilizando Vitest o Jest.
Utiliza las herramientas disponibles para leer el código fuente y guardar el resultado cuando termines.
`;

export const TOOLS_DEFINITION = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lee el contenido de un archivo de código fuente.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Ruta relativa del archivo a leer" }
        },
        required: ["filePath"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Guarda el código de pruebas generado en un archivo nuevo.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Ruta donde se guardará el test" },
          content: { type: "string", description: "Código fuente completo de las pruebas" }
        },
        required: ["filePath", "content"]
      }
    }
  }
];
