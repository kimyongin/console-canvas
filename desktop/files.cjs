const fs = require('node:fs/promises'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
function createFileSaver({ dialog, getWindow, downloads }) {
  return async function saveFile(value) {
    if (
      !value ||
      typeof value.name !== 'string' ||
      value.name !== path.basename(value.name) ||
      value.name.length > 180 ||
      !/^console-canvas-[\w.-]+\.(json|zip)$/.test(value.name) ||
      !(value.bytes instanceof ArrayBuffer) ||
      value.bytes.byteLength > 120_000_000
    )
      throw new Error('저장할 파일 정보가 올바르지 않습니다.');
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '편집 내용 저장',
      defaultPath: path.join(downloads, value.name),
      filters: [
        {
          name: value.name.endsWith('.zip') ? 'ZIP 파일' : '편집 JSON',
          extensions: [value.name.endsWith('.zip') ? 'zip' : 'json'],
        },
      ],
    });
    if (result.canceled) return { canceled: true };
    const temporary = result.filePath + '.canvas-' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, Buffer.from(value.bytes), { mode: 0o600 });
      await fs.rename(temporary, result.filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return { path: result.filePath };
  };
}
module.exports = { createFileSaver };
