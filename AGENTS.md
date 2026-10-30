# Console Canvas 작업 지침

- 제품 요구사항과 확정한 UI 동작은 `docs/PRD.md`를 기준으로 한다. 동작을 바꾸면 해당 FR/AC와 연결된 이슈, README·관련 스킬을 함께 갱신한다. 사용법·구현 구조·검증 결과의 역할을 구분하고 계획/미검증을 구현/검증 완료로 표시하지 않는다.
- 사용자가 2026-10-25 승인한 [변경별 검증 기준](docs/validation-policy.md)을 따른다. 공통 편집기 UI·디자인·패널·주석·스냅샷·이력 변경은 웹 검증으로 완료한다. 영향받은 흐름을 브라우저에서 사용하고 필요한 자동 검사를 통과하면 UI 티켓을 종료할 수 있다. 설치 앱 갱신은 별도 배포 작업이며 모든 UI 변경의 완료 조건이 아니다.
- Electron 수집·IPC·네이티브 파일/클립보드·종료/재실행·업데이트·스킬 설치·로컬 서버 경계를 바꾸면 해당 통합 경로를 추가 검증한다. MCP 변경은 공식 SDK로 확인한다. OS 대화상자·실제 IME·권한 같은 검사가 필요할 때만 실제 OS 환경을 사용한다. 못 한 조건은 통합/배포 티켓에 이관하고 통과로 표시하지 않는다.
- 설치 앱을 교체하기 전 주석 초안·추가 설명까지 저장하고 복구 가능한 백업을 확보한다. 저장 구조를 바꾸는 경우 호환 계층이 없어도 기존 작업을 파일 내보내기·가져오기 또는 검증한 일회성 이전으로 보존한다. 재실행 후 기존 문서·편집·스냅샷 복원, 실제 UI, 설치된 스킬 동기화와 필요한 MCP 연결을 확인한다. 실제 사용자 문서에는 테스트용 편집을 적용하지 않는다.
- 0.25.0부터 `desktop/`의 Electron Chromium 내장 앱만 공식 지원한다. Chrome 확장/WebMCP 소스는 archive/chrome-extension과 v0.24.3에 보존하며 새 배포에 포함하지 않는다. HTML 편집기와 Python MCP 서버는 외부 런타임 패키지 없이 동작한다. 편집기 UI는 React·TypeScript와 shadcn 소스 컴포넌트를 사용하고 React/JSX 런타임은 배포 번들에 포함한다. Tailwind/PostCSS·TypeScript·Electron·공식 MCP SDK·esbuild·Prettier는 개발 도구다. Node.js 22.12 이상을 사용한다.
- `capture.js`는 읽기만 수행한다. 원본 페이지를 변경하거나 원본 이벤트를 실행하지 않는다. `engine.js`가 가져온 HTML을 재정제한 뒤 스크립트 없는 iframe에서 표시한다.
- 원본 DOM 식별자와 편집 오프셋은 유지한다. 부모 이동과 삭제는 이미 분리한 자식에도 적용하고, 변경 기록에서 조상 삭제 아래의 변경은 중복 나열하지 않는다.
- `sample.uiclone.json`과 `fixtures/`는 가상 NORTH 콘솔 데이터다. 실제 사이트 캡처나 사용자 전달 ZIP을 저장소에 커밋하지 않는다.
- `skills/console-canvas/`는 독립 설치 가능한 에이전트 스킬이다. 런타임 ZIP은 의도적으로 포함한 배포 자산이며 `scripts/build.py`로 다시 만든다. 자산을 직접 수정하지 않는다.
- 변경 뒤 `npm run check`를 실행한다. 기본은 타입·포맷·번들/스킬 패키징·Python·Node·Chromium 웹/공통 검사다. `check:web`은 같은 범위를 명시하고 `check:all`은 Electron 통합까지 실행한다. `test:desktop`은 통합 검사만 실행한다. 웹 검사의 Electron은 Chromium 실행기이며 앱 설치/OS 통합 검증을 의미하지 않는다. 검사는 가상 자료와 별도 임시 프로필·포트를 사용한다.
- 독립 실행 `preview.html`과 `dist/`는 생성물이다. 공통 런타임 파일이 바뀌면 빌드 후 스킬의 ZIP 자산도 함께 갱신한다.
- 개발용 웹 검사와 내장 앱 수집·설치 검증을 구분한다. Chrome 확장 지원 종료를 이유로 기존 사용자 확장/저장 자료를 삭제하지 않는다.
- `mcp/server.py`는 stdio MCP 어댑터, `mcp/bridge.py`는 인증된 루프백 연결, `editor-controller.js`는 캡처 복제본만 조작한다. 연결한 화면만 공개하고 원본 웹사이트에 MCP 명령을 전달하지 않는다.
- 쓰기에는 화면 버전과 고유 operation_id를 요구한다. 작업 묶음은 한 실행 취소 단계이며, 사람의 편집과 같은 기록을 사용한다. 토큰·실제 캡처·로그인 프로필을 커밋하지 않는다.
- 데스크톱 원본 사이트는 Node 없이 contextIsolation·sandbox·webSecurity를 유지한다. 로컬 편집기에만 제한된 preload API를 제공하고 IPC 호출자의 프레임을 검증한다.
- MCP 변경은 실제 SDK 클라이언트로 검증한다. `node scripts/verify_mcp.mjs`는 독립 앱에 연결한 가상 샘플에만 사용한다. 앱 배포는 `python3 scripts/build_desktop.py`로 공식 Electron SHA-256 검증 후 생성한다.

