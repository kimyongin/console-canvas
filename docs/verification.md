# 0.8 리팩토링 검증

환경: macOS Apple Silicon, 공식 Electron 45.0.0, Python 3.9, Node.js 24, MCP SDK 1.32.2.

## 통합 명령

```sh
npm ci
npm run check
```

별도 설치한 Electron은 `ELECTRON_BINARY=/absolute/path/to/Electron npm run check`로 지정한다. 결과는 `dist/browser-checks.json`, `dist/desktop-checks.json`과 `local/mcp-native-verification.json`에 기록한다. 테스트는 가상 NORTH만 사용하며 임시 프로필·포트를 삭제한다.

## 검증 범위

- Python 37개: 전달 파일·스킬 설치·부모/자식 해석·MCP 스키마·HTTP 출처/인증/정적 파일 경계·앱 업데이트 적용과 롤백·스킬 자동 동기화.
- Node 11개: 작업 묶음 원자성·수동/MCP 이동 한계 일치·저장 왕복 좌표·계층 인덱스·저장 합치기/문서 간 보존/실패·저장 응답과 종료·업데이트 전 flush·mainFrame/URL 경계.
- Chromium 102개: 수집·편집·내보내기 61개, 스냅샷/파일 왕복 11개, 패널 접기/드래그/키보드/너비 복원 23개, 저장소/목록/문서 전환 7개. 358개 표시 요소의 이동·삭제·복원을 포함한다.
- 독립 HTML: file URL에서 샘플 실행·300개 이상 요소·외부 스크립트 없는 JS 번들·CSS import 없는 스타일 번들을 확인한다.
- 공식 SDK 18개: 실제 stdio MCP의 11개 도구 발견·앱 지침 조회·요소 조회·이동/삭제/주석·실행 취소/복원·재전송·버전 충돌·스냅샷 이동과 자동 복구.
- 실제 Electron 앱: 별도 홈·프로필·포트에서 원본 NORTH를 가져오고 원본 DOM 무변경, 원본의 preload 미노출, 세 뷰의 sandbox/contextIsolation/Node 비활성화를 확인한다. 일반 창 닫기로 flush한 뒤 앱을 다시 실행해 마지막 문서·이동·주석 초안·추가 설명·스냅샷·패널 너비·편집기 주소창 숨김을 확인한다.

이 검증은 실제 사용자 사이트나 개인 Chrome 확장의 설치/권한 경계를 다루지 않는다. GitHub의 새 릴리스를 다운로드해 설치 앱을 교체하는 전체 업데이트는 이번 리팩토링 검증에서 실행하지 않는다. 업데이트 전 공통 flush와 적용·롤백은 각각 Node/Python 검사로 확인한다. 개발용 ad-hoc 서명과 macOS 공증 여부는 이 리팩토링의 변경 범위 밖이다.
