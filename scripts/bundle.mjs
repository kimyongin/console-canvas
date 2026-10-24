import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const result = await build({
  absWorkingDir: root,
  stdin: { contents: "import './capture.js'; import './editor.js';", resolveDir: root },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  write: false,
  metafile: true,
});
const styles = await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'editor.css')],
  bundle: true,
  write: false,
  metafile: true,
});
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(path.join(root, 'dist/editor.bundle.css'), styles.outputFiles[0].text);
await fs.writeFile(path.join(root, 'dist/editor.bundle.js'), result.outputFiles[0].text);
const publicFiles = [
  ...new Set([
    'editor.html',
    'editor.css',
    'preview.html',
    'sample.uiclone.json',
    'fixtures/console.html',
    'fixtures/console.css',
    'fixtures/console.js',
    ...Object.keys(result.metafile.inputs).filter((name) => name !== '<stdin>'),
    ...Object.keys(styles.metafile.inputs).map((name) =>
      path.relative(root, path.resolve(root, name)),
    ),
  ]),
].sort();
await fs.writeFile(
  path.join(root, 'runtime-manifest.json'),
  JSON.stringify({ public: publicFiles }, null, 2) + '\n',
);
