# 개발 구조

제품 요구사항과 사용자 동작의 기준은 [PRD](PRD.md), 실제 확인 결과는 [검증 기록](verification.md)에서 관리한다. 아래는 현재 구현 구조이며 React·TypeScript·shadcn/ui 전환은 [개선 계획](https://github.com/kimyongin/console-canvas/issues/1) 단계다.

## 편집과 명령

- `capture.js`: 원본 DOM 읽기. 스크립트·입력 이벤트를 실행하지 않는다.
- `engine.js`: 정제된 복제 iframe, 요소 선택·레이어 표시·이동. `node-index.js`가 만든 계층과 하위 개수를 재사용한다.
- `edit-commands.js`: 순수한 작업 검증·적용 준비. 수동 편집과 MCP가 같은 경로를 사용하고, 잘못된 묶음은 전체가 거절된다. 이동·주석 길이 제한은 `edit-policy.json`에서 가져온다.
- `editor-session.js`: 체크포인트·공유 실행 취소·다시 실행·문서 저장·flush.
- `snapshot-history.js`: 과거와 미래를 유지하는 버전 목록. 복원 전 미저장 작업을 자동 보관한다.
- `editor-controller.js`: MCP 도구의 버전·대상·작업 검사와 공통 명령 연결.
- `editor.js`: 모듈 조립·문서 열기·입력 연결. 문서 전환을 직렬화하고 이전 문서를 먼저 저장한다.
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

`npm run check`는 포맷·빌드·Python·Node·Chromium·실제 데스크톱/공식 MCP SDK 순서로 실행한다. 데스크톱 검증은 임시 홈·프로필·포트에서 가상 NORTH만 가져오고, 정상 종료 뒤 같은 프로필을 다시 실행해 편집·초안·스냅샷·패널 너비를 확인한다. 설치된 사용자 앱의 데이터나 스킬에는 쓰지 않는다.


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
