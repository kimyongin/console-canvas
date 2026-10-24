# Console Canvas 작업 지침

- 주 사용 경로는 `desktop/`의 Electron Chromium 내장 앱이며 Chrome MV3 확장은 보조 방식이다. HTML 편집기와 Python MCP 서버는 외부 런타임 패키지 없이 동작한다. Electron·공식 MCP SDK·esbuild·Prettier는 개발 의존성이다. Node.js 22.12 이상을 사용한다.
- `capture.js`는 읽기만 수행한다. 원본 페이지를 변경하거나 원본 이벤트를 실행하지 않는다. `engine.js`가 가져온 HTML을 재정제한 뒤 스크립트 없는 iframe에서 표시한다.
- 원본 DOM 식별자와 편집 오프셋은 유지한다. 부모 이동과 삭제는 이미 분리한 자식에도 적용하고, 변경 기록에서 조상 삭제 아래의 변경은 중복 나열하지 않는다.
- `sample.uiclone.json`과 `fixtures/`는 가상 NORTH 콘솔 데이터다. 실제 사이트 캡처나 사용자 전달 ZIP을 저장소에 커밋하지 않는다.
- `skills/console-canvas/`는 독립 설치 가능한 에이전트 스킬이다. 런타임 ZIP은 의도적으로 포함한 배포 자산이며 `scripts/build.py`로 다시 만든다. 자산을 직접 수정하지 않는다.
- 변경 뒤 `npm run check`를 실행한다. 포맷·번들·Python·Node·실제 Chromium·독립 앱 재실행·공식 SDK 연결까지 검증한다. 체크는 사용자 앱과 별도 임시 프로필·포트를 사용한다.
- 독립 실행 `preview.html`과 `dist/`는 생성물이다. 확장 런타임 파일이 바뀌면 빌드 후 스킬의 ZIP 자산도 함께 갱신한다.
- 실제 Chrome 확장 설치/권한 경계 검증과 샘플 브라우저 검증을 구분해서 보고한다.
- `mcp/server.py`는 stdio MCP 어댑터, `mcp/bridge.py`는 인증된 루프백 연결, `editor-controller.js`는 캡처 복제본만 조작한다. 연결한 화면만 공개하고 원본 웹사이트에 MCP 명령을 전달하지 않는다.
- 쓰기에는 화면 버전과 고유 operation_id를 요구한다. 작업 묶음은 한 실행 취소 단계이며, 사람의 편집과 같은 기록을 사용한다. 토큰·실제 캡처·로그인 프로필을 커밋하지 않는다.
- 데스크톱 원본 사이트는 Node 없이 contextIsolation·sandbox·webSecurity를 유지한다. 로컬 편집기에만 제한된 preload API를 제공하고 IPC 호출자의 프레임을 검증한다.
- MCP 변경은 실제 SDK 클라이언트로 검증한다. `node scripts/verify_mcp.mjs`는 독립 앱에 연결한 가상 샘플에만 사용한다. 앱 배포는 `python3 scripts/build_desktop.py`로 공식 Electron SHA-256 검증 후 생성한다.

- `snapshot-history.js`는 캡처 HTML을 중복 저장하지 않는 버전 목록이다. 과거 이동이나 분기 편집으로 이후 버전을 잘라내지 않고 이동 전 미저장 작업을 보존한다. 목록·활성 버전은 IndexedDB와 전달 파일에 함께 저장한다. 스냅샷 변경 시 `tests/snapshots.html`에서 재실행·파일 왕복도 확인한다.
- 스킬 ZIP은 앱의 `Resources/console-canvas-skill.zip`에 런타임 밖으로 포함해 재귀 패키징을 피한다. `agent-guide.md`는 같은 SKILL.md에서 빌드하며 MCP `get_agent_guide`로 제공한다. 스킬 설치·ZIP 저장 IPC는 신뢰한 앱 셸의 mainFrame에만 제공하고 원본 사이트나 캡처 프레임에는 노출하지 않는다.

- 버전은 `package.json` 한 곳에서 변경한다. 빌드가 확장 manifest를 갱신하고 Python MCP도 같은 값을 읽는다. 이동·주석·작업 묶음 제한은 `edit-policy.json`을 JS와 Python에서 함께 읽는다.
- `scripts/build.py`는 esbuild 의존성 그래프를 따라 JS/CSS를 번들링하고 `runtime-manifest.json`의 공개 자산·체크섬을 생성한다. 새 모듈의 배포 목록을 별도 하드코딩하지 않는다. 공개 자산 목록에 데스크톱 IPC·MCP 구현·개인 데이터를 노출하지 않는다.
- `db.js`는 immutable 캡처·mutable 세션·최근 목록 메타데이터를 분리한다. `editor-session.js`의 저장 큐와 flush를 우회하지 않는다. 종료·업데이트는 `desktop/lifecycle.cjs`의 같은 저장 응답을 기다린다.
