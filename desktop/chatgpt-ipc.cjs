function registerChatgptIpc({ ipcMain, service, trust, openUsage }) {
  for (const [name, callback] of Object.entries({
    status: () => service.status(),
    login: (id) => service.login(id),
    'cancel-login': () => service.cancelLogin(),
    models: () => service.models(),
    select: (id) => service.select(id),
    logout: (id) => service.logout(id),
    generate: (value) => service.generate(value),
    cancel: (id) => service.cancel(id),
    usage: openUsage,
  })) {
    ipcMain.handle('canvas:chatgpt-' + name, async (event, ...args) => {
      trust(event);
      try {
        return { ok: true, value: await callback(...args) };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: typeof error.code === 'string' ? error.code : 'connection_failed',
            message:
              'ChatGPT 연결 작업을 완료하지 못했습니다. (' +
              (typeof error.code === 'string' ? error.code : 'connection_failed') +
              ')',
          },
        };
      }
    });
  }
}
module.exports = { registerChatgptIpc };
