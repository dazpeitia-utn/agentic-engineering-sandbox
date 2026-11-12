import fs from "node:fs/promises";
import path from "node:path";

export async function readFileTool(filePath: string) {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return content;
  } catch (error: any) {
    return `Error leyendo el archivo: ${error.message}`;
  }
}

export async function writeFileTool(filePath: string, content: string) {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    await fs.writeFile(fullPath, content, "utf-8");
    return `✅ Archivo ${filePath} modificado y parche aplicado con éxito.`;
  } catch (error: any) {
    return `Error escribiendo el archivo: ${error.message}`;
  }
}