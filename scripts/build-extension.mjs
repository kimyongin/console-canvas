import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

export async function buildExtension(root) {
  const destination = path.join(root, 'dist/page-canvas-chrome');
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'extension/manifest.json'), 'utf8'),
  );
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  const graph = JSON.parse(await fs.readFile(path.join(root, 'runtime-manifest.json'), 'utf8'));
  await fs.mkdir(destination, { recursive: true });
  const worker = await build({
    absWorkingDir: root,
    entryPoints: ['extension/background.js'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome156',
    minify: true,
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(worker.metafile.inputs);
  for (const file of graph.native.filter((name) => name.startsWith('capture/'))) {
    if (!inputs.includes(file))
      throw Error('Extension and app must consume the same capture source: ' + file);
  }
  if (
    inputs.some(
      (name) => name.startsWith('desktop/') || name.startsWith('mcp/') || name.startsWith('node:'),
    )
  )
    throw Error('Native runtime leaked into extension');
  await fs.writeFile(path.join(destination, 'background.js'), worker.outputFiles[0].contents);
  for (const name of [
    'popup.html',
    'popup.js',
    'popup.css',
    'region.html',
    'region.js',
    'region.css',
    'review-image.html',
    'review-image.js',
    'review-image.css',
  ])
    await fs.copyFile(path.join(root, 'extension', name), path.join(destination, name));
  for (const name of [
    'editor.html',
    'editor-runtime.js',
    'editor-runtime.css',
    'capture.js',
    'agent-guide.md',
    'sample.uiclone.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
    'fixtures/console.html',
    'fixtures/console.css',
    'fixtures/console.js',
  ]) {
    await fs.mkdir(path.dirname(path.join(destination, name)), { recursive: true });
    await fs.copyFile(
      name === 'agent-guide.md'
        ? path.join(root, 'skills/console-canvas/SKILL.md')
        : path.join(root, name),
      path.join(destination, name),
    );
  }
  await fs.writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify({ ...manifest, version }, null, 2) + '\n',
  );
  const shared = [
    ...graph.native.filter((name) => name.startsWith('capture/')),
    'capture.js',
  ].sort();
  const sources = Object.fromEntries(
    await Promise.all(
      shared.map(async (name) => [
        name,
        createHash('sha256')
          .update(await fs.readFile(path.join(root, name)))
          .digest('hex'),
      ]),
    ),
  );
  const fingerprint = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
  const descriptor = {
    version,
    engine_fingerprint: fingerprint,
    shared_sources: sources,
    worker_inputs: inputs.sort(),
    native_runtime_required: false,
  };
  await fs.writeFile(
    path.join(destination, 'engine-manifest.json'),
    JSON.stringify(descriptor, null, 2) + '\n',
  );
  await fs.writeFile(
    path.join(root, 'dist/page-canvas-chrome.json'),
    JSON.stringify(descriptor, null, 2) + '\n',
  );
  return destination;
}
