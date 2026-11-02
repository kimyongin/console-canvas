# 공통 복제 엔진 · 두 CDP 입력 호환성 실험

제품 확장 지원을 켜는 구현이 아니다. 별도 headless Chrome 프로필에서 임시 확장을 로드하고 **현재 `desktop/capture-cdp.cjs` 원본 파일**을 Node에서 그대로 실행한다. Electron 대조군은 기존 `captureWebsite()`를 실행하며 같은 엔진을 사용한다. 복제 알고리즘을 복사하거나 Chrome 전용으로 재구현하지 않는다.

- `relay.js`: 실제 `chrome.debugger` 호출·이벤트 전달, 소유한 테스트 탭/iframe 연결만 수행한다. DOM/CSS/이미지 수집 알고리즘 없음.
- `run.mjs`: Browser CDP는 버전 확인·임시 확장 로드·종료에만 쓴다. 엔진 명령은 전부 확장의 `chrome.debugger`를 거친다. 현재 엔진의 명시적 CDP20개를 추출하고 캐시 폴백 명령도 실제 실행한다.
- `baseline.cjs`: 같은 URL/뷰포트에서 기존 Electron 수집 진입점으로 대조한다.
- `settle-view.cjs`: 양쪽에 같은 읽기 전용 시험 준비 조건을 적용한다. Chrome 디버거 안내가 표시되는 동안 변하는 뷰포트를 수집 전에 안정화한다.
- `compare.cjs`: 기존 CanvasScene과 native PNG 렌더러로 저장·편집 없이 비교한다. RGB 각 채널 최대 차이16 이하와 exact 픽셀 비율을 모두 기록한다. 문서/뷰포트/영역을 혼동하지 않는다.

```sh
node experiments/cdp-compat/run.mjs
node_modules/.bin/electron experiments/cdp-compat/compare.cjs
```

검증 환경: macOS arm64, Node24.21.0, Google Chrome156.0.8078.76, Electron45.0.0 / Chromium156.0.8078.48. 다른 Chrome 경로는 `CDP_PROBE_CHROME`, 결과 경로는 `CDP_PROBE_OUTPUT`으로 지정한다. 기존 npm 개발 의존성이 필요하다. 추가 패키지는 설치하지 않는다.

캡처/PNG/전체 로그와 토큰을 포함할 수 있는 임시 설정은 커밋하지 않는다. 결과는 ignored `local/cdp-compat/`에 두며 프로필/확장 설정은 종료 후 정리한다. 사용자 Chrome 프로필·설치 앱·MCP 등록·저장 자료는 수정하지 않는다. `--enable-unsafe-extension-debugging`은 격리 프로필에 확장을 로드하기 위한 시험 전용 플래그다. 웹 보안이나 SOP를 끄지 않고 디버거 안내도 숨기지 않는다.

## 발견한 차이

이 환경에서 raw `Target.attachToTarget`은 선택한 iframe에 `Not allowed`를 반환했다. 같은 iframe은 `chrome.debugger.attach({targetId})`로 연결할 수 있었다. 실험 연결부는 이를 가상 session ID로 정규화하고 이후 명령을 같은 대상에 전달한다. 공통 엔진의 컨텍스트 생성 실패를 한 번 주입해 원래 복구 분기가 이 연결부로 끝나는 것을 확인한다. 주입 오류·원래 권한 오류·캐시 누락은 보고서에서 구별한다. 모든 대상/정책에서 raw 명령이 금지된다는 주장도, API 연결로 접근 제한을 우회할 수 있다는 주장도 하지 않는다.

정상 수집 결과 통과와 raw 명령 전체 호환은 다른 값이다. 보고서의 `allRawCommandsSupported=false`가 정상적으로 남고, 연결부를 통한 `allRequiredOperationsSupported=true`와 별도로 기록된다. 단순 `ok=true`를 ‘제약 없음’으로 읽지 않는다.

여섯 가상 샘플의 결과는 [검증 기록](../../docs/chrome-shared-engine-probe.md)을 따른다. 실제 공개 웹사이트·로그인 사이트·기업 정책·일반 사용자의 DevTools 동시 실행·스토어 배포/앱 전달/MCP 티켓 연결은 이 실험으로 검증한 것이 아니다. 현재 제품의 공식 지원 경로는 내장 앱 그대로다.
