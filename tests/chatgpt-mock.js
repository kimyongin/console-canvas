// Deterministic UI transport only. Never opens login or sends inference requests.
const qaStatus = {
  available: true,
  activeId: '',
  pending: false,
  message: 'QA 가상 계정 · 실제 로그인/추론 아님',
  accounts: [],
};
let qaNumber = 0;
window.chatgptMock = {
  calls: [],
  mode: 'complete',
  storageMode: 'complete',
  complete(planEnabled = true) {
    qaStatus.pending = false;
    qaStatus.activeId = 'qa-registration';
    qaStatus.accounts = [
      { id: 'qa-registration', label: 'QA 가상 계정 · 000001', loggedIn: true, planEnabled },
    ];
    qaStatus.message = 'QA 가상 로그인 완료 · 실제 추론 아님';
  },
};
window.ConsoleCanvasDesktop = {
  onHistory() {},
  onFlush() {},
  onSnapshot() {},
  getConnection: async () => null,
  showSource() {},
  chatgpt: Object.fromEntries(
    [
      'status',
      'login',
      'cancel-login',
      'models',
      'select',
      'logout',
      'generate',
      'cancel',
      'usage',
    ].map((name) => [
      name,
      async (value) => {
        window.chatgptMock.calls.push({ name, value });
        if (name === 'status' && window.chatgptMock.storageMode === 'wait')
          await new Promise((resolve) => (window.chatgptMock.releaseStorage = resolve));
        if (name === 'status' && window.chatgptMock.storageMode === 'denied')
          return { ok: false, error: { code: 'storage_unavailable', message: 'QA denied' } };
        if (name === 'login') qaStatus.pending = true;
        if (name === 'cancel-login') qaStatus.pending = false;
        if (name === 'logout') {
          qaStatus.accounts[0].loggedIn = false;
          qaStatus.message = 'QA 로그아웃';
        }
        if (name === 'models')
          return { ok: true, value: [{ id: 'qa-model', name: 'QA 가상 모델' }] };
        if (name === 'generate') {
          if (window.chatgptMock.mode === 'input-too-large')
            return { ok: false, error: { code: 'input_too_large', message: 'QA input size' } };
          if (window.chatgptMock.mode === 'failure')
            return {
              ok: true,
              value: {
                candidates: [],
                usage: [],
                failures: [{ code: 'subscription_sharing_usage_limit_exceeded' }],
                canceled: false,
              },
            };
          return {
            ok: true,
            value: {
              candidates: [
                {
                  request_id: value.request.id,
                  name: 'QA 시안 ' + ++qaNumber,
                  summary: '모의 응답 · 실제 추론 아님',
                  patches: [
                    {
                      type: 'style',
                      element_id: value.request.baseline.selection[0],
                      properties: { 'border-radius': qaNumber * 5 + 'px' },
                    },
                  ],
                },
              ],
              usage: [{ input_tokens: 10, output_tokens: 20 }],
              failures: [],
              canceled: false,
            },
          };
        }
        return { ok: true, value: structuredClone(qaStatus) };
      },
    ]),
  ),
};
