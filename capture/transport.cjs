// One timeout policy for both platform CDP transports.
function timedSend(send) {
  return async (method, params = {}, session) => {
    let timer;
    try {
      return await Promise.race([
        send(method, params, session),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('수집 응답 시간 초과: ' + method)),
            method === 'Network.loadNetworkResource'
              ? 5000
              : method === 'Page.getResourceContent'
                ? 400
                : method === 'Runtime.evaluate'
                  ? params.expression?.length > 1_000_000
                    ? 45000
                    : 15000
                  : 2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}
module.exports = { timedSend };
