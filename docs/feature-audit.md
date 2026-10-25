# 기능 전수 조사와 PRD 대조

조사일 2026-10-25 · 코드 기준 0.15.0 / 6756a95 · 대상 [PRD](PRD.md)

## 조사 방법과 경계

편집기 HTML의 조작 정의 90개와 앱 셸 22개, 합계 **112개 정적 정의**를 추출해 아래 부록에서 모두 분류했다. 버튼뿐 아니라 링크·입력·선택·접기 summary·너비 separator·숨겨진 입력/잔존 DOM을 포함한 수이며 112개 독립 기능이나 직접 클릭 통과 수가 아니다.

이에 더해 JS가 생성하는 레이어/주석/문서/스냅샷 항목, 포인터·단축키, 네이티브 메뉴, 저장/복구, 13개 MCP 도구와 스킬 CLI, Chrome 확장 진입점, 설치/업데이트 경로를 조사했다. 코드에서 실행/입력→명령→저장/출력 경로를 읽고 기존 검사와 연결했다. CSS는 노출/접기/반응형 및 남은 구형 UI 규칙의 적용 범위로 검토했다.

특히 오류 정책은 가상 NORTH·임시 프로필의 Chromium과 실제 저장 함수에 잘못된 파일/DB 오류를 주입해 확인했다. 사용자 자료와 설치 앱은 이 재현에 사용하지 않았다. 현재 실제 사이트/잠긴 설치 창의 모든 포인터 동작을 새로 전수 실행한 것은 아니다. 코드/기존 검사 근거와 이번 직접 재현을 구별한다.

## 결론과 PRD 보완

초기 PRD는 주요 방향을 담았지만 기능 누락과 구현 상태의 과장이 있었다. 제품의 의도는 유지하고 아래 내용을 보완했다.

| 분류 | 발견 | 반영 |
| --- | --- | --- |
| 빠진 기능 | 두 화면의 버전을 자유롭게 선택하는 비교 모달과 차이 요약 | FR-15, AC-15 추가 |
| 빠진 경로 | 파일 드롭·지원 JSON 형식·한 문서 백업·helper의 ZIP 처리 차이 | FR-16/17, AC-17 추가 |
| 불충분한 편집 명세 | 주요 요소 필터·상위 선택·정렬/간격·스냅·이동 단위·클립보드 대체 | FR-03/04 보완 |
| 상태 수명 | 영구 이력과 달리 undo/redo는 메모리, 실행 취소 최근 100개·문서 재열기 때 초기화 | FR-04, AC-16 보완 및 실제 재현 |
| 경로별 차이 | 데스크톱/확장의 스크린샷 필수 여부·비밀번호 값·리소스/Shadow 처리·PNG 크기 제한 | FR-01, 7절 보완 |
| MCP 계약 | 조회 범위·직계 자식·미지원 쓰기·메모리 적용과 persisted 구별·재시도 캐시 수명 | FR-12 보완 |
| 제품 상태 오류 | PNG 생성/SDK 응답 성공으로 데스크톱 파일 저장까지 구현됐다고 묶어 표현 | FR-10과 9절 상태 정정, #8 |
| 미충족 품질 요구 | 잘못된 파일 거절·DB 실패 때 백업/복원 정책을 실제 구현과 구별하지 못함 | 9.1절 열린 결함 #9~#11과 AC-17/18 |

## 재현한 결함

