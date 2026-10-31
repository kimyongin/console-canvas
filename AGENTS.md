# Console Canvas 작업 지침

- 2026-11-01 최신 제품 기준은 `docs/PRD.md`의 티켓 우선 CC-FR/CC-AC와 #169~#176이다. 티켓을 먼저 만들고 그 안에서 편집·주석·같은 ID 목표 확정/구현·검토를 진행한다. 현재 설치본과 MCP·스킬은 0.46.0이며 구현·검증 기록은 `docs/ticket-first-0.46.md`에 둔다. 사후 목표 티켓 등록의 이전 계약/증빙은 `docs/PRD-0.45-history.md`·`docs/ticket-review-0.45-history.md`에 보존한다.
- 과거 테스트 자료 보존 면제는 0.45 전환에 한정한다. 이후 새로 만든 자료에 대한 이번 전환은 보존·백업·검증된 매핑과 실패 롤백을 제공한다. 브라우저 로그인·OS 서명·개인 스킬은 초기화 대상이 아니다. 0.44 이전 계약은 `docs/PRD-0.44-history.md`에 보관한다.

- 제품 요구사항과 확정한 UI 동작은 `docs/PRD.md`를 기준으로 한다. 동작을 바꾸면 해당 FR/AC와 연결된 이슈, README·관련 스킬을 함께 갱신한다. 사용법·구현 구조·검증 결과의 역할을 구분하고 계획/미검증을 구현/검증 완료로 표시하지 않는다.
- 사용자가 2026-10-25 승인한 [변경별 검증 기준](docs/validation-policy.md)을 따른다. 공통 편집기 UI·디자인·패널·주석·스냅샷·이력 변경은 웹 검증으로 완료한다. 영향받은 흐름을 브라우저에서 사용하고 필요한 자동 검사를 통과하면 UI 티켓을 종료할 수 있다. 설치 앱 갱신은 별도 배포 작업이며 모든 UI 변경의 완료 조건이 아니다.
- Electron 수집·IPC·네이티브 파일/클립보드·종료/재실행·업데이트·스킬 설치·로컬 서버 경계를 바꾸면 해당 통합 경로를 추가 검증한다. MCP 변경은 공식 SDK로 확인한다. OS 대화상자·실제 IME·권한 같은 검사가 필요할 때만 실제 OS 환경을 사용한다. 못 한 조건은 통합/배포 티켓에 이관하고 통과로 표시하지 않는다.
- 설치 앱 교체는 현재 작업 저장과 정상 종료를 거친다. 티켓 우선 전환에서는 현재 문서/티켓 자료 보존·전환·재실행·파일 백업과 설치 스킬/MCP 연결을 검증한다. 과거 0.45 초기화 승인을 다시 사용하지 않는다.
- 0.25.0부터 `desktop/`의 Electron Chromium 내장 앱만 공식 지원한다. Chrome 확장/WebMCP 소스는 archive/chrome-extension과 v0.24.3에 보존하며 새 배포에 포함하지 않는다. HTML 편집기와 Python MCP 서버는 외부 런타임 패키지 없이 동작한다. 편집기 UI는 React·TypeScript와 shadcn 소스 컴포넌트를 사용하고 React/JSX 런타임은 배포 번들에 포함한다. Tailwind/PostCSS·TypeScript·Electron·공식 MCP SDK·esbuild·Prettier는 개발 도구다. Node.js 22.12 이상을 사용한다.
- `capture.js`는 읽기만 수행한다. 원본 페이지를 변경하거나 원본 이벤트를 실행하지 않는다. `engine.js`가 가져온 HTML을 재정제한 뒤 스크립트 없는 iframe에서 표시한다.
- 원본 DOM 식별자와 편집 오프셋은 유지한다. 부모 이동과 삭제는 이미 분리한 자식에도 적용하고, 변경 기록에서 조상 삭제 아래의 변경은 중복 나열하지 않는다.
- `sample.uiclone.json`과 `fixtures/`는 가상 NORTH 콘솔 데이터다. 실제 사이트 캡처나 사용자 전달 ZIP을 저장소에 커밋하지 않는다.
- `skills/console-canvas/`는 독립 설치 가능한 에이전트 스킬이다. 런타임 ZIP은 의도적으로 포함한 배포 자산이며 `scripts/build.py`로 다시 만든다. 자산을 직접 수정하지 않는다.
- 변경 뒤 `npm run check`를 실행한다. 기본은 타입·포맷·번들/스킬 패키징·Python·Node·Chromium 웹/공통 검사다. `check:web`은 같은 범위를 명시하고 `check:all`은 Electron 통합까지 실행한다. `test:desktop`은 통합 검사만 실행한다. 웹 검사의 Electron은 Chromium 실행기이며 앱 설치/OS 통합 검증을 의미하지 않는다. 검사는 가상 자료와 별도 임시 프로필·포트를 사용한다.
- 독립 실행 `preview.html`과 `dist/`는 생성물이다. 공통 런타임 파일이 바뀌면 빌드 후 스킬의 ZIP 자산도 함께 갱신한다.
- 개발용 웹 검사와 내장 앱 수집·설치 검증을 구분한다. Chrome 확장 지원 종료를 이유로 기존 사용자 확장/저장 자료를 삭제하지 않는다.
- `mcp/server.py`는 stdio MCP 어댑터, `mcp/bridge.py`는 인증된 루프백 연결, `editor-controller.js`는 캡처 복제본만 조작한다. 0.46 티켓 우선 계약은 명시적으로 허용한 프로젝트/티켓의 저장 작업을 닫힌 편집기에서도 조회한다. 목록/이름 후보·상세·이미지·resource/구독의 권한을 동일하게 하고 철회/휴지통을 반영한다. 원본 웹사이트에 MCP 명령을 전달하지 않는다.
- 쓰기에는 화면 버전과 고유 operation_id를 요구한다. 작업 묶음은 한 실행 취소 단계이며, 사람의 편집과 같은 기록을 사용한다. 토큰·실제 캡처·로그인 프로필을 커밋하지 않는다.
- 데스크톱 원본 사이트는 Node 없이 contextIsolation·sandbox·webSecurity를 유지한다. 로컬 편집기에만 제한된 preload API를 제공하고 IPC 호출자의 프레임을 검증한다.
- MCP 변경은 실제 SDK 클라이언트로 검증한다. `node scripts/verify_mcp.mjs`는 독립 앱에 연결한 가상 샘플에만 사용한다. 앱 배포는 `python3 scripts/build_desktop.py`로 공식 Electron SHA-256 검증 후 생성한다.

