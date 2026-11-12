import * as fs from 'fs/promises';
import * as path from 'path';

export async function readFileTool(filePath: string): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  return await fs.readFile(absolutePath, 'utf-8');
}

export async function writeFileTool(filePath: string, content: string): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf-8');
  return `Test guardado exitosamente en: ${filePath}`;
}
