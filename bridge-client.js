// HTTP is only the authenticated loopback link. MCP itself runs over stdio.
export function createMcpBridge({ metadata, execute, onStatus }) {
  let current = null,
    generation = 0;
  async function call(connection, path, body) {
    const response = await fetch(connection.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.token },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      signal: connection.controller.signal,
    });
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error?.message || '연결 요청이 거절되었습니다.');
      error.permanent = response.status === 401 || response.status === 403;
      throw error;
    }
    return value;
  }
  async function loop(connection, version) {
    let ack = null;
    while (current === connection && generation === version) {
      try {
        const screen = metadata();
        if (!screen) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        const response = await call(connection, '/bridge/poll', { screen, ack });
        if (current !== connection || generation !== version) return;
        if (!response.ok) throw new Error(response.error?.message || '연결이 종료되었습니다.');
        ack = null;
        onStatus({ connected: true, message: 'MCP 연결됨', revision: screen.revision });
        if (response.command) {
          const command = response.command;
          let result;
          try {
            result = await execute(command);
          } catch (error) {
            result = { ok: false, error: { code: 'editor_error', message: error.message } };
          }
          ack = { command_id: command.command_id, result };
          onStatus({
            connected: true,
            message: result.ok
              ? '에이전트 · ' + command.name
              : '요청 확인 필요 · ' + (result.error?.message || command.name),
            revision: metadata()?.revision,
          });
        }
      } catch (error) {
        if (current !== connection || generation !== version) return;
        if (error.permanent) {
          current = null;
          generation++;
          connection.controller.abort();
          onStatus({
            connected: false,
            message: 'MCP 인증이 변경되었습니다. 다시 연결하거나 앱을 다시 열어 주세요.',
          });
          return;
        }
        onStatus({ connected: false, retrying: true, message: 'MCP 재연결 중 · ' + error.message });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  async function disconnect() {
    const connection = current;
    if (!connection) return;
    current = null;
    generation++;
    try {
      await call(connection, '/bridge/disconnect', { editor_id: connection.editorId });
    } catch {}
    connection.controller.abort();
    onStatus({ connected: false, message: 'MCP 연결 안 됨' });
  }
  async function connect(url, token) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.username ||
      parsed.password ||
      !/^\/?$/.test(parsed.pathname) ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('로컬 주소 http://127.0.0.1:포트만 사용할 수 있습니다.');
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('연결 코드를 확인해 주세요.');
    if (!metadata()) throw new Error('먼저 편집할 화면을 가져와 주세요.');
    await disconnect();
    const connection = {
      url: parsed.origin,
      token,
      editorId: metadata().editor_id,
      controller: new AbortController(),
    };
    const response = await fetch(connection.url + '/health', {
      headers: { Authorization: 'Bearer ' + token },
      credentials: 'omit',
      cache: 'no-store',
      signal: connection.controller.signal,
    });
    const health = await response.json();
    if (!response.ok || health.service !== 'console-canvas')
      throw new Error('MCP 서버 또는 연결 코드가 올바르지 않습니다.');
    current = connection;
    const version = ++generation;
    onStatus({ connected: true, message: 'MCP 연결됨' });
    void loop(connection, version);
  }
  return { connect, disconnect, isConnected: () => !!current };
}