- 스킬 ZIP은 앱의 `Resources/console-canvas-skill.zip`에 런타임 밖으로 포함해 재귀 패키징을 피한다. `agent-guide.md`는 같은 SKILL.md에서 빌드하며 MCP `get_agent_guide`로 제공한다. 스킬 설치·ZIP 저장 IPC는 신뢰한 앱 셸의 mainFrame에만 제공하고 원본 사이트나 캡처 프레임에는 노출하지 않는다.

- 버전은 `package.json` 한 곳에서 변경한다. 앱과 Python MCP가 같은 버전 값을 읽는다. 이동·주석·작업 묶음 제한은 `edit-policy.json`을 JS와 Python에서 함께 읽는다.
- `scripts/build.py`는 esbuild 의존성 그래프를 따라 JS/CSS를 번들링하고 `runtime-manifest.json`의 공개 자산·체크섬을 생성한다. 새 모듈의 배포 목록을 별도 하드코딩하지 않는다. 공개 자산 목록에 데스크톱 IPC·MCP 구현·개인 데이터를 노출하지 않는다.
- macOS 일반 앱 빌드는 `scripts/build_desktop.py`의 고정 개발 서명을 기본으로 사용한다. 준비한 사용자 전용 `Console Canvas Development Signing` 인증서를 유지하고 키를 재생성하지 않는다. 신원이 없거나 서명에 실패하면 중단하며 ad-hoc으로 자동 전환하지 않는다. `--signing adhoc`은 명시한 격리 검사에만 사용한다. 개인 키·P12·키체인 암호는 저장소/배포 자산에 포함하지 않는다. 개발 서명과 Developer ID·공증·공개 배포 적격을 구분한다.
- 사용자 승인으로 Apple Development 신원을 선택한 기기는 `apple_signing.py`가 기록한 같은 인증서 지문·Team ID를 우선한다. Apple 체인과 실제 개인 키 보유를 검증한 서명 앱에서만 선택한다. 선택한 신원이 사라지면 자체 서명으로도 자동 전환하지 않는다. Xcode 계정 로그인/약관·OS 보안 창은 사용자에게 맡기고 개인 키를 내보내거나 기존 키체인 ACL을 넓히지 않는다. DR·Team ID 일치와 실제 업데이트 후 보호 저장소 무재승인을 따로 검증한다.
- `db.js`는 immutable 캡처·mutable 세션·최근 목록 메타데이터를 분리한다. `editor-session.js`의 저장 큐와 flush를 우회하지 않는다. 종료·업데이트는 `desktop/lifecycle.cjs`의 같은 저장 응답을 기다린다.

- 0.45 문서 메타데이터는 0.46에서 통합 티켓 이름·휴지통/복구로 이전한다. 티켓 생성과 목표 확정을 구별하며 같은 ID의 목표 확정 시 이미지/요청/출처를 고정한다. 현재 편집 revision·티켓/상태 revision·goal_id를 구별하고 CAS/operation_id·원자 저장을 유지한다. 작업 복제는 새 ID의 독립 준비 중 티켓이며 목표/진행 기록을 승계하지 않는다.

- `ui/react/`는 안정된 셸과 목록 UI를 소유한다. `editor-runtime.js/css`는 생성물이며 직접 수정하지 않는다. 새 UI 명령은 `store.ts`/`commands.ts`에 연결하고 React 버튼의 disabled와 DOM 상태가 달라지지 않게 한다. 캡처 iframe은 엔진 소유이며 React 렌더마다 교체하지 않는다.
