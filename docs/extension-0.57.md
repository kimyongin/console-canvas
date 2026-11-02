# Page Canvas 0.57 · 독립 Chrome 확장 구현과 검증

2026-11-02. #210~218의0.57 구현·격리 검증을 진행했고, 실제 사용자 Chrome 설치·autoConnect 승인은 별도 확인 단계다. 소스와 패키지가 있다는 이유로 모든 설치 조건이 완료됐다고 표시하지 않는다.

## 공통 소스와 독립 실행

`capture/protocol.cjs`, `capture/{view,scope,resources,transport,bytes}.cjs`와 `capture.js`를 Electron과 확장 worker가 함께 사용한다. 예전 desktop/capture-cdp.cjs·capture-resources.cjs 복사본을 제거했다. 확장의 코드에는 DOM/CSS·iframe·자산 수집 알고리즘을 다시 쓰지 않는다. chrome.debugger 연결/이벤트/자식 target 정규화만 `extension/capture.js`에서 처리한다.

빌드가 두 입력의 공통 모듈 import graph를 검사하고 `engine-manifest.json`에 공통 소스 SHA-256을 기록한다. 확장은 실제 브라우저 worker에서 실행하며 process·Buffer·Node require가 없음을 검사했다. Page Canvas 앱·Native Messaging·HTTP 수집 릴레이·Node/Python 런타임이 제품 의존성에 없다. 시험 제어를 위한 CDP와 샘플 HTTP 서버, 에이전트 쪽 공식 Chrome MCP는 별개다.

공통 React 편집기·IndexedDB·티켓 서비스와 도구 계약을 재사용한다. 확장은 Chrome origin/profile별 workspace UUID를 가지며 앱/다른 프로필의 프로젝트·티켓과 자동 합치지 않는다. 원본 tab/document ID는 가져오기 시점으로 고정하며 문서가 바뀌면 잘못된 페이지를 열지 않는다.

## 실제 검증

- `npm run check`: 타입·포맷·번들, Python57·Node44, Chromium 공통 회귀. 새 workspace/capture job13검사와 placeholder46검사를 포함한다.
- `npm run test:desktop:offscreen`: 기존 앱 SDK17·현대 SDK6(protocol2026-07-28), 시각 입력8, 수집 범위6, 저장·스킬·정상 종료/재실행 회귀를 통과했다. 실제 사용자 앱 교체 검증과 구별한다.
- `verify-extension-engine.mjs`: 브라우저 worker와 Electron이 같은6가상 페이지에서 요소 수·DOM 프레임 수가 같다.12개 원본/복제 비교 최저99.77%. iframe·shadow DOM·실제 스크롤·현재/문서/영역을 포함하며 원본 변경도 검사한다.
- 실제10사이트: 네이버·Wikipedia·GOV.UK·MDN·Python docs·W3C·Hacker News·Books to Scrape·ESPN·NASA. 양쪽20개 비교 최저99.23%, 모두99% 이상. [상세 수치](evidence/extension-057/public-visual.json). 동일 캡처가 보관한 원본 PNG와 스크립트 없는 실제 복제 렌더를 비교하며 외부 네트워크 요청을 차단했다.
- 지표는 **RGB 각 채널 차이16 이하인 픽셀 비율**이다. exactPixels는 완전 동일한 RGB 픽셀 비율이며 둘을 섞지 않는다. NASA/ESPN은 exact가79~91%인 경우도 있어 ‘99% 픽셀 완전 동일’이라고 주장하지 않는다. 현재 뷰포트1440×857 범위의 결과이며 전체 문서/임의 페이지 보장이 아니다. 비교를 위해 전체 페이지를 사진으로 바꾸지 않았다.
- 네이버의 한 프레임 Runtime.evaluate 시간 초과, ESPN의 사라진 광고 세션/접근 거절 프레임은 실제 보고서에 남는다. 모든 iframe이 DOM으로 가져와졌다고 주장하지 않는다. 접근 가능한 프레임은 공통 엔진의 DOM 우선 경로를 사용한다.
- `verify-extension-webmcp.mjs`: 일반 창의 설치 Chrome156.0.8078.76에 공식 Chrome DevTools MCP1.12.0을 browser-url로 연결했다.19개 도구 발견, 목록·요소·이동·주석·undo, 미리보기에서 실제 image 콘텐츠 수신, 에이전트 연결 중 chrome.debugger 수집을 확인했다. 테스트용 pipe는 설치/제어만 담당하며 에이전트 호출은 공식 별도 MCP 프로세스다.
- `verify-extension-product.mjs`: 실제 확장 아이콘/팝업에서 첫 이름 입력→가져오기→주석/이동→확정→목록→원본→반복 가져오기를 수행했다. 한 편집기 재사용, 닫힌 티켓 조회, Git 연결 출처·다른 workspace 거절, 새로고침·영역/전체 가져오기,1440/1000px 모든 헤더 버튼 경계를 검사한다. 공식 WebMCP 전체19도구·manifest·claim 경쟁/승인 보호·worker 재시작을 포함해29개 검사에 통과했다. 같은ID/폴더·프로필에서 시험용0.57.1 manifest로 바꾸고 Chrome을 정상 종료/재시작해 주석·목표·저장소·workspace·operation receipt 보존을 검증했다. CDP로 임시 설치한 확장 재로드와 공식 MCP의 폐기된 핸들 오류는 실패 기록에 남겼으며, 사용자 프로필의 수동 확장 새로고침은 별도 승인/검증 대상이다.

