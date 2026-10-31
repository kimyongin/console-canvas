# Console Canvas 구조 · 0.45

현재 요구사항은 [PRD](PRD.md), 검증은 [0.45 기록](simplification-0.45.md)을 따른다. 이전 스냅샷/앱 AI 구현 계약은 [과거 PRD](PRD-0.44-history.md)와 Git 이력에 남는다.

| 영역 | 구현 |
| --- | --- |
| 원본 수집 | capture.js와 desktop/capture.cjs가 격리된 월드에서 DOM·스타일·자산·접근 가능한 iframe과 실제 픽셀을 읽는다. 원본 이벤트를 실행하지 않는다. |
| 복제 편집 | engine.js의 스크립트 없는 iframe, 선택·이동·삭제·복사·주석. edit-commands.js가 사람/MCP의 작업 검증을 공유한다. |
| 편집 UI | ui/react의 안정된 셸·목록·티켓. 오른쪽은 requests-panel.js의 현재 주석/의도, 요소 속성은 선택 도구에 남는다. |
| 저장/실행 취소 | editor-session.js·save-queue.js의 현재 체크포인트/flush, db.js의 IndexedDB v2. 과거 버전 그래프는 없다. |
| 확정 티켓 | ticket-model.js: 불변 목표와 append 기록. 프로젝트 인덱스, 티켓 revision CAS, 영속 operation receipt를 같은 트랜잭션에서 저장한다. |
| 이미지 맥락 | design-context.js: 전체/선택/스크롤 상세 PNG와 범위·누락 metadata. scene-preview.js의 임시 복제본을 사용해 현재 문서를 변경하지 않는다. |
| 전달/백업 | handoff-image.js의 현재 PNG 한 장, portable-document.js의 문서 v2+티켓 백업. 충돌 import는 원자적으로 거절한다. |
| MCP | tool-contract.json을 JS/Python이 공유. editor-controller.js는 연결한 복제본과 현재 프로젝트의 티켓만 처리한다. |
| 네이티브 | desktop/main.cjs·ipc.cjs·preload.cjs는 수집/이미지/파일/종료·스킬·업데이트를 연결한다. 원본 웹에는 preload 권한을 노출하지 않는다. |

DB 저장소는 immutable captures, mutable sessions, 경량 documents, tickets, operations다. 0.45 전환은 사용자 지시로 과거 테스트 DB v1 저장소를 초기화한다. 웹 로그인용 Electron partition은 건드리지 않는다. 새로운 세션 저장과 티켓 저장은 별개이며 문서 변경/복제로 이미 등록한 목표를 수정하지 않는다.

상태는 queued→working→review→done을 기본으로 하고 수정은 queued, 장애는 blocked로 기록한다. working에는 사람의 구현 지시, review에는 구현 이미지와 검증, done에는 사람의 승인 기록이 필요하다. 티켓 등록·서버 구독은 에이전트 자동 실행이 아니다.

MCP는 stdio 서버와 인증된 loopback 브로커로 나뉜다. 읽기 도구는 명시적으로 연결한 편집기만 찾는다. 화면 편집 revision과 티켓 revision을 구별하며 operation_id 재사용 인자 충돌을 거절한다. 목표/증빙 이미지는 MCP image 블록으로, 텍스트에는 metadata만 반환한다. get_ticket은 목표와 최신 증빙을 반환하고 evidence_record_id로 이전 증빙을 조회할 수 있다. 현대 프로토콜의 연결된 티켓 resource/구독도 같은 범위를 따른다.

앱의 직접 AI 공급자·OAuth/키체인·후보 코드 반환/적용·수동 스냅샷·분기·별도 복잡한 구현 검토의 UI/저장/IPC/MCP 전용 코드는 제거했다. 일반 수집 품질 비교와 자산 복구, 내부 undo 및 반응형 소스 구현용 원본 식별 정보는 유지한다.
