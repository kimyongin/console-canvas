# Console Canvas 구조 · 0.46

[PRD](PRD.md) · [MCP·스킬 계약](ticket-first-mcp-skill.md) · [0.46 검증](ticket-first-0.46.md)

| 영역 | 구현 |
| --- | --- |
| 원본 수집 | capture.js·desktop/capture.cjs의 읽기 전용 DOM/스타일/자산·iframe·픽셀 수집. 원본 이벤트 비실행 |
| 복제 편집 | engine.js의 스크립트 없는 iframe. edit-commands.js가 사람/MCP의 선택·이동·복사·삭제·주석 검증 공유 |
| UI | React/TypeScript 셸과 통합 tickets.tsx. 티켓 생성/목록/편집·주석·같은 ID 목표 확정/작업·검토 |
| 저장 | db.js IndexedDB v3. captures(실제 캡처 불변, 빈 티켓에 최초 캡처 연결 가능), sessions(편집/주석·undo/redo), documents(내부 경량 메타), tickets, operations, settings(번호/공유 범위) |
| 세션·충돌 | editor-session.js와 save-queue.js. 편집 revision과 저장 revision/writer ID를 구별해 stale writer 거절. UI/MCP가 같은 저장 큐/flush 사용 |
| 티켓·목표 | ticket-model.js. draft 생성·display ID·정확한 이름 해석·same-ticket goal 확정·고정 goal_id·티켓 CAS·작업/검토 기록·영속 작업 receipt |
| 저장된 작업 MCP | ticket-workspace.js가 허용 범위의 ID/이름을 해석. 열린 작업은 현재 controller, 닫힌 작업은 scene-preview.js의 격리 복제본·별도 세션으로 읽거나 편집 |
| 이미지 | design-context.js의 전체/대상/스크롤 상세와 coverage. 현재/목표/구현 role 구별. 원본 재방문·스크립트 실행 없이 저장 복제본 렌더 |
| 백업 | portable-document.js의 티켓 v3, 이전 문서 v2 읽기. 충돌·형식 실패는 원자 거절. 전달 PNG는 handoff-image.js |
| MCP 경계 | tool-contract.json을 JS/Python 공유. Python stdio adapter→인증된 loopback broker→명시적으로 연결한 workspace. 프로젝트별 저장 티켓 공개·철회 |
| 네이티브 | Electron 수집/파일/이미지/종료·스킬/업데이트 IPC. 신뢰 mainFrame 검사. 원본 사이트에는 preload 미노출 |

새 티켓은 처음부터 ID를 소유하고 빈 작업 공간에서 캡처를 연결한다. 모든 새 캡처도 편집 진입 전에 티켓에 귀속한다. 원본이 같은 두 티켓도 mutable 세션은 공유하지 않는다. 0.45 자료는 DB upgrade의 단일 트랜잭션에서 기존 편집을 draft로, 기존 확정 티켓을 같은 ID/목표/기록으로 보존한다. 이전 확정 시점과 전환 당시 현재 편집이 다를 수 있어 legacy_workspace 표시를 둔다. 전환 실패는 롤백하며 로그인 partition은 건드리지 않는다.

상태는 draft→목표 확정 queued→사람 지시 working→증빙/검사 review→사람 승인 done이다. 장애는 blocked, 같은 목표 수정은 queued, 새 목표는 새 티켓이다. 목표·현재 편집·구현 이미지를 혼동하지 않는다. 티켓 생성·조회·목표 확정·MCP 구독은 자동 에이전트 실행이 아니다.

MCP list_tickets/get_ticket은 열린 화면 목록과 독립적이다. UI가 허용한 프로젝트만 공개하고 이름 후보·이미지·resource에도 같은 범위를 적용한다. Navigator Locks로 workspace 명령을 직렬화하고 DB CAS/operation receipt로 재시도·다른 편집기 충돌을 처리한다. 닫힌 티켓 쓰기는 저장된 undo/redo를 복원해 같은 모델을 사용한다. 앱이 꺼졌거나 작업 저장이 실패한 경우 성공으로 표시하지 않는다.

수동 스냅샷/분기, 앱 AI 로그인·직접 호출·후보 적용, Chrome 확장은 없다. 일반 수집 품질 비교·자산 복구·내부 undo·반응형 구현용 원본 식별 정보는 유지한다.
