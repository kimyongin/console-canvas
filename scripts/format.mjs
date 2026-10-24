import fs from 'node:fs/promises';
import path from 'node:path';
import * as prettier from 'prettier';

const root = path.resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const ignored = new Set(['node_modules', 'dist', 'local', 'reviews', '.git', 'skills']);
let failed = false;
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) await visit(path.join(directory, entry.name));
      continue;
    }
    if (!/\.(?:m?js|cjs|css|html)$/.test(entry.name)) continue;
    if (['preview.html', 'example-review.html'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    const source = await fs.readFile(filename, 'utf8');
    const options = { ...(await prettier.resolveConfig(filename)), filepath: filename };
    if (check) {
      if (!(await prettier.check(source, options))) {
        console.error('Unformatted: ' + path.relative(root, filename));
        failed = true;
      }
    } else await fs.writeFile(filename, await prettier.format(source, options));
  }
}
await visit(root);
if (failed) process.exitCode = 1;
