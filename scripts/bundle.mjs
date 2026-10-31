import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root = path.resolve(import.meta.dirname, '..');
const result = await build({
  absWorkingDir: root,
  stdin: { contents: "import './capture.js'; import './editor.js';", resolveDir: root },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
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
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).filter((name) =>
  name.startsWith('node_modules/'),
)) {
  let directory = path.dirname(path.join(root, input));
  while (directory.startsWith(path.join(root, 'node_modules'))) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (!packages.has(meta.name)) {
        let license = '';
        for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'])
          try {
            license = await fs.readFile(path.join(directory, name), 'utf8');
            break;
          } catch {}
        packages.set(meta.name, meta.name + ' ' + meta.version + '\n' + license);
      }
      break;
    } catch {
      directory = path.dirname(directory);
    }
  }
}
packages.set('shadcn/ui', await fs.readFile(path.join(root, 'ui/react/SOURCES.md'), 'utf8'));
await fs.writeFile(
  path.join(root, 'THIRD_PARTY_NOTICES.txt'),
  [...packages.values()].join('\n\n---\n\n').replace(/\r\n/g, '\n'),
);
const theme = await postcss([tailwind()]).process(
  await fs.readFile(path.join(root, 'ui/react/theme.css'), 'utf8'),
  { from: path.join(root, 'ui/react/theme.css') },
);
await fs.writeFile(
  path.join(root, 'editor-runtime.css'),
  styles.outputFiles[0].text + '\n' + theme.css,
);
await fs.writeFile(path.join(root, 'editor-runtime.js'), result.outputFiles[0].text);
await fs.writeFile(
  path.join(root, 'dist/editor.bundle.css'),
  styles.outputFiles[0].text + '\n' + theme.css,
);
const publicFiles = [
  ...new Set([
    'editor.html',
    'agent-guide.md',
    'editor-runtime.js',
    'editor-runtime.css',
    'THIRD_PARTY_NOTICES.txt',
    'editor.css',
    'preview.html',
    'sample.uiclone.json',
    'fixtures/console.html',
    'fixtures/console.css',
    'fixtures/console.js',
    ...Object.keys(result.metafile.inputs).filter(
      (name) => name !== '<stdin>' && !name.startsWith('node_modules/'),
    ),
    ...Object.keys(styles.metafile.inputs).map((name) =>
      path.relative(root, path.resolve(root, name)),
    ),
  ]),
].sort();
await fs.writeFile(
  path.join(root, 'runtime-manifest.json'),
  JSON.stringify({ public: publicFiles }, null, 2) + '\n',
);
