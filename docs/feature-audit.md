# 0.45 기능과 요구사항 대조

현재 범위는 [PRD](PRD.md), 실제 검증은 [0.45 검증](simplification-0.45.md)에 기록한다. 기존 0.44 기능과 수용 기준은 과거 PRD/Git 이력에 남는다.

| 요구사항 | 현재 책임 모듈 | 검사 |
| --- | --- | --- |
| CC-FR-01 원본 복제/이미지 맥락 | capture.js, desktop/capture.cjs, design-context.js | iframe·capture-quality·capture-enhancements·scope, visual-input |
| CC-FR-02 기본 편집/주석/복제/저장 | engine.js, editor-session.js, requests-panel.js, db.js | layout·selection·panels·tickets, save-queue·copy-model |
| CC-FR-03 확정 목표 | ticket-model.js, tickets.tsx, portable-document.js | tickets, SDK 등록/중복/목표 불변/프로젝트 격리 |
| CC-FR-04 상태/증빙/승인 | ticket-model.js, tickets.tsx | tickets·unit·SDK 상태 검증과 CAS |
| CC-FR-05 MCP | tool-contract.json, editor-controller.js, mcp/ | JS/Python 계약, HTTP 경계, 공식 SDK 두 세대 |
| CC-FR-06 스킬 | skills/console-canvas/, desktop/skills.cjs | runtime checksum, app-skill, native installation |
| CC-FR-07 승인된 초기화/새 자료 저장 | db.js v2, portable-document.js | workspace-reset, tickets 파일 왕복/재시작, desktop 정상 종료/재실행 |
| CC-FR-08 제거 | 전용 UI/모듈/IPC/MCP 삭제 | retired UI/runtime assertions, native preload, package assertions |

제거한 것은 수동 스냅샷/분기 그래프와 과거 이동, 앱 내부 AI 공급자/로그인/직접 호출, 후보 갤러리/코드 적용, 별도 복잡한 구현 재수집/검토다. 이미지 맥락과 현재 PNG, 수집 품질의 원본 비교, 자산 복구와 undo는 유지한다.

원본 재현 일반화 #68/#73과 공개 배포 적격 #152는 별도 미해결 과제다. 이 전환 검증이 모든 실사이트의100% 일치나 Developer ID 공증을 의미하지 않는다.