| ID / 우선순위 | 실행과 실제 결과 | 요구 결과 | 코드 근거 |
| --- | --- | --- | --- |
| [#8](https://github.com/kimyongin/console-canvas/issues/8) / P1 | PNG 파일명+ArrayBuffer를 네이티브 저장 함수에 전달하면 대화상자 전 거절. 같은 조건에서 JSON은 대화상자/취소까지 진행 | 전달 버튼의 PNG 실제 저장 지원 | [export-dialog.js](../ui/export-dialog.js) → [export.js](../export.js)의 download → [files.cjs](../desktop/files.cjs)의 json/zip 파일명 검사 |
| [#9](https://github.com/kimyongin/console-canvas/issues/9) / P1 | 새 ID의 정상 캡처+잘못된 timeline.version을 importFile에 전달. 오류는 나지만 새 메타데이터가 남고 이전 활성 화면은 해제됨. 이전 문서 DB는 남음 | 파일 전체 검증 후 교체하거나 실패 시 UI/DB 롤백 | [editor.js](../editor.js)의 openDocument/saveCapture 순서와 [snapshot-history.js](../snapshot-history.js)의 initialise |
| [#10](https://github.com/kimyongin/console-canvas/issues/10) / P1 | DB readwrite에 QuotaExceededError를 주입하고 편집 파일 저장 클릭. 공통 flush가 실패해 download 호출 0회 | 메모리에 남은 작업의 긴급 파일 백업 가능 | [editor-session.js](../editor-session.js)의 오류 안내와 [export-dialog.js](../ui/export-dialog.js)의 flush 선행 |
| [#11](https://github.com/kimyongin/console-canvas/issues/11) / P2 | X=24 스냅샷·X=48 현재 작업에서 DB 쓰기를 실패시키고 X=24 적용. 오류 안내 뒤에도 메모리 X=24·기준 버전이 유지되고 X=48 자동 보관은 메모리에만 추가 | 이동 전 내구성 보호 또는 실패 시 일관된 원상 복구 | [snapshot-history.js](../snapshot-history.js)의 restore → [snapshot-panel.js](../ui/snapshot-panel.js)의 flush |

추가로 문서 재열기 전 undo 3개가 재열기 후 0개이며 영구 activity 3개와 저장 스냅샷은 남는 것을 확인했다. 이것은 현재 수명 정책을 문서에 보완한 것이며 undo 영구 복원을 새 기능으로 승인한 것은 아니다.

재현 스크립트/원시 결과는 Git에서 제외한 `local/prd-audit-2026-10-25/probes.cjs`, `probe-results.json`, `probes.log`에 있다. 테스트에서 주입한 오류를 실제 사용자 프로필의 오류나 데이터 손실로 보고하지 않는다. **네 결함은 발견/등록 상태이며 코드 수정 완료가 아니다.**

## 기능별 코드·검사 대응

표의 검사 파일은 관련 검사의 위치다. 각 행의 모든 예외가 그 파일에서 자동 검증된다는 뜻은 아니다. 이번 새 재현은 위 절에서 명시했다.

| 영역 | 조사한 동작 | PRD | 구현 근거 | 관련 검사/남은 확인 |
| --- | --- | --- | --- | --- |
| 접속 | 주소 정규화·HTTP(S) 검사·뒤로/앞으로·새로고침·샘플 | FR-01 | desktop/ipc.cjs, security.cjs | desktop-fixture, unit/lifecycle |
| 로그인 | 독립 세션·격리 팝업·웹사이트 권한 기본 거절 | FR-01, NFR-02 | desktop/main.cjs, security.cjs | 기본 격리 검사. 실제 사이트 SSO는 사이트별 미검증 |
| 가져오기 | 원본 격리 월드·버튼 busy·실패 복구 | FR-01 | desktop/capture.cjs, main.cjs, shell.cjs | desktop-fixture. 잠금 표면 실패 잔여 |
| 캡처 내용 | HTML/계산 스타일·텍스트/의사 요소·입력/체크/선택·스크롤 | FR-01 | capture.js | integration |
| 캡처 리소스 | 읽을 수 있는 이미지/폰트·개수/시간/크기 한도·경고 | FR-01 | capture.js | integration. 실제 인증 리소스 별도 |
| 특수 영역 | SVG 단일 아이콘·Canvas/Video/iframe 래스터·open Shadow 펼침·closed 한계 | FR-01 | capture.js, engine.js:rasterFallbacks | integration. 임의 특수 사이트 보장 없음 |
| 정보 보호 | password 값/hidden input 제외·이벤트/스크립트 제거 | FR-01, NFR-02 | capture.js, engine.js:sanitizeHtml | integration. 전체 이미지 자동 마스킹은 없음 |
| 앱 구조 | 웹사이트/편집기·주소창 숨김·앱 설정·작업 복귀 | FR-02 | desktop/shell.*, layout.cjs, editor.js | desktop-fixture, panels |
| 패널 | 상단 접기·세로 바 펼치기·너비/키보드·저장·작은 창 예산 | FR-02 | ui/workspace-layout.js | panels, graphflow |
| 레이어 | 트리 펼침·검색과 조상·주요 요소·삭제/주석/변경 표시 | FR-03 | ui/document-lists.js, element-labels.js | ux, placement |
| 선택 | 일반/Alt/Shift/Cmd·상위 경로·최대 100개 | FR-03 | engine.js:targetId/select, inspector.js | ux, selection |
| 영역 | 빈 곳 포인터·완전 포함·추가 선택·취소/스크롤 경계 | FR-03 | ui/area-selection.js | selection, browser-runner native-area |
| 보기 | 줌 10~250%·버튼/비율/휠·맞춤·선택 맞춤 | FR-03 | ui/canvas-viewport.js, editor.js | panels, ux |
| 이동 | 개별/그룹 손잡이·자식 중복 방지·드래그 취소 | FR-04 | engine.js, selection-tools.js | ux, selection, integration |
| 속성 | X/Y 오프셋·키/방향 버튼·좌표 한도 | FR-04 | editor.js, edit-commands.js | commands, panels, graphflow |
| 정렬 | 좌/위/중앙·3개 이상 간격·Alt 스냅 해제 | FR-04 | selection-tools.js, engine.js | unit/selection, ux |
| 삭제 | 그룹/부모 삭제·자식 영향·빈자리 유지·되돌리기 | FR-04 | engine.js, editor.js | integration, placement |
| 복사 | 내부 트리/주석·copiedFrom·중복 DOM ID 정리·동일 문서 확인 | FR-04 | copy-model.js, engine.js, ui/clipboard.js | selection, unit/copy-model |
| 실행 취소 | 키/버튼/메뉴·작업 묶음·redo 취소·세션 수명 | FR-04 | editor-session.js, desktop/main.cjs | commands/ux, 이번 재열기 재현 |
| 주석 | 요소 아이콘·좌표 아이콘·모달·번호·수정/삭제·650ms 입력 큐 | FR-05 | ui/comment-editor.js, engine.js | evolution, ux. 성공 메시지의 내구성/IME는 추가 확인 필요 |
| 문서 | 검색/전환·최근 4개·사용자 이름·원본 URL/뷰 복귀 | FR-06/17 | document-switcher.js, db.js, editor.js | storage, placement |
| 문서 휴지통 | 저장 뒤 닫기/연결 해제·복구·복구하고 열기·되돌리기 | FR-06 | document-switcher.js, db.js | trash, desktop-fixture |
| 버전 저장 | 이름 모달·초기/수동/자동·부모·한도·즉시 그래프 | FR-07 | snapshot-history.js, snapshot-panel.js | snapshots, graphflow |
| 버전 이동 | 미저장 자동 보관·미래/병렬·실행 취소 | FR-07 | snapshot-history.js | snapshots, graphflow. 저장 오류 #11 |
| 버전 관리 | 이름·삭제/현재 해제·후손 보존·복구/적용 | FR-07 | snapshot-panel.js, snapshot-tree.js | trash, branch-history |
| 그래프 | 깊이/줄·SVG 실부모 연결·가로 스크롤·휴지통 조상 | FR-08 | snapshot-graph.js, snapshot-panel.js, CSS | graphflow, evolution |
| 미리보기 | 선택 이름·비파괴·하단 iframe·세대 취소·명시적 적용 | FR-08 | snapshot-panel.js, version-preview.js | graphflow. 설치 창 직접 조작 잔여 |
| 이력 | 전후 값·주석·행위자·가지·필터/검색·대상 열기 | FR-09 | activity-history.js, activity-panel.js | evolution, graphflow, branch-history |
| 전달 | 원본/현재/저장 기준·현재만 설명 입력·이미지 미리보기 | FR-10 | ui/export-dialog.js, version-preview.js | evolution. 최신 설치 창 직접 조작 잔여 |
| 이미지 합성 | 번호 대응·주석 우선 카드·삭제 전/작은 영역 참고·두 열/높이 | FR-10 | handoff-image.js, engine.js:serialize | evolution, SDK |
| 이미지 출력 | 클립보드 PNG·비지원 안내·브라우저 다운로드·네이티브 파일 | FR-10 | export-dialog.js, export.js, desktop/files.cjs | SDK는 생성 검증. 네이티브 저장 #8 이번 재현 |
| 영구 저장 | 캡처 불변·세션/메타데이터 분리·직렬 큐·flush | FR-11 | db.js, save-queue.js, editor-session.js | storage, unit/save-queue |
| 종료 | 초안/설명 flush·실패 시 종료 거부·마지막 문서 | FR-11 | desktop/lifecycle.cjs | unit/lifecycle, desktop-fixture |
| 비교 | 양쪽 원본/현재/저장 선택·개수/설명 차이·비파괴 | FR-15 | ui/version-preview.js | ux, snapshots |
| 파일 열기 | JSON 형식·85MB·드롭·같은 ID/휴지통·오류 | FR-16 | editor.js:importFile/openDocument | storage/trash. 잘못된 timeline #9 이번 재현 |
| 파일 저장 | 한 문서 JSON·전체 버전/이력·취소/원자 저장 | FR-16 | export.js:reviewPayload, export-dialog.js, desktop/files.cjs | unit/files, snapshots. DB 오류 백업 #10 이번 재현 |
| MCP 수송 | stdio·인증된 HTTP·Origin/Host·명령 기한·재시도/만료 | FR-12 | mcp/server.py, bridge.py, bridge-client.js | test_mcp, 실제 SDK |
| 스킬 제공 | 상태/설치·ZIP·MCP 명령 복사·개인 파일/롤백 | FR-13 | desktop/skills.cjs, mcp/skill_install.py | test_app_skill, desktop-fixture |
| 앱 업데이트 | 후보·다운로드/검증·진행/오류·flush·교체/롤백/재실행 | FR-14 | updater.cjs, app_update.py | unit/updater, test_app_update, 과거 실제 버튼 기록 |
| 설치 | 공식 Electron 체크섬·app/DMG/ZIP·동일 앱만 교체 | FR-14 | scripts/build_desktop.py, build_dmg.py, install_desktop.py | 빌드 기록. Developer ID/공증은 없음 |
| 네이티브 메뉴 | 정보/종료·update·편집·개발 도구/전체 화면 | FR-04/14 | desktop/main.cjs | desktop-fixture 일부. 모든 OS 역할의 수동 전수 확인은 아님 |
| 확장 | 버튼·HTTP(S)·탭 스크린샷·배지·새 편집기/오류 탭 | FR-17 | background.js, manifest.json | 모듈/샘플 검사. 개인 Chrome 권한 경계 잔여 |
| 독립 HTML | 내장 샘플·오프라인 번들·최근/파일/수동 MCP | FR-17 | scripts/build.py, editor.js | browser-runner standalone |
| 스킬 CLI | prepare/review/mcp·새 출력 폴더·체크섬·ZIP 안전 처리 | FR-17 | skills/console-canvas/scripts/console_canvas.py | test_skill |
| 구형 내부 helper | buildReview의 ZIP/HTML/changes·구형 숨은 popover | FR-17 | export.js, editor.html | integration 일부. 현재 전달 메뉴 기능으로 세지 않음 |

## MCP 도구별 경계

정의는 [mcp/server.py](../mcp/server.py), 적용은 [editor-controller.js](../editor-controller.js)다.

| 도구 | 범위/주의 |
| --- | --- |
| get_agent_guide | 화면 없이 번들 지침 읽기. 스킬 설치 아님 |
| list_screens | 최근 poll이 있는 명시적 연결 복제본. 원본 탭 탐색 아님 |
| get_screen | revision·busy·undo/redo 수·실제/미리보기 버전·dirty |
| list_elements | 텍스트/태그/ID/locator 검색·직계 parent 필터·삭제 상태·페이지 |
| list_comments | 요소/좌표·번호·삭제 대상 상태·페이지 |
| list_history | 현재 head 선행 가지 또는 모든 이벤트·페이지 |
| get_review_image | 현재 또는 저장 버전 PNG·busy/변경 중 거절·최대 20MiB |
| apply_edits | move/delete/comment/point_comment만, 최대 100개. copy/문서 관리 없음 |
| undo | 현재 메모리 스택, 최신 revision 필요 |
| redo | 현재 메모리 스택, 최신 revision 필요 |
| list_snapshots | 휴지통 제외·부모/현재/dirty·페이지 |
| create_snapshot | 버전 생성. UI 이름 모달 저장과 달리 그래프 자동 열기까지 호출하지 않음 |
| restore_snapshot | 자동 보관 후 적용. 정상 성공과 persisted 실패를 구별, #11 미충족 |

쓰기 응답의 ok는 메모리 적용 결과이며 저장 실패는 persisted:false/save_error로 전달될 수 있다. 목록의 기본 페이지는 50개, 요청 최대는 200개다. 브리지는 최근 명령 1,000개 한도의 메모리 캐시를 사용하며 프로세스 재시작 후까지 operation ID를 영구 보존하지 않는다. 이 기능은 연결 화면의 실행 취소·분기 상태와 공유된다.

## 아직 재검증하지 못한 영역

- 최신 설치 창에서 주석·분기·미래 이동·PNG 클립보드와 실제 저장을 모두 마우스로 사용하는 흐름 및 설치 앱 활성 화면 MCP 조회.
- 개인 Chrome 확장의 실제 설치/권한 경계, 임의 사이트의 로그인/SSO·외부 인증 리소스·특수 DOM 재현.
- 한글 IME 중 단축키/암묵적 폼 제출, 모든 모달의 포커스 복귀, 주석 입력의 저장 성공 안내와 실제 DB 완료 시점. 현재 코드만으로 NFR-03 전체 통과를 주장하지 않는다.
- 오른쪽 너비 조절기의 aria-label/title에는 구형 **속성** 명칭이 남아 있다. 시각 패널명은 변경 이력이며 #5의 접근성 이름/구형 DOM 정리에 함께 확인한다.
- 성능의 수치 SLA와 최대 규모의 사용자 체감 측정, 일반 배포용 서명/공증과 다른 OS/아키텍처.

기존 정상 회귀 검사는 발견한 오류 경로의 검증을 대신하지 않는다. 열린 결함과 위 잔여 항목을 해결/확인한 뒤 PRD 상태와 이슈를 갱신한다.

## 정적 조작 정의 전수 분류

아래 표는 HTML 정의 112개의 누락 여부를 확인하기 위한 목록이다. 동적으로 생성되는 버튼은 위 기능별 표에 별도 기록했다. 동일 클래스의 닫기 버튼이나 동일 동작의 다른 진입점도 정적 정의 수에는 각각 포함한다.

<!-- CONTROLS: generated from the two checked-in HTML entrypoints; not a runtime test result. -->

E는 editor.html, S는 desktop/shell.html의 소스 순서다. 연결 구현은 저장소 루트 기준의 상대 경로다.

| 정의 | 조작/선택자 | PRD | 연결 구현 |
| --- | --- | --- | --- |
| E-01 | `a.brand (시작 링크, 앱에서는 숨김)` | FR-17 | editor.js |
| E-02 | `#snapshots-button` | FR-07 | ui/snapshot-panel.js |
| E-03 | `#export-button` | FR-10 | ui/export-dialog.js |
| E-04 | `#layer-search` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-05 | `#major-layers` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-06 | `#toggle-layers` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-07 | `#resize-layers` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-08 | `#resize-properties` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-09 | `#document-menu-button` | FR-06 | ui/document-switcher.js / editor.js |
| E-10 | `#documents-button` | FR-06 | ui/document-switcher.js / editor.js |
| E-11 | `#rename-current` | FR-06 | ui/document-switcher.js / editor.js |
| E-12 | `#import-button` | FR-16 | editor.js / ui/export-dialog.js |
| E-13 | `#save-document` | FR-16 | editor.js / ui/export-dialog.js |
| E-14 | `summary (원본 정보)` | FR-06 | ui/document-switcher.js / editor.js |
| E-15 | `#source-url` | FR-06 | ui/document-switcher.js / editor.js |
| E-16 | `#recapture-button` | FR-06 | ui/document-switcher.js / editor.js |
| E-17 | `#documents-trash-button` | FR-06 | ui/document-switcher.js / editor.js |
| E-18 | `#trash-current` | FR-06 | ui/document-switcher.js / editor.js |
| E-19 | `#undo` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-20 | `#redo` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-21 | `#edit-properties` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-22 | `#copy` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-23 | `#paste` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-24 | `#delete` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-25 | `#zoom-out` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-26 | `#zoom` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-27 | `#zoom-in` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-28 | `#fit` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-29 | `#zoom-selection` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-30 | `#snapshot-dropdown` | FR-08 | ui/snapshot-panel.js |
| E-31 | `#sample-button` | FR-17 | editor.js |
| E-32 | `#welcome-import` | FR-16 | editor.js / ui/export-dialog.js |
| E-33 | `#installation-button` | FR-17 | editor.js |
| E-34 | `#mcp-button` | FR-12 | editor.js / bridge-client.js |
| E-35 | `#activity-scope` | FR-09 | ui/activity-panel.js |
| E-36 | `#activity-filter` | FR-09 | ui/activity-panel.js |
| E-37 | `#activity-search` | FR-09 | ui/activity-panel.js |
| E-38 | `#toggle-properties` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-39 | `#close-snapshots` | FR-08 | ui/snapshot-panel.js |
| E-40 | `#snapshots-live` | FR-07 | ui/snapshot-panel.js |
| E-41 | `#snapshots-trash` | FR-07 | ui/snapshot-panel.js |
| E-42 | `#compare-button` | FR-15 | ui/version-preview.js |
| E-43 | `#apply-snapshot` | FR-08 | ui/snapshot-panel.js |
| E-44 | `#close-properties` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-45 | `#select-parent` | FR-03 | ui/document-lists.js / ui/canvas-viewport.js / ui/inspector.js |
| E-46 | `data-align=left` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-47 | `data-align=top` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-48 | `data-align=center-x` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-49 | `data-align=center-y` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-50 | `data-align=distribute-x` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-51 | `data-align=distribute-y` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-52 | `#snap-enabled` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-53 | `#offset-x` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-54 | `#offset-y` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-55 | `data-nudge=left` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-56 | `data-nudge=up` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-57 | `data-nudge=down` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-58 | `data-nudge=right` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-59 | `#inspector-delete` | FR-04 | editor.js / engine.js / ui/clipboard.js |
| E-60 | `#edit-selected-comment` | FR-05 | ui/comment-editor.js / editor.js |
| E-61 | `#capture-notes-title` | FR-01 | capture.js / desktop/ipc.cjs |
| E-62 | `#snapshot-name` | FR-07 | ui/snapshot-panel.js |
| E-63 | `#save-snapshot` | FR-07 | ui/snapshot-panel.js |
| E-64 | `#cancel-snapshot` | FR-07 | ui/snapshot-panel.js |
| E-65 | `#close-comment-dialog` | FR-05 | ui/comment-editor.js / editor.js |
| E-66 | `#component-comment` | FR-05 | ui/comment-editor.js / editor.js |
| E-67 | `#clear-comment` | FR-05 | ui/comment-editor.js / editor.js |
| E-68 | `#save-comment` | FR-05 | ui/comment-editor.js / editor.js |
| E-69 | `#rename-name` | FR-06/07 | ui/rename-dialog.js |
| E-70 | `#rename-cancel` | FR-06/07 | ui/rename-dialog.js |
| E-71 | `#rename-save` | FR-06/07 | ui/rename-dialog.js |
| E-72 | `button.dialog-close (form method=dialog)` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-73 | `#documents-live` | FR-06 | ui/document-switcher.js / editor.js |
| E-74 | `#documents-trash` | FR-06 | ui/document-switcher.js / editor.js |
| E-75 | `#document-search` | FR-06 | ui/document-switcher.js / editor.js |
| E-76 | `button.dialog-close (form method=dialog)` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-77 | `#handoff-version` | FR-10 | ui/export-dialog.js |
| E-78 | `#review-note` | FR-10 | ui/export-dialog.js |
| E-79 | `#copy-summary` | FR-10 | ui/export-dialog.js |
| E-80 | `#download-review` | FR-10 | ui/export-dialog.js |
| E-81 | `button.dialog-close (form method=dialog)` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-82 | `#compare-left` | FR-15 | ui/version-preview.js |
| E-83 | `#compare-right` | FR-15 | ui/version-preview.js |
| E-84 | `#close-comment-popover` | 잔존 DOM | editor.html (비노출, 연결 핸들러 없음) |
| E-85 | `button.dialog-close (form method=dialog)` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| E-86 | `#mcp-address` | FR-12 | editor.js / bridge-client.js |
| E-87 | `#mcp-code` | FR-12 | editor.js / bridge-client.js |
| E-88 | `#mcp-disconnect` | FR-12 | editor.js / bridge-client.js |
| E-89 | `#mcp-connect` | FR-12 | editor.js / bridge-client.js |
| E-90 | `#file-input` | FR-16 | editor.js / ui/export-dialog.js |
| S-01 | `#show-source` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| S-02 | `#show-editor` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| S-03 | `#capture` | FR-01 | capture.js / desktop/ipc.cjs |
| S-04 | `#show-settings` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| S-05 | `#back` | FR-01 | capture.js / desktop/ipc.cjs |
| S-06 | `#forward` | FR-01 | capture.js / desktop/ipc.cjs |
| S-07 | `#reload` | FR-01 | capture.js / desktop/ipc.cjs |
| S-08 | `#address` | FR-01 | capture.js / desktop/ipc.cjs |
| S-09 | `button[type=submit] (주소 열기)` | FR-01 | capture.js / desktop/ipc.cjs |
| S-10 | `#demo` | FR-01 | capture.js / desktop/ipc.cjs |
| S-11 | `#show-agent` | FR-13 | desktop/shell.cjs / desktop/skills.cjs |
| S-12 | `#show-update` | FR-14 | desktop/shell.cjs / desktop/updater.cjs |
| S-13 | `#settings-return` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| S-14 | `button.settings-back` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| S-15 | `#install-skill` | FR-13 | desktop/shell.cjs / desktop/skills.cjs |
| S-16 | `#save-skill` | FR-13 | desktop/shell.cjs / desktop/skills.cjs |
| S-17 | `#mcp-command` | FR-13 | desktop/shell.cjs / desktop/skills.cjs |
| S-18 | `#copy-mcp` | FR-13 | desktop/shell.cjs / desktop/skills.cjs |
| S-19 | `button.settings-back` | FR-02 | ui/workspace-layout.js / desktop/shell.cjs |
| S-20 | `#check-update` | FR-14 | desktop/shell.cjs / desktop/updater.cjs |
| S-21 | `#download-update` | FR-14 | desktop/shell.cjs / desktop/updater.cjs |
| S-22 | `#install-update` | FR-14 | desktop/shell.cjs / desktop/updater.cjs |