원본 캡처/사용자 프로필·로그인/토큰은 커밋하지 않는다. `docs/evidence/extension-057`에는 정제한 지표·소스 해시만 넣는다. 가이드 사진은 가상 NORTH 페이지다.

## 발견해서 고친 문제

- #219: computed style을 저장해도 `::placeholder`가 없어 네이버/NASA 입력 안내가 검게 변했다. 공통 collector가 입력별 placeholder 색·투명도·폰트 값을 복제본에만 담도록 고쳤다. 원본을 수정하거나 사이트 전용 분기를 추가하지 않았다. 실제10사이트와46개 품질 회귀를 다시 확인했다.
- #220: 기존 캔버스용 `width:100%`가 헤더의 티켓 메뉴에 적용돼 오른쪽 버튼이 잘렸다. 확장 헤더 메뉴만32px로 고정하고 상위 컨테이너뿐 아니라 버튼/select 자체 경계까지 검사한다.
- 기존 품질 검사의 프로젝트 없는 저장·scope 무시를 고쳤다. 요청 범위 밖을 누락으로 판단하거나 전체 문서를 비교 범위로 부풀리지 않는다.
- 첫 공개 사이트 통합 시험에서는 native loadURL 대기가 끝나지 않아 실패를 기록했다. 공개 사이트 준비를 bounded DOM-ready/폰트 대기로 바꾼 뒤 최신10개 통합 실행을 재검증했다. 실패 기록을 성공으로 덮어쓰지 않는다.
- 테스트 자동 설치/공식 MCP는 확장 reload 뒤 폐기된 페이지/확장 핸들을 참조할 수 있다. Chrome 내부 URL 직접 이동이나 오래된 pageId를 계속 쓰지 않고 실제 팝업에서 편집기를 다시 열며 도구 목록을 재조회한다. 평소 사용자 프로필의 수동 설치/reload와 분리한다.

- #221: 사용자가 취소한 수집을 일반 연결 오류로 안내했다. 취소 문구를 구별하고 debugger 연결을 즉시 해제한다. 실제 팝업에서 취소 후 티켓이 늘지 않고 worker 재시작 뒤 cancelled 결과가 유지되는 것을 검증했다.

## 사용과 환경 경계

확장 팝업에는 프로젝트·가져올 범위·가져오기·편집기 열기만 둔다. 첫 프로젝트가 있으면 이름을 다시 받지 않는다. 확정은 제자리이며 원본으로 한 번에 돌아간다. 앱 주소창/웹사이트·편집 중복 탭/로컬 서버/앱 업데이트/키체인/자동 스킬 설치 UI는 확장에 렌더하지 않는다. 원본 업무 페이지에는 에이전트 도구를 등록하지 않는다.

최초 연결은 Chrome의 WebMCP 실험 기능과 공식 Chrome MCP 설정·브라우저 연결 승인이 필요하다. `page_canvas_`19개 도구가 실제 확장 최상위 작업공간 탭에 등록된다. 작업공간 탭 하나는 열려 있어야 하며, 개별 티켓이 닫혔어도 저장소에서 읽는다. 일반 MCP resource/구독을 지원한다고 주장하지 않고 필요 시 재조회한다.

이미지는 확장 내부의5분짜리 preview_url로 제공한다. 에이전트는 해당 미리보기를 열어 공식 screenshot의 image 블록으로 받는다. 저장 이미지가 존재한다는 사실을 수신 성공으로 대신하지 않는다. 도구 연결 해제/작업공간 종료 시 URL을 정리한다.

Git 파일 검증은 로컬 에이전트가 한다. 확장은 `{root,common_dir,method:git_rev_parse}`의 형식과 identity 일치를 확인하고 `verification.by:local_agent`, `browser_filesystem_verified:false`를 응답한다. 에이전트 확인을 브라우저 자체의 OS 보증으로 바꾸지 않는다. 실제 파일 접근 검증이 없으면 명시 project_id까지만 사용한다.

같은 SKILL.md가 앱 관리 스킬·확장 가이드/도구·다운로드에 쓰인다. 확장용 스킬 ZIP은 지침/라이선스/UI 메타데이터만 담고 Electron/Python/앱 런타임을 포함하지 않는다. 확장이 사용자 스킬 폴더를 자동 설치/갱신하지 않는다.

## 패키징과 남은 설치 확인

전체 페이지 수집은 기존 공통 준비 단계에서 지연 로딩을 위한 임시 스크롤 후 원래 위치로 복구한다. 현재/영역 수집은 원본을 스크롤하지 않는다. 페이지 자체의 scroll 반응까지 억제하거나 업무 DOM 전체가 불변이라고 보장하지 않는다.

