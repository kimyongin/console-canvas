# 0.22.2 · 일반 Chrome 설치와 background 시작 수정

2026-10-28 사용자 요청으로 macOS의 일반 Chrome 156.0.8078.48에 압축 해제 확장을 설치했다. 개발자 모드는 이미 켜져 있었으며 기존 Console Canvas 설치는 없었다. 패키지 SHA-256과 파일별 해시를 확인해 고정 폴더에 준비하고 Chrome UI의 폴더 선택으로 설치했다. 다른 확장·프로필·사용자 문서는 변경하지 않았다.

## 발견한 오류와 수정 · #60 / AC-59

0.22.1 설치는 활성화됐지만 background의 `edit-policy.json` 로드 오류로 가져오기가 실행되지 않았다. `db.js`가 전달 모드 정규화를 위해 `workflow-state.js`를 가져오면서 불필요하게 편집 엔진/JSON 모듈까지 서비스 워커에 포함한 것이 원인이다.

DOM/렌더링 의존성이 없는 `handoff-settings.js`로 정규화 함수를 분리했다. 기존 함수의 입출력·저장 형식과 권한 범위는 같다. 같은 폴더에서 0.22.2로 다시 로드해 확장 ID와 데이터 저장소를 유지했다. 이전 확장 파일은 로컬 백업을 보관했다. 확장을 제거하거나 프로필을 초기화하지 않았다.

## 실제 설치 확인

- 도구 모음의 Console Canvas 버튼으로 개인정보 없는 로컬 NORTH 웹 화면을 가져왔다.
- 새 `chrome-extension://…/editor.html?id=…`가 열리고 364개 요소·가져온 상태·변경 이력·`자동 저장 완료`를 확인했다.
- 설치 ID: `ifcighmaalkaibfhpcinlefljhkghbni`. 설치 폴더: 저장소의 `local/chrome-installed/console-canvas`이며 같은 경로를 유지한다. 폴더를 이동·삭제하면 설치가 깨질 수 있다.
- 실제 사용자 웹사이트나 로그인 자료를 수집하지 않았다. 정상 사이트 전체·리소스/권한 매트릭스·WebMCP 실연결·스토어 배포 검증은 #33/#35에서 계속 추적한다. 설치된 Electron 앱과 설치 스킬은 이번 범위가 아니다.

## 자동 검사

제품 `background.js`를 실제 module service worker에서 가져와 캡처 이벤트 리스너가 등록되는지 확인하는 회귀 검사를 추가했다. Chrome 이벤트 등록 API만 fixture에서 제공하며 제품 의존성 그래프는 그대로 로드한다. DOM/JSON 의존성 재유입으로 시작이 실패하면 검사가 실패한다. HTTP 테스트 범위는 별도 경로이며 검사 뒤 등록을 해제한다.

`npm run check` 종료 코드 0: 타입·포맷·빌드/스킬 패키징, Python 43·Node 33·Chromium 401 + smoke 2. 이번 검증으로 SDK/실제 OS 수집 전체/앱 배포를 새로 완료한 것으로 표시하지 않는다.

Git 제외 경로 `local/chrome-install-2026-10-28/`의 `installed.png`, `capture-working.png`, `installation.json`, `check-0.22.2.log`에 설치/실행 증빙을 보관했다. 실제 프로필·토큰은 커밋하지 않는다.
