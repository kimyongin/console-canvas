# Console Canvas 작업 지침

- 주 사용 경로는 `desktop/`의 Electron Chromium 내장 앱이며 Chrome MV3 확장은 보조 방식이다. HTML 편집기와 Python MCP 서버는 외부 런타임 패키지 없이 동작한다. Electron 및 공식 MCP SDK는 개발 의존성이다.
- `capture.js`는 읽기만 수행한다. 원본 페이지를 변경하거나 원본 이벤트를 실행하지 않는다. `engine.js`가 가져온 HTML을 재정제한 뒤 스크립트 없는 iframe에서 표시한다.
- 원본 DOM 식별자와 편집 오프셋은 유지한다. 부모 이동과 삭제는 이미 분리한 자식에도 적용하고, 변경 기록에서 조상 삭제 아래의 변경은 중복 나열하지 않는다.
- `sample.uiclone.json`과 `fixtures/`는 가상 NORTH 콘솔 데이터다. 실제 사이트 캡처나 사용자 전달 ZIP을 저장소에 커밋하지 않는다.
- `skills/console-canvas/`는 독립 설치 가능한 에이전트 스킬이다. 런타임 ZIP은 의도적으로 포함한 배포 자산이며 `scripts/build.py`로 다시 만든다. 자산을 직접 수정하지 않는다.
- 변경 뒤 `python3 -m unittest discover -s tests -p 'test_*.py'`와 `python3 scripts/build.py`를 실행한다. 수집/편집 엔진 변경 시 로컬 서버의 `tests/integration.html`도 실제 브라우저에서 확인한다.
- 독립 실행 `preview.html`과 `dist/`는 생성물이다. 확장 런타임 파일이 바뀌면 빌드 후 스킬의 ZIP 자산도 함께 갱신한다.
- 실제 Chrome 확장 설치/권한 경계 검증과 샘플 브라우저 검증을 구분해서 보고한다.
- `mcp/server.py`는 stdio MCP 어댑터, `mcp/bridge.py`는 인증된 루프백 연결, `editor-controller.js`는 캡처 복제본만 조작한다. 연결한 화면만 공개하고 원본 웹사이트에 MCP 명령을 전달하지 않는다.
- 쓰기에는 화면 버전과 고유 operation_id를 요구한다. 작업 묶음은 한 실행 취소 단계이며, 사람의 편집과 같은 기록을 사용한다. 토큰·실제 캡처·로그인 프로필을 커밋하지 않는다.
- 데스크톱 원본 사이트는 Node 없이 contextIsolation·sandbox·webSecurity를 유지한다. 로컬 편집기에만 제한된 preload API를 제공하고 IPC 호출자의 프레임을 검증한다.
- MCP 변경은 실제 SDK 클라이언트로 검증한다. `node scripts/verify_mcp.mjs`는 독립 앱에 연결한 가상 샘플에만 사용한다. 앱 배포는 `python3 scripts/build_desktop.py`로 공식 Electron SHA-256 검증 후 생성한다.