`python3 scripts/build.py`가 앱 런타임/스킬과 `dist/page-canvas-chrome.zip`, `page-canvas-chrome-skill.zip`을 만든다. 확장은 고정 공개 key로 ID `bimhpngcfedknajbgenkbbpkoobfdloa`를 유지한다. 개인 키는 만들거나 저장하지 않았다. 과거 Console Canvas 확장은 제거하지 않는다.

확장은 동일 폴더 덮어쓰기→Chrome 확장 새로고침→팝업의 편집기 열기로 수동 갱신한다. uninstall/reinstall·프로필 삭제는 업데이트가 아니다. 확장 스토어/자동 업데이트·다른 OS 배포는 이번 범위 밖이다. CSP는 self script/object none이며 보안 해제·원격 코드/eval을 추가하지 않는다.

현재 사용자 Chrome의 새 확장 설치·WebMCP/원격 디버깅·autoConnect는 동작 직전 별도 승인 단계다. 격리된 일반 창의 browser-url 성공으로 이 승인을 대신하지 않는다. 기존 앱은 동일 Apple 인증서/번들 ID·경로를 유지해 보존 후 교체한다. 실제 설치·가이드 발행 결과는 완료 시 여기에 기록한다.

## 설치 앱 결과

기존 앱을 정상 Quit한 뒤 같은 Apple Development 지문1AF1575737F365CF53DD6AEAA9C102E7ACF53A07·Team SM838N234X·Designated Requirement로 서명한0.57.0을 ~/Applications/Console Canvas.app에 설치했다. codesign --verify --deep --strict 통과. CUA로 실제 재실행·편집 진입·기존 고객 등록 주석/확정됨을 확인했다. 설치 stdio SDK의 업데이트 전후 비교에서 티켓3개·목표3개·workspace/주석/이미지 해시가 일치했다. 앱이 관리하는 SKILL.md·agents/openai.yaml·런타임 ZIP은 새 소스와 같다. 암호 입력/키체인 재승인은 발생하지 않았다. 데이터 폴더·partition·MCP 경로/등록 ID는 유지했다.

## 동선 액션 원장

원본 페이지가 열린 시점부터 센다. 원본 URL 이동·로그인·검색·메뉴 준비는 페이지마다 다른 별도 액션이며0으로 간주하지 않는다. 자동 저장·렌더 대기·자동 탭 전환은 사용자 액션이 아니다.

| 목표 | 액션 | 줄인 동선/유지한 정보 |
|---|---|---|
| 첫 프로젝트+현재 화면 | 확장 열기1 + 이름 입력1 + 가져오기1 =3 | 별도 프로젝트 관리·빈 티켓 양식 없이 성공할 때 생성 |
| 같은 프로젝트 반복 수집 | 확장 열기1 + 가져오기1 =2 | 프로젝트 재선택·편집기 새 탭 생성 없음 |
| 주석 | 요소 선택1 + 주석 아이콘1 + 입력1 =3 | 별도 모드/완료 버튼 없이 자동 저장 |
| 목표 확정/원본 복귀 | 확정1 + 원본으로1 =2 | 목표 양식·중간 상세 없이 확정과 상태를 구별 |
| 전체 페이지 수집 | 확장1 + 범위 메뉴 열기1 + 전체 선택1 + 가져오기1 =4 | 범위 선택을 현재 화면 기본 동선에 강요하지 않음 |
| 영역 수집 | 확장1 + 범위 메뉴 열기1 + 영역 선택1 + 시작1 + 영역 드래그1 + 가져오기1 =6 | 원본 DOM을 변경하지 않는 명시적 선택/확인 |
| 다른 저장 티켓 열기 | 티켓 목록1 + 원하는 행1 =2 | 중간 상세 없이 바로 편집, ID/상태/미리보기 유지 |
| 대화에 조회 요청 전달 | 요청 복사1 + 대화 전환1 + 붙여넣기1 + 보내기1 =4 | 복사와 전송/구현 승인을 혼동하지 않음 |

공식 MCP 최초 설정·평소 Chrome 권한 승인은 미검증 자동 액션 수를 꾸며내지 않는다. 도구 연결 UI는 에이전트 연결→도구 연결이며, 브라우저/클라이언트 설정 횟수는 실제 승인을 포함해 별도로 기록한다. [제품 검사](evidence/extension-057/product.json)는 실제 팝업 조작과 회귀용 준비 동작 원장을 담으며 MCP의 combobox fill1회는 사람의 메뉴 열기+선택2액션으로 위에서 보정했다.

## 가이드 발행

[사용 가이드](https://console-canvas-guide.yonginkim.chatgpt.site/#chrome)에 실제 확장 팝업·편집·목록 사진과 연결·업데이트·스킬/확장 다운로드를 반영했다. 소스 b90a431511a6a13bab8b93d705348e0e00315669, 배포 appgdep_6ae82630f4b88191ad559336628bffa1 succeeded. 기존 owner 전용 접근 범위를 유지했다.