- `snapshot-history.js`는 캡처 HTML을 중복 저장하지 않는 버전 목록이다. 과거 이동이나 분기 편집으로 이후 버전을 잘라내지 않고 이동 전 미저장 작업을 보존한다. 목록·활성 버전은 IndexedDB와 전달 파일에 함께 저장한다. 스냅샷 변경 시 `tests/snapshots.html`에서 재실행·파일 왕복도 확인한다.
- 스킬 ZIP은 앱의 `Resources/console-canvas-skill.zip`에 런타임 밖으로 포함해 재귀 패키징을 피한다. `agent-guide.md`는 같은 SKILL.md에서 빌드하며 MCP `get_agent_guide`로 제공한다. 스킬 설치·ZIP 저장 IPC는 신뢰한 앱 셸의 mainFrame에만 제공하고 원본 사이트나 캡처 프레임에는 노출하지 않는다.

- 버전은 `package.json` 한 곳에서 변경한다. 앱과 Python MCP가 같은 버전 값을 읽는다. 이동·주석·작업 묶음 제한은 `edit-policy.json`을 JS와 Python에서 함께 읽는다.
- `scripts/build.py`는 esbuild 의존성 그래프를 따라 JS/CSS를 번들링하고 `runtime-manifest.json`의 공개 자산·체크섬을 생성한다. 새 모듈의 배포 목록을 별도 하드코딩하지 않는다. 공개 자산 목록에 데스크톱 IPC·MCP 구현·개인 데이터를 노출하지 않는다.
- macOS 일반 앱 빌드는 `scripts/build_desktop.py`의 고정 개발 서명을 기본으로 사용한다. 준비한 사용자 전용 `Console Canvas Development Signing` 인증서를 유지하고 키를 재생성하지 않는다. 신원이 없거나 서명에 실패하면 중단하며 ad-hoc으로 자동 전환하지 않는다. `--signing adhoc`은 명시한 격리 검사에만 사용한다. 개인 키·P12·키체인 암호는 저장소/배포 자산에 포함하지 않는다. 개발 서명과 Developer ID·공증·공개 배포 적격을 구분한다.
- 사용자 승인으로 Apple Development 신원을 선택한 기기는 `apple_signing.py`가 기록한 같은 인증서 지문·Team ID를 우선한다. Apple 체인과 실제 개인 키 보유를 검증한 서명 앱에서만 선택한다. 선택한 신원이 사라지면 자체 서명으로도 자동 전환하지 않는다. Xcode 계정 로그인/약관·OS 보안 창은 사용자에게 맡기고 개인 키를 내보내거나 기존 키체인 ACL을 넓히지 않는다. DR·Team ID 일치와 실제 업데이트 후 보호 저장소 무재승인을 따로 검증한다.
- `db.js`는 immutable 캡처·mutable 세션·최근 목록 메타데이터를 분리한다. `editor-session.js`의 저장 큐와 flush를 우회하지 않는다. 종료·업데이트는 `desktop/lifecycle.cjs`의 같은 저장 응답을 기다린다.

- 문서의 사용자 지정 이름·휴지통은 `documents` 메타데이터, 스냅샷의 휴지통은 타임라인 엔트리의 `deletedAt`이다. 원본 캡처·하위 버전·부모 ID를 지우지 않는다. 기본 목록과 MCP는 휴지통을 제외하지만 파일·저장 왕복에서는 유지한다. 휴지통 복구만으로 편집 상태를 적용하지 않는다.

- `ui/react/`는 안정된 셸과 목록 UI를 소유한다. `editor-runtime.js/css`는 생성물이며 직접 수정하지 않는다. 새 UI 명령은 `store.ts`/`commands.ts`에 연결하고 React 버튼의 disabled와 DOM 상태가 달라지지 않게 한다. 캡처 iframe은 엔진 소유이며 React 렌더마다 교체하지 않는다.
- 사용자/MCP 스냅샷 복원은 저장 결과를 기다리는 `restorePersisted`를 사용한다. 입력 검증은 문서 교체 전에 수행하고 긴급 백업은 DB 오류와 분리한다. 표시 표면이 없는 통합 검사는 `npm run test:desktop:offscreen`으로 명시적으로 실행하고 실제 OS 캡처·직접 앱 사용과 구별한다. 잠금 때문에 설치 확인을 못 하면 배포 티켓만 대기하며 웹 UI 완료를 막지 않는다. 강제 종료하거나 저장 확인 없이 사용자 앱을 덮어쓰지 않는다.
