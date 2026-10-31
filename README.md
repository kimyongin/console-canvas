# Console Canvas

실제 웹 화면을 소스 없이 복제해 편집하고, 원하는 디자인을 이미지와 주석으로 로컬 개발 에이전트에게 전달하는 Chromium 내장 앱입니다.

**0.45:** 시안 비교·선택은 기존 에이전트 대화에서 합니다. 캔버스는 확정한 목표를 작업 티켓으로 보관하고 구현 상태·결과·검토를 추적합니다. 앱 내부 AI 인증/호출, 후보 갤러리, 수동 스냅샷과 분기 그래프는 제거했습니다. Chrome 확장은 지원하지 않습니다.

## 사용 흐름

1. 웹사이트에서 로그인하고 원하는 화면을 가져옵니다. 전체 페이지·현재 화면·영역 지정을 지원합니다.
2. 요소를 선택해 이동·삭제·복사·정렬하고, 요소/위치 주석과 추가 설명으로 의도를 남깁니다. 오른쪽은 현재 요청·주석 목록입니다.
3. 기존 프로젝트 개발 대화에서 에이전트에게 이미지 시안을 요청하고 마음에 드는 안을 고릅니다. 직접 편집만으로 충분하면 이 단계는 생략합니다.
4. 선택한 이미지·변경 요청을 **목표 확정**으로 등록합니다. MCP 등록도 지원합니다. 등록만으로 구현을 시작하지 않습니다.
5. 구현을 지시하면 에이전트가 프로젝트 티켓을 조회해 반응형 소스를 수정하고, 구현 이미지·검증 결과를 기록합니다. 사람이 승인하면 완료합니다.

문서 메뉴 → 출처 정보에서 프로젝트를 레포지터리 이름/경로로 연결합니다. **작업 티켓**은 그 프로젝트의 목록을 표시합니다. 목표 이미지와 요청은 등록 후 편집되지 않습니다. 같은 목표의 수정은 기존 티켓에 기록하고, 목표가 바뀌면 새 티켓을 만듭니다.

작업은 로컬에 자동 저장됩니다. 문서 복제는 독립 작업용이며 티켓은 복제하지 않습니다. 문서 이름·휴지통/복구, 패널 접기/너비 조절, 확대·검색과 undo/redo를 지원합니다. 편집 파일 v2에는 현재 문서와 그 문서의 티켓이 들어갑니다. 전달 이미지는 변경 후 화면 위 번호와 하단 요청 카드가 포함된 PNG 한 장입니다.

0.45 저장 구조 전환은 사용자가 폐기 가능하다고 지정한 기존 테스트 문서를 초기화합니다. 일반 웹사이트 로그인·OS 서명과 개인 스킬 파일은 초기화하지 않습니다. 과거 편집 파일 v1 이전 기능은 제공하지 않습니다.

## MCP와 스킬

앱 설정에서 MCP 등록 명령과 스킬 설치·업데이트를 제공합니다. MCP `get_agent_guide`는 앱에 포함된 최신 안내를 반환합니다. 외부 에이전트 계정·API 키가 필요하지 않습니다.

| 용도 | 도구 |
| --- | --- |
| 연결/화면/대상 | `get_agent_guide`, `list_screens`, `get_screen`, `list_elements`, `list_comments`, `list_history` |
| 복제본 편집 | `apply_edits`, `undo`, `redo` |
| 이미지 맥락/전달 | `get_design_context`, `get_review_image` |
| 확정 목표/진행 | `register_ticket`, `list_tickets`, `get_ticket`, `update_ticket` |

쓰기는 화면 또는 티켓의 최신 revision과 operation_id를 요구합니다. 티켓은 프로젝트별로 분리됩니다. 원본 웹사이트와 로컬 저장소를 MCP가 자동 수정하지 않습니다. 에이전트가 대화의 구현 지시 범위에서 소스를 수정합니다.

## 개발·검증

Node.js22.12 이상과 Python3, macOS에서 개발합니다. UI는 React·TypeScript·shadcn, 편집 엔진은 정제한 DOM/CSS를 스크립트 없는 iframe에 렌더링합니다. 네이티브 경계는 Electron이며 로컬 MCP 서버는 Python 표준 라이브러리로 동작합니다.

```sh
npm ci
npm run check
npm run test:desktop:offscreen
python3 scripts/build_desktop.py
python3 scripts/install_desktop.py --update
```

`npm run check`는 공통 웹/타입/포맷/저장·수집·패키지 검사입니다. Electron 경계와 공식 MCP SDK는 별도 통합 검사로 확인합니다. offscreen 검사는 OS 표시 화면을 직접 사용한 검사와 구별합니다. macOS 빌드는 준비된 고정 Apple 개발 서명을 사용하며 자동으로 ad-hoc으로 전환하지 않습니다.

[PRD](docs/PRD.md) · [티켓](docs/ticket-review.md) · [구조](docs/architecture.md) · [0.45 검증](docs/simplification-0.45.md) · [변경별 검증 기준](docs/validation-policy.md)
