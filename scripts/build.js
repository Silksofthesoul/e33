import { mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'dist/assets'), { recursive: true });
await copyFile(path.join(root, 'index.html'), path.join(root, 'dist/index.html'));
for (const file of await readdir(path.join(root, 'assets'))) {
  await copyFile(path.join(root, 'assets', file), path.join(root, 'dist/assets', file));
}
console.log('Static files prepared in dist/ (no dependencies or server API).');
