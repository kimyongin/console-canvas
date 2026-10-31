# 개발 구조

> 2026-11-01: 이 문서는 이전/0.44 구현·조사의 근거입니다. 새 제품 범위와 제거·이전 계획은 [현재 PRD](PRD.md)·[티켓 추적표](ticket-review.md)를 따릅니다. 아래 FR/AC는 [0.44 PRD 기록](PRD-0.44-history.md)의 식별자이며 신규 범위로 다시 구현하지 않습니다.

0.25.0부터 내장 Chromium 앱만 공식 지원한다. Chrome 전용 소스는 archive/chrome-extension과 태그 v0.24.3에 보존하고 새 빌드 의존성에서 제외한다. 공통 배포물은 console-canvas-runtime.zip이다. [전환·검증 범위](desktop-only-0.25.md).


제품 요구사항과 사용자 동작의 기준은 [PRD](PRD.md), 실제 확인 결과는 [검증 기록](verification.md)에서 관리한다. 아래에는 버전별 구현 기록도 포함한다. 현재 실행 결과는 [검증 기록](verification.md), 전환 범위와 설치/직접 사용 잔여는 [개선 티켓](https://github.com/kimyongin/console-canvas/issues/1)과 검증 기록에서 구분한다.

## 실제 OS 인증 검증 환경 · 0.37

Electron 통합 검사는 OS HOME/CODEX_HOME을 다른 경로로 바꾸지 않는다. 사용자 홈 변경은 macOS Keychain 발견/초기화에 영향을 주므로, 프로필·브리지·스킬만 앱 전용 경로로 분리한다. `CONSOLE_CANVAS_SKILL_DIR`가 있으면 설치/자동 갱신은 그 한 경로만 조회하고 실제 사용자 설치를 검색하지 않는다. macOS 통합 검사는 실제 비동기 OS 암호화/복호화 성공을 요구한다. 일반 앱 동작과 평문 거절은 유지한다.

## ChatGPT 직접 호출 · 0.36

`desktop/chatgpt.cjs`는 공식 로컬 SIWC OAuth·계정/host·보호 저장·갱신·철회·모델/추론을 소유한다. editor mainFrame의 `chatgpt-ipc.cjs`만 접근하고 `preload.cjs`는 비밀 없는 결과만 노출한다. `chatgpt-provider.js`는 renderer의 직렬 생성/취소와 공통 후보 등록을 연결한다. 실제 토큰과 Responses 호출은 main에 남고 기존 `ai-provider.js`의 스키마/스트림 변환을 재사용한다. API 키 인증·외부 MCP 경로는 별개다. [설계·공식 근거·한계](chatgpt-oauth-0.36.md).

0.37.3은 OAuth bearer의 길이 검증을 API 키와 분리한다. Responses의 완료 객체에 output이 없어도 output_text 이벤트로 본문을 재구성하며 done으로 delta 중복을 제거한다. terminal response.completed 확인 전에는 후보를 등록하지 않고 중단된 스트림의 본문은 버린다. 실제 계정 호출에서 확인한 두 결함의 수정/회귀와 설치 검증은 [0.37 기록](deployment-0.37.md)을 따른다.

## 편집과 명령

0.35의 스냅샷 비교/이름 변경 복귀는 검색·미리보기 확대/선택·스크롤·초점을 같은 문서/세대에 한해 복원하며 다른 모달/삭제된 선택의 늦은 콜백을 거절한다. 문서 바로 검색의 전체 목록 진입은 열린 빠른 메뉴의 검색만 넘긴다. AI 추가 생성 설정은 `ui/ai-panel.js`의 문서/요청별 실행 중 Map에 보관하고 `ai-variants.tsx`가 새 요청의 영구 `aiDraft`와 분리해 표시한다. 기본값은 선택한 저장 요청이며 생성 시에만 기존 manager 계약으로 전달한다. UI 초안/복귀 상태는 DB·파일·MCP 계약을 확장하지 않는다. 전체 목표의 현재 기준은 [140개 매트릭스](scenario-matrix-0.35.md)다.

- `capture.js`: 원본 DOM 읽기. 스크립트·입력 이벤트를 실행하지 않는다.
- `engine.js`: 정제된 복제 iframe, 요소 선택·레이어 표시·이동. `node-index.js`가 만든 계층과 하위 개수를 재사용한다.
- `edit-commands.js`: 순수한 작업 검증·적용 준비. 수동 편집과 MCP가 같은 경로를 사용하고, 잘못된 묶음은 전체가 거절된다. 이동·주석 길이 제한은 `edit-policy.json`에서 가져온다.
- `editor-session.js`: 체크포인트·공유 실행 취소·다시 실행·문서 저장·flush.
- `snapshot-history.js`: 과거와 미래를 유지하는 버전 목록. 복원 전 미저장 작업을 자동 보관한다.
- `editor-controller.js`: MCP 도구의 버전·대상·작업 검사와 공통 명령 연결.
- `editor.js`: 모듈 조립·문서 열기·입력 연결. 문서 전환을 직렬화하고 이전 문서를 먼저 저장한다. 새 캡처 쓰기 성공 뒤 이전 세대를 무효화하고 모달을 닫아 지연된 복귀가 새 문서에 나타나지 않게 한다. 캡처 쓰기 실패는 현재 작업을 유지하며, 대기 중 추가 입력/편집이 있으면 이전 문서를 다시 저장한 뒤 전환한다.
- `ui/`: 패널 너비·접기, 캔버스 확대, 속성, 레이어·변경 목록, 스냅샷, 내보내기를 구분한다. CSS도 기본 화면·주석·스냅샷·워크스페이스로 나눈다.

## 저장

IndexedDB `console-canvas-workspace`의 세 저장소를 사용한다.

| 저장소 | 내용 | 쓰기 시점 |
| --- | --- | --- |
| captures | 원본 HTML·요소·스크린샷·출처 | 같은 캡처 ID당 최초 한 번 |
| sessions | 이동·삭제·주석·스냅샷 목록·추가 설명 | 편집 시 |
| documents | 제목·주소·날짜 | 최초 저장과 편집 시 |

`getDocument`만 원본과 편집 상태를 합친다. 최근 목록은 `updatedAt` 인덱스의 커서에서 필요한 개수만 읽고 큰 HTML이나 과거 스냅샷을 읽지 않는다. 세션과 최근 목록 갱신은 한 트랜잭션이다.

`save-queue.js`는 진행 중 쓰기와 문서별 최신 대기 상태를 유지한다. 같은 문서의 중간 요청은 합치지만 다른 문서를 버리지 않는다. 값은 큐에 넣을 때 복제한다. 실패한 문서는 같은 문서의 저장이 성공할 때까지 flush 실패로 보고한다.

0.7 저장소를 읽는 호환 계층이나 자동 마이그레이션은 없다. 이전 데이터는 지우지 않으며, 필요하면 이전 앱의 편집 파일을 가져온다.

## 데스크톱

- `desktop/main.cjs`: 앱 시작, 브라우저 뷰 구성, 화면 전환과 메뉴.
- `desktop/security.cjs`: 웹 주소 검사, 원본 팝업의 격리, 정확한 mainFrame IPC 검사.
- `desktop/ipc.cjs`: 신뢰한 셸의 명령 등록. 원본 웹사이트에는 제공하지 않는다.
- `desktop/capture.cjs`: 원본의 격리된 월드에서 읽기 전용 수집과 화면 이미지 생성.
- `desktop/skills.cjs`: 스킬 동기화·상태·MCP 등록 명령.
- `desktop/lifecycle.cjs`: 저장 요청·응답·제한 시간·마지막 문서 기록·종료 조정.
- `desktop/updater.cjs`: 다운로드·적용 진행. lifecycle의 같은 flush와 저장 후 종료를 사용한다.
- `desktop/layout.cjs`: 셸과 내장 뷰가 함께 사용하는 헤더 높이.

창 닫기와 앱 종료는 편집기의 flush 응답을 기다린다. 편집기는 주석 초안·추가 설명을 반영하고 저장 큐가 끝난 뒤 응답한다. 실패하면 창을 유지한다. 성공한 마지막 문서는 사용자 데이터 폴더의 `session.json`에 임시 파일과 rename으로 기록하며 재실행 때 연다. 업데이트도 같은 기록을 사용한다.

## 빌드와 검증

`package.json`이 버전의 기준이다. `scripts/build.py`가 esbuild로 실제 모듈 의존성과 CSS import를 번들링한다. 독립 HTML은 외부 스크립트·CSS 없이 실행된다. `runtime-manifest.json`에는 공개 파일과 런타임 SHA-256을 기록하며, MCP HTTP 서버는 공개 파일만 제공하고 스킬 prepare는 패키지 파일·체크섬을 검사한다. 스킬 ZIP은 앱 Resources에서 런타임 밖에 둔다.

`npm run check`는 TypeScript·포맷·빌드·Python·Node·Chromium 웹/공통 검사다. 내장 앱 경계와 로컬 MCP는 별도 `test:desktop:offscreen`/공식 SDK로 검사한다. 데스크톱 검증은 임시 홈·프로필·포트에서 가상 NORTH만 가져오고, 정상 종료 뒤 같은 프로필을 다시 실행해 편집·초안·스냅샷·패널 너비를 확인한다. 설치된 사용자 앱의 데이터나 스킬에는 쓰지 않는다.


문서의 사용자 지정 이름과 `deletedAt`은 `documents` 메타데이터에 저장한다. 세션 저장은 해당 레코드를 병합하며 휴지통에 있는 문서에는 쓰지 않는다. 문서 휴지통은 캡처·세션을 지우지 않고 기본 조회·최근 목록에서 제외한다. 활성 문서를 휴지통으로 옮기기 전 저장 큐를 flush하고 편집기를 닫아 MCP 화면 등록도 해제한다. 복구는 메타데이터만 바꾸며 다시 열 때 모든 편집과 버전을 읽는다.

스냅샷의 이름·`deletedAt`은 타임라인의 기존 엔트리에 기록한다. 부모 ID와 상태는 유지하며 기본 목록·탐색·비교·MCP 조회는 휴지통 항목을 제외한다. 활성 버전을 삭제하면 `activeId`를 비우고 현재 편집 상태는 유지한다. 실행 취소도 휴지통의 ID를 활성화하지 않는다. 파일 왕복은 휴지통을 포함한 타임라인을 보존한다. 휴지통 복구와 저장 버전 적용은 서로 다른 동작이다.

## 0.14 분기·주석·이미지 전달

- `snapshot-tree.js`는 parentId를 따라 저장 버전을 순회한다. 휴지통 조상은 살아 있는 후손의 연결에 필요한 경우에만 비활성 노드로 남긴다. 중앙 상단 popover와 이름 입력 dialog는 오른쪽 패널 상태와 독립적이다.
- `activity-history.js`는 `{id,parent_id,snapshot_id,created_at,actor,label,changes}` 이벤트를 추가하며 세션의 `activityHead`에서 현재 가지를 역순 조회한다. 스냅샷 체크포인트에는 head ID만 포함하고 전체 이벤트 배열은 세션에 한 번 보관한다. 과거 버전 복원이나 실행 취소가 다른 가지의 이벤트를 제거하지 않는다. 기존 세션에는 빈 이력을 추가하며 과거 시간 정보를 추정하지 않는다.
- `annotations`의 기존 요소 ID→문자열은 유지한다. `point:x:y` 키는 고정 문서 좌표 주석이다. 공통 명령 검증은 `point_comment`를 해당 키의 주석 변경으로 정규화한다. 좌표 주석에 이동·삭제 명령을 적용하지 않는다. 실행 취소·스냅샷·편집 파일·IndexedDB가 같은 annotation map을 사용한다.
- `ui/comment-editor.js`의 모달에서 같은 입력란을 사용한다. 선택된 요소 위의 editor-only 아이콘과 빈 곳 클릭의 좌표 아이콘이 진입점이다. 번호 배지로 재편집하며 원본 DOM 이벤트를 실행하지 않는다.
- `handoff-image.js`는 현재 결과의 변경·주석을 대상별로 묶고 화면 위에 같은 번호의 하이라이트를 그린다. 하단 카드는 두 열이며 글꼴 크기를 고정하고 높이를 늘린다. 삭제 전 참고·작은 영역 확대·추가 설명도 같은 PNG에 포함한다. 이미지 생성은 별도의 version scene에서 수행해 현재 선택·편집·이력을 변경하지 않는다.
- 데스크톱 `render-image.cjs`는 신뢰한 editor mainFrame의 IPC만 받는다. 임시 Chromium 세션에는 preload·Node·JavaScript가 없고 sandbox/contextIsolation/webSecurity를 유지한다. 페이지 스크립트는 실행하지 않으며 캡처 후 창과 임시 저장소를 정리한다. 브라우저·확장은 기존 SVG foreignObject 경로를 사용하므로 외부 리소스·폰트 표현에 차이가 생길 수 있다.
- MCP `get_review_image`는 같은 PNG를 image content block으로 반환한다. 읽기 도중 revision이 바뀌면 거절하고 편집 모달·드래그 중에는 busy를 반환한다. 이미지 응답만 별도 45초 기한·20MB PNG 한도를 적용하며 편집 요청의 기존 크기/시간 제한은 유지한다. `list_history`는 현재 가지 또는 모든 가지를 페이지로 반환한다.

## 0.15 그래프 탐색과 통합 이력

- `snapshot-graph.js`는 `snapshot-tree.js`의 유효한 조상을 따라 깊이와 줄을 배정한다. 가로 위치는 부모 깊이, 새 줄은 형제 분기다. SVG 선은 실제 부모 ID로만 연결한다. 저장 시각은 연결 판단에 사용하지 않는다. 삭제된 조상과 잘못된 순환은 트리 정제 단계에서 다룬다.
- `ui/snapshot-panel.js`의 미리보기 선택 `state.snapshotPreviewId`는 `timeline.activeId`와 별개다. 노드 선택은 현재 편집·revision·저장 버전을 바꾸지 않는다. 별도의 스크립트 없는 버전 장면을 아래 iframe에 표시하고 세대 토큰으로 늦게 도착한 이전 미리보기를 버린다. 이름 모달 저장 직후 그래프를 열며 명시적인 적용 버튼만 실제 버전을 복원한다.
- MCP `get_screen`은 `preview_snapshot_id`와 `active_snapshot_id`를 구분한다. `list_snapshots.parent_id`는 그래프와 같은 저장 부모다. 기존 MCP 편집·복원 경로와 저장 형식은 유지한다.
- 오른쪽은 탭 없는 변경 이력 하나다. `ui/activity-panel.js`가 배치·속성의 전후 값과 주석 내용·복사·삭제를 통합한다. 이전 작업의 저장된 주석은 시각을 만들지 않고 별도 보존 표시로 제공한다. 위치·정렬 입력은 도구 모음의 요소 편집 모달로 옮겼다. 패널의 너비·접힘 저장 키는 유지한다.

## 0.16 React UI와 오류 복구

- `ui/react/editor-shell.tsx`가 편집기 도구 모음·패널·모달의 안정된 마크업을 소유한다. `lists.tsx`와 `versions.tsx`가 레이어·문서·통합 이력·Git 그래프·버전 미리보기/비교·전달 이미지를 렌더링한다. DOM 복제 장면과 입력 값은 기존 엔진/컨트롤러가 관리한다. 전체 엔진을 TypeScript로 재작성하지 않았다.
- `store.ts`는 문서/세대/revision·선택·undo 개수·active/preview·저장 결과의 구독과 타입 있는 UI 명령을 제공한다. `useSyncExternalStore`의 snapshot은 publish 전까지 안정적이다. 드래그의 장면 DOM을 React로 다시 만들지 않는다. 버튼 활성화도 같은 구독을 사용해 DOM과 React 이벤트 상태를 일치시킨다.
- `mount.tsx`는 문서당 한 셸과 안정된 목록 host를 사용하고 해제 시 구독/루트를 정리한다. 기존 UI 직접 생성 루프와 `ui/action-menu.js`는 제거했다. `ui/*.js`의 기존 컨트롤러는 저장/선택/모달·입력/크기 변경을 조정하며 전체 화면 상태를 별도로 복제하지 않는다.
- shadcn Button/Input/Textarea/Badge 소스를 저장소에서 관리한다. NativeSelect·DialogSurface·ActionMenu와 기존 패널 리사이즈 로직은 브라우저 top layer와 저장된 너비 계약을 유지하는 로컬 어댑터다. 다른 포털 focus trap을 중첩하지 않는다. 원본 shadcn Dialog/Resizable를 그대로 도입한 것으로 표현하지 않는다. 출처·라이선스·갱신 기준은 `ui/react/SOURCES.md`다.
- Tailwind 4는 PostCSS로 정적 CSS를 만들고 preflight를 생략한다. 토큰은 `.cc-ui` 안에서 정의하고 복제 iframe에는 주입하지 않는다. esbuild는 React/JSX 런타임을 포함한 `editor-runtime.js/css`를 생성한다. 공개 목록은 실제 의존성에서 계산하되 node_modules 원문은 제외하고 번들/라이선스를 제공한다. 독립 HTML에는 같은 JS/CSS를 인라인한다.
- `document-input.js`는 캡처·편집/복사·주석·타임라인·이력의 사전 검증을 수행한다. 잘못된 파일은 현재 문서 flush/교체/DB 등록 전에 거절한다. 휴지통 문서도 saveCapture 전 거절한다.
- 편집 파일 저장은 안전 조건/초안 반영을 먼저 검사한다. DB flush만 실패하면 현재 메모리의 review JSON을 긴급 백업하고 DB 오류를 계속 표시한다. 다른 문서/설정/로그인 백업과 구분한다.
- UI 복원·휴지통 복구하고 적용·MCP 복원은 `restorePersisted`를 사용한다. 저장 중 사용자 입력을 잠시 막고 실패 시 장면·timeline·active/preview·revision·activity·undo/redo를 복구한 뒤 이전 상태를 다시 저장 큐에 넣는다. 오류는 숨기지 않는다. 성공 시에는 기존처럼 자동 보관과 이후/병렬 버전을 유지한다. 동기 `restore`는 엔진 수준 조립/회귀 검사 용도이고 사용자 복원 명령은 영구 저장 결과를 기다린다.
- PNG 저장기는 PNG 시그니처·이름/크기와 기존 IPC 프레임 경계를 검사하고 네이티브 PNG 필터·임시 파일/rename을 사용한다. 주석 완료 표시는 실제 flush를 기다린다.
- `npm run test:desktop:offscreen`은 잠금 환경에서 실제 DOM과 가상 NORTH 스크린샷을 사용한 별도 조건의 SDK/PNG 파일/종료·재실행 검사다. 표준 화면 캡처 검사나 설치 창 직접 조작을 대체했다고 보고하지 않는다.

개발용 `ui/react/contracts.ts`는 snapshot·이력·MCP 결과·editor preload의 타입 진입점이다. 전역 Window 선언은 TypeScript UI에서 사용하며 배포 런타임에 추가 코드를 만들지 않는다. JS/IPC/MCP의 런타임 검증을 대체하지 않는다.

## Chrome WebMCP · 0.20 과거 기록 (0.25 지원 종료)

`tool-contract.json`은 19개 도구 스키마·읽기/쓰기 annotations·계약 버전의 공통 원본이다. `tool-contract.js`와 `mcp/server.py`가 `edit-policy.json`의 한도를 해석한다. `archive/chrome-extension/webmcp-client.js`는 명시적으로 공개한 문서의 native `document.modelContext` 등록/철회·직렬 실행·최근 200개 성공 operation_id 결과만 담당한다. 편집·저장·실행 취소·분기는 기존 `editor-controller.js`와 세션/엔진에 위임한다. Electron IPC와 Python 브리지는 Chrome 실행 경로의 의존성이 아니다.

가이드는 빌드된 동일 SKILL.md를 반환한다. 이미지 생성은 native 실행 반환 뒤 별도 작업으로 시작하고 같은 인수의 재조회로 결과를 전달한다. 로컬 blob 미리보기는 `review-image.html`에서만 로드하고 5분 또는 도구 철회 시 해제한다. 공식 Chrome MCP의 `new_page`→`take_screenshot(fullPage:true)`가 실제 MCP 이미지 콘텐츠를 반환한다. 상세 계약·실패 정책은 [Chrome 안내](chrome-webmcp.md), 실행 증빙은 [0.20](webmcp-0.20.md)에 있다.

## 개발 전달·구현 검토 · 0.22

`design-intent.js`는 이동 후 주변 영역/삭제 후 형제에 근거한 문장과 반응형 정형 문구를 제안한다. 사용자가 선택한 문구는 기존 annotations로 저장한다. `handoff-image.js`는 전달 정책·버전/경로/너비 맥락을 PNG에 그리며, 후속 요청 필터가 원래 번호를 유지한다.

`workflow-state.js`는 `handoffSettings`와 `implementationReviews`를 검증한다. immutable 원본 캡처에 넣지 않고 기존 세션 저장 큐와 편집 파일에 포함한다. 구현 검토의 고정 목표 point와 별도 결과 캡처/point·요청별 판정/메모는 캔버스 undo/분기와 독립적이다. `ui/implementation-review.js`가 저장/별도 버전 장면 렌더를 조정하고 React UI는 두 장면·공통 확대·검토 상태를 표시한다. 원본 ID/selector 대응은 유일할 때만 추정 하이라이트로 표시한다. 원본 소스 편집과 자동 판정은 수행하지 않는다. [흐름·한도·검증](developer-workflow-0.22.md).

## AI 시안 · 0.21

`code-patches.js`가 inert DOM에서 선언적 HTML/CSS를 검증하고 `CanvasScene.setCodePatches`가 같은 iframe 안에 복원한다. immutable 캡처와 `codePatches`를 분리하며 session/checkpoint/timeline/JSON/비교/PNG가 같은 포인트를 사용한다. 생성 요소는 a… ID, 캡처/복사 ID·locator와 주석 참조는 유지한다. 코드 레이아웃 뒤에 기존 이동 오프셋을 적용한다.

`ai-requests.js`가 frozen baseline과 독립 후보·상태를 세션에 보관한다. 요청/등록은 캔버스 revision/undo를 바꾸지 않는다. 사용자 선택 때 기준/후보를 형제 스냅샷으로 등록하고 `restorePersisted`로 현재 작업 보호와 한 undo 단계를 공유한다. 재생성은 기준 요청/선택 후보의 계보를 참조한다.

React 갤러리와 `ai-provider.js`는 MCP와 같은 후보 등록 경로를 사용한다. API 키는 제공자 closure의 메모리만 사용한다. Responses API의 완료된 strict JSON 패치만 등록하고 불완전 스트림은 적용하지 않는다. API UI 테스트는 별도 test-only fetch transport이며 배포 번들에는 포함하지 않는다. 실제 OAuth/추론·자동 보정 루프는 후속이다.

Python `mcp/modern.py`는 2026-07-28 발견·요청별 메타데이터·결과/캐시 메타데이터·명시적 AI 요청 리소스와 구독/취소를 처리한다. `server.py`의 legacy initialize 경로와 분리한다. 브리지는 화면 세대와 request_revision을 검증하며 알림은 공개 화면에만 제공한다. SDK v2는 개발 검사 의존성이고 배포 Python에 외부 패키지를 요구하지 않는다.

## 가져오기 품질 · 0.24

`capture.js`는 DOM/스타일/원본 식별자·프레임/Shadow 경로를 읽는 공통 수집기다. `desktop/capture-view.cjs`는 지연 로딩 준비 스크롤·복원, `desktop/capture-cdp.cjs`는 각 프레임의 독립 격리 문맥·정확한 소유 iframe 연결·기존 페이지 리소스 내장·원본 타일 촬영을 담당한다. 동일 세션의 리소스 트리에서도 해당 frame.id의 자원을 찾아 다른 프레임 자원을 반복하지 않는다. 폰트 캐시가 비어 있으면 이미 관측한 리소스만 검사기 로더로 읽고 스트림을 닫는다.

`chrome-capture.js`는 허용된 프레임의 DOM 수집·병합과 활성 탭 촬영을 조정한다. 스크롤 이후 지연 DOM을 다시 수집하므로 원본 하단과 편집 트리의 시점 차이를 줄인다. `capture-assets.js`는 기존 권한 안에서 쿠키 없는 공개 CORS fetch만 수행한다. 보안 격리와 host permissions를 넓히지 않는다. 프레임 신원이 모호하면 추정 병합하지 않는다.

`capture-media.js`는 문서에 내장된 원본 타일만으로 실패한 IMG/래스터 영역을 자른다. 픽셀 합집합으로 full/partial/unavailable을 판단하고 부분을 전체로 늘리지 않는다. immutable capture v1의 추가 선택 필드이며 세션 저장 구조·타임라인 부모 관계는 바꾸지 않았다. MCP 요소 조회는 선택적인 image/coverage/raster_reason을 제공하고 기존 19개 도구와 revision/operation_id 계약을 유지한다. [범위·수치](capture-quality-0.24.md).

## 가져오기 상태 · 0.25

capture-status.js가 저장된 경고·프레임 정보와 scene의 이미지/배경/raster coverage를 읽어 불변 평가한다. UI의 가져오기 정보와 get_screen.capture_status는 같은 평가를 사용한다. 시각 일치율을 계산하거나 상태 변경/저장을 수행하지 않는다. 대상 선택은 기존 선택/확대 명령을 사용한다.

## 비교·범위·자산 복구 · 0.26

`capture-reference.js`는 저장된 사진 타일의 합집합 촬영 면적과 미촬영 해칭을 만든다. `ui/source-comparison.js`는 고정한 현재 작업과 편집 전 복제본을 독립 장면으로 렌더하며 원본 사진과 구별한다. 일치 점수를 추정하지 않는다. `capture-status.js`가 수집 손실/개별 편집 제약/참고를 분류한다.

`desktop/capture.cjs`는 범위를 읽기 검증하고 현재 화면/영역의 준비 스크롤을 생략한다. 영역 선택은 shell의 원본 PNG 위에서 동작하며 원본 DOM에 오버레이를 삽입하지 않는다. `capture-scope.js`와 엔진은 원본 좌표/레이아웃을 보존하며 범위 밖의 편집 요소를 숨기고 표시/미리보기/전달만 자른다. 주변 HTML은 보존되어 보안 삭제가 아니다. `capture-scroll.js`는 inert 직렬화 복제본의 내부 스크롤 복원을 공통 처리한다.

`desktop/repair-resources.cjs`는 신뢰한 편집기 mainFrame의 명시 요청만 받아 관측 자산을 쿠키 없이 제한적으로 읽고 바이너리 형식을 확인한다. `resource-repair.js`는 관측 참조와 inert data URI만 허용한다. `code-patches.js`의 resource는 기존 checkpoint/session/timeline/JSON에 포함된다. UI는 독립 장면 미리보기·문서/리비전/세대 검증 후 기존 historyBefore/changeCommitted로 한 번만 적용한다. 원본 HTML/사진은 바꾸지 않으며 MCP resource는 네트워크를 호출하지 않는다.

0.32의 검토 기록은 선택적 name/deletedAt을 추가하고 같은 세션 큐로 관리한다. 활성20개/전체40개/문자20,000,000 한도는 workflow-state.js에서 검증한다. ui/react/review-records.tsx는 기존 모달의 하위 화면이며 영구 삭제는 대상 내용 지문과 별도 확인을 거친다. 복구만으로 선택/캔버스를 적용하지 않는다. 전체 편집 파일 백업은 DB 오류 때도 메모리의 보호된 상태를 내보낸다. 전달 확대/넓게 보기/스크롤은 ui/export-dialog.js의 비영구 보기 상태로 PNG 렌더·문서 데이터와 분리한다. [0.32 증빙](ux-0.32.md).

0.33의 구현 비교 반응형 규칙은 ui/react/theme.css의 단일 max850 구간이 소유한다. 공유 VersionFrame은 호스트/원본 표시 너비와 라벨 실측 너비로 텍스트만 안쪽에 배치하고, 선택 요청 이동은 테두리와 라벨의 경계를 함께 사용한다. ui/implementation-review.js의 일시적 targets는 종류/태그/텍스트 인덱스/숨김을 포함하며 고정 목표와 결과를 읽기 대조한다. 실제 중복/부재는 명시하고 임의 위치 대응을 만들지 않는다. 새 검토 저장 필드나 네이티브/MCP 명령은 없다. 저장 부모·통합 이력·검색의 버전 명칭은 기존 snapshotVersionName으로 계산하고 기존 ID/부모를 유지한다. [0.33 증빙](ux-0.33.md).

0.34 작업 복귀는 ui/export-dialog.js와 ui/implementation-review.js의 비영구 origin 콜백이다. 문서 ID/세대·전달 버전의 상태 서명/정책·해당 열기 순서를 재검증한 뒤 현재 작업 저장을 기다려 복귀한다. 전체 닫기는 콜백을 해제하며 파일/세션/MCP에 직렬화하지 않는다. 스냅샷 전달은 adapter의 snapshot-handoff/handoff-back과 선택 ID를 사용하고 그래프 복귀는 기존 위치/검색을 복원한다. 기존 복구와 명시적 복구하고 열기는 같은 저장 경로를 쓰며 후자만 성공 후 선택한다. 원본/네이티브/MCP 계약은 유지한다.137개 감사 데이터와 Markdown 매트릭스는 tests/test_scenario_audit.py로 ID/참조/액션 경계를 대조한다.
