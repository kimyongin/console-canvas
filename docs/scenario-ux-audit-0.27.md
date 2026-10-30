# 전체 시나리오 기능 테스트와 UI·UX 검토 · 0.27.0

검토일 2026-10-30 · 제품 소스 b417915 · 가상 NORTH·별도 localhost/임시 Electron 프로필 사용. 기준 [121개 시나리오](user-action-audit-0.26.1.md), [0.27 구현](action-ux-0.27.md).

후속 구현은 [0.28 개선·티켓·검증](ux-0.28.md)에서 추적한다. 아래 발견 기록을 소급해서 삭제하거나 당시 검사를 통과로 바꾸지 않는다.

**121개 전부를 테스트 근거와 대조했고, 14개 UI·UX 개선점과 검사기 결함 1개를 정리했다.** 아래 ‘제어환경 통과’는 연결한 관련 기능 검사가 통과했다는 뜻이다. 각 목표의 모든 변형을 사람이 완주했거나 UX가 모두 합격했다는 뜻은 아니다. OS/외부/실제 AI까지 필요한 15개는 부분 검증으로 분리했다. 기능 검사 통과와 아래 UI 결함이 공존한다.

## 테스트 범위와 결과

| 검사 | 이번 결과 | 해석 |
| --- | --- | --- |
| 최초 `npm run check:all` | 종료 코드1 | 웹/공통 검사와 SDK는 통과했으나, scoped-capture의 macOS stderr 진단이 JSON에 섞여 검사기 파싱 실패(T-01). 전체 성공으로 표시하지 않음. |
| 최종 `npm run check` | 종료 코드0 | 타입·포맷·번들, Python45·Node49·Chromium583+smoke2 통과. resilience에 clipboard 거절→PNG 복구 2개 추가. |
| 별도 `npm run test:desktop` 재실행 | 종료 코드0 | 실제 표시 사진/DOM·IPC·격리 정상 종료/복원. 공식 SDK25+현대 SDK17, 범위 수집·stale 거절5개 통과. |
| 브라우저 직접 사용 | 아래 재현 동선 실행 | 1280×720, 720×600. 제품 화면의 클릭·입력·키·메뉴·스크롤을 사용. 가상 문서 2개와 분기 A→B→C/A→D 생성. |
| 별도 QA MCP 수동 연결 | 통과 | UI 연결 후 공식 SDK:19도구·가이드0.27.0·화면1·주석3·스냅샷5 조회. UI 연결 끊기 후 자료 유지 확인. |
| 보조 CLI | 통과 | 별도 임시 포트/상태 폴더에서 helper `mcp --start`/`--stop` 실행. prepare/review는 Python 실제 subprocess 회귀. |

직접 사용한 주요 동선: 좌표24px 입력→단건 주석/배치·반응형 제안→A 저장→버튼 삭제/B 저장→다른 버튼 이동/C 저장→A 적용/새 이동/D 저장→C로 미래 이동→D 미리보기/두 버전 비교/배율/변경 이동→문서 이름/최근 검색→전달 정책·추가 설명·이미지 복사·PNG 저장→AI 초안 초기화/되돌리기·보관+복사/취소/빈 프롬프트의 주석 요청→다중 선택/각각 주석→묶음 복사/붙여넣기·undo/redo→이력 검색/초기화/모든 가지→문서 재열기→구현 결과 연결·메모·판정/다음 이동/판정 취소→문서 휴지통/복구하고 열기→스냅샷 이름 변경/휴지통/복구→수집 상태→QA MCP 연결/조회/연결 끊기. 문서 복구 후 주석3개·분기5개·이전 검토 메모/판정 복원도 확인했다.

새 주석 대기열의 직접 시험은 2개 대상이며 10개 전체의 직접 타이밍 측정은 아니다. 링크·메뉴·입력 초점·드롭다운 열기/선택·닫기·스크롤·외부/OS 비용을 모두 포함해야 한다. 이번에는 UX 진단을 위한 재현을 수행했으며, 탐색/실패까지 포함한 121개 전체 완료 시간을 계측하지 않았다. 자동 `selectOption()` 1호출을 사용자의 열기+선택1회로 계산하지 않는다.

## 우선순위

P0 자료 손실은 이번 제어환경 시험에서 새로 확인하지 않았다. P1은 주요 작업 접근/대상·의도 혼동, P2는 가독성·맥락·불필요한 왕복이다. 이는 단일 평가자의 사용 관찰이며 사용자 다수의 성과 실험 결과가 아니다.

| ID | 우선 | 관찰된 불편 | 개선 방향 |
| --- | --- | --- | --- |
| UX-01 | P1 | 좁은 창에서 중앙 필수 컨트롤이 겹침 | 필수 undo/redo를 고정하고 보조 기능을 더보기로 배치. 패널 선호는 보존. |
| UX-02 | P1 | 분기 저장 직후 상단 버전 이름이 잘림 | 노드 카드까지 포함해 그래프를 맞추고 상·하 잘림을 안내. |
| UX-03 | P1 | 선택 도구가 원본 비교·수집 상태를 가림 | 상단 상태/비교와 충돌하지 않는 도구 위치. 손잡이 수동 이동은 유지. |
| UX-04 | P1 | 최근 스냅샷과 실제 작업 버전이 혼동됨 | 작업 중인 버전과 최근 저장 버전을 각각 명시. |
| UX-05 | P1 | 삭제와 기존 이동 주석의 의도 충돌 | 삭제·주석 충돌을 전달 전에 표시하고 명시적 정리 제공. |
| UX-06 | P1 | 구현 결과 선택의 시각·맥락 정보 부족 | 결과 선택에 캡처 시각·너비·미리보기를 제공. |
| UX-07 | P2 | 전체 맞춤만으로는 시안 세부를 읽기 어려움 | 전체 맞춤 외 너비 맞춤·100%·선택 위치 확대 제공. |
| UX-08 | P2 | 비교를 닫으면 그래프 맥락으로 돌아오지 않음 | 비교를 연 그래프/선택/스크롤/초점으로 복귀. |
| UX-09 | P2 | 버튼과 내부 텍스트의 선택 계층이 불명확함 | 선택 이름·유형·부모 경로를 항상 표시. |
| UX-10 | P2 | 실행 취소된 복사본 이력에 내부 ID가 노출됨 | 이력 기록 시 읽기 쉬운 이름/원본 식별을 함께 보존. |
| UX-11 | P2 | 전체 가지 이력의 소속 가지를 판별하기 어려움 | 가지 범위와 각 항목의 소속을 표시. |
| UX-12 | P2 | 직전 판정 취소가 바꾼 요청을 알려주지 않음 | 취소한 요청 번호·되돌린 상태·메모 보존 안내. |
| UX-13 | P2 | 작은 AI 창에서 연결 설정이 작성 영역을 밀어냄 | 키 미등록 상태는 간결한 설정 진입, 작성/실행 상태는 고정. |
| UX-14 | P2 | 미연결 상태에도 연결 끊기 버튼이 활성화됨 | 미연결에서는 숨기거나 비활성화하고 연결 상태를 설명. |

## 재현 동선·제안·수용 기준

### UX-01 · 좁은 창의 필수 컨트롤 겹침

720×600에서 양 패널을 연 채 문서 작업. 중앙 캔버스는 x184~504의320px인데, undo는 x294~324, redo329~360, 붙여넣기381~442에 배치되고 같은 자리에 AI/스냅샷 영역이 나타난다. 스냅샷 버튼은 x404~584까지 뻗는다. 필수 명령이 잘리거나 겹치며 하단 맞춤 버튼은 렌더 크기0이다. 패널을 두 번 접으면 회복되지만 이 해결법을 알아야 한다.

개선: undo/redo 등 필수 명령의 클릭 영역을 먼저 확보하고 보조 명령을 더보기로 옮긴다. 저장된 패널 선호를 조용히 덮어쓰지 않는다. 필요하면 ‘캔버스 넓히기’ 한 번 진입을 제공한다. **수용 기준:**720/850/1280px에서 가시 컨트롤 사각형이 겹치지 않고 버튼 중심을 클릭하면 해당 명령이 실행된다. 키보드/더보기의 전체 동선도 확인한다. 증빙 `editor-narrow.png`, `editor-narrow-focused.png`.

### UX-02 · 분기 직후 그래프 상단 카드 잘림

A→B→C를 저장하고 A로 이동→수정→D 저장. 분기 자체는 올바르나 D를 드러내기 위한 세로 스크롤로 위쪽 카드 이름이 잘린다. 그래프 가시 y248~428, 상단 카드 y203~257이므로54px 중9px만 보인다. scrollTop67/scrollHeight245/clientHeight178이다. 연결선과 점은 보여도 부모 이름을 읽을 수 없다.

개선: 점뿐 아니라 카드/레이블까지 포함한 범위를 계산하고, 사용자가 지정한 그래프 높이는 보존하면서 ‘그래프 맞춤’·잘린 방향 안내를 제공한다. **수용 기준:**5노드 분기 직후 A/B/C/D가 식별되고 현재 노드는 보인다. 많은 노드에서는 가로/세로 스크롤 존재가 명확하며 강제 리셋을 반복하지 않는다. 증빙 `branch-graph.png`, `snapshot-initial.png`.

### UX-03 · 선택 도구가 상단 상태를 덮음

1280×720에서 상단 고객 등록 버튼 선택→요소 편집/닫기. 선택 도구가 캔버스 상단 메타데이터·원본 비교 영역 위에 걸친다. 도구를 수동으로 이동할 수 있어도 선택할 때마다 다른 기능의 위치를 가릴 수 있다. 가상 샘플에는 원본 사진이 없어 비교 버튼은 비활성 상태였으므로, 실제 사진이 있는 문서에서 비교 클릭 차단까지 완주했다고 주장하지 않는다.

개선: 상태/비교 영역을 도구 배치에서 제외하고 선택 대상 주변 빈 공간이나 고정 작업 영역에 충돌 없이 둔다. **수용 기준:**상단·가장자리·다중 선택에서 도구와 원본 비교/수집 상태의 hit 영역이 겹치지 않는다. 손잡이·Home 복귀와 작은 화면도 유지. 증빙 `selection-toolbar-overlap.png`.

### UX-04 · 최근 저장 버전과 현재 작업 기준 혼동

D를 저장한 뒤 C로 실제 이동→문서 메뉴. 빠른 목록에는 D 이름이 보이지만 그래프의 ‘작업 중’은C다. 전체 목록은 ‘최근 스냅샷’이라고 표시하지만 빠른 목록은 이름만 표시해 현재 기준으로 읽기 쉽다. 원인은 `db.js`의 `documentSummary()`가 마지막 저장 스냅샷을 선택하는 동작이며 문서가 실제로D로 돌아간 것은 아니다.

개선: ‘작업 기준 C · 변경 있음’과 ‘최근 저장 D’를 구분한다. **수용 기준:**C 작업/D 최신 저장/휴지통/현재 스냅샷 없음·자동 보관 상태가 오해 없이 일치한다. 기존 캡처나 분기 구조를 바꾸는 해결은 제외한다.

### UX-05 · 삭제와 이전 주석의 의도 충돌

A에서 고객 등록에 이동·반응형 주석→B에서 해당 버튼 삭제→현재 작업 전달. 전달 목록에는 ‘삭제·고객 등록’이 있는데 이전 이동 지시도 여전히 유효한 주석이다. 두 요구가 동시에 의도일 수도 있어 자동 삭제할 수는 없지만, 에이전트에게 어떤 행동을 우선할지 불명확하다.

개선: 전달 검토에 ‘삭제된 대상의 주석’ 충돌을 표시하고 현재 주석 편집/명시적 제외/그대로 전달을 고를 수 있게 한다. **수용 기준:**기존 주석을 자동으로 지우지 않으며 정책과 최종 이미지에 선택한 의도가 일치한다. 계층 삭제 아래 주석·후속 PNG도 확인한다. 증빙 `handoff.png`, 생성된 QA PNG.

### UX-06 · 구현 결과 선택 정보 부족

목표 문서→구현 결과 확인→수정 후 가져온 화면 선택. 옵션은 문서 이름+URL이며 캡처 시각·너비·미리보기가 없다. 같은 주소를 반복 수집하는 실제 개발에서는 이름을 별도로 바꾸지 않으면 구별하기 어렵다. 검토 상단의 목표도 ‘현재 작업’ 중심이어서 어떤 문서의 어느 시점인지 읽어야 한다. 이번 시험은 명명한 결과1개를 연결했고, 동일 이름 다수의 오선택률을 측정한 것은 아니다.

개선: 결과 선택에 캡처/최근 저장 시각을 구분해 표시하고 썸네일·너비·문서 이름을 제공한다. 목표 문서/동결 버전/현재 작업과 달라짐도 명시한다. **수용 기준:**같은 URL/이름의 결과3개 중 선택한 문서 ID가 명확하고 기존 판정은 보존된다. 자동으로 가장 최신 결과를 적용하지 않는다. 증빙 `implementation-review.png`.

### UX-07 · 세부 확인에 너무 작은 전체 맞춤

1280×720의 주 편집기 전체 맞춤은52%이고, 분기 미리보기는 긴1360px 문서 전체를 작은 하단 높이에 맞춰 표시한다. 그래프 화면의 미리보기는 문구·간격 검토가 어려워 비교 모달을 추가로 열게 된다. 주 편집기에는 배율 조절이 있으나 스냅샷 미리보기에는 동등한 확대 동선이 부족하다.

개선: 너비 맞춤/100%/선택 위치 확대를 명시적으로 제공하고 전체 맞춤은 유지한다. 실제 반응형 뷰포트를 바꾸는 확대와 혼동하지 않게 한다. **수용 기준:**미리보기 안에서 버튼 문구/여백을 확인하고 확대 전후 선택·버전·원본 너비는 동일하다. 증빙 `selection-toolbar-overlap.png`, `branch-graph.png`.

### UX-08 · 비교 닫기 후 그래프 맥락 상실

그래프에서D 미리보기→현재 작업과 비교→닫기. 그래프가 닫혀 있어 다시 열어야 한다. 선택 버전 자체는 유지되지만 패널·초점·스크롤 맥락이 끊긴다. 추가 비용은 목록 열기1+필요한 탐색q다.

개선: 비교를 연 출처를 기억해 같은 그래프/노드/스크롤/초점으로 복귀한다. **수용 기준:**일반 비교 진입·그래프 진입·하위 메뉴 진입을 구분하고 문서/선택이 바뀐 경우 오래된 패널을 강제로 열지 않는다. 증빙 `version-comparison.png` 및 닫기 직후 숨겨진 `#close-snapshots` 관찰.

### UX-09 · 선택 계층의 전환이 눈에 띄지 않음

내보내기를 선택한 뒤 다시 클릭·검색을 수정키 추가 선택→주석 대기열. 첫 대상이 ‘내보내기 텍스트’, 둘째는 ‘검색 버튼’으로 나타났다. 내부를 선택할 수 있는 기능은 유효하지만 작은 라벨에서 버튼 전체/문자열 선택의 차이를 미리 알기 어렵다. 오선택 때문에 원치 않는 실제 원본 업무 이벤트가 실행된 것은 아니다.

개선: 선택 도구에 이름·유형·부모 경로를 표시하고 ‘버튼 전체 선택’ 같은 명시적 이동을 둔다. **수용 기준:**내부 텍스트 접근을 막지 않으면서 일반/세부/상위·이미 선택된 부모 클릭의 기준이 일관된다. 다중 선택 전에 대상 종류를 확인할 수 있다.

### UX-10 · 이력의 내부 ID 노출

묶음 붙여넣기→undo/redo/undo→모든 가지 이력. 현재 scene에서 사라진 복사본의 일부 기록이 `n176…` 같은 긴 내부 ID로 나타나고 대상은 비활성화된다. 사용자는 어떤 구성요소였는지 알 수 없다.

개선: 기록 당시 표시 이름·원본 문구·copiedFrom 맥락을 보존하고 현재 없는 대상은 ‘복사본·현재 화면에 없음’으로 표시한다. **수용 기준:**undo/redo·브랜치/파일 왕복 후에도 읽을 수 있는 이름을 유지하며 없는 대상을 억지로 선택하거나 식별자를 새로 할당하지 않는다. 증빙 `history-internal-ids.png`.

### UX-11 · 모든 가지 이력의 소속이 불명확함

A→D 분기를 만든 뒤 C에서 ‘모든 가지 포함’ 체크. 범위는 넓어지지만 설명은 ‘현재 작업 기준·C’이며 개별 이벤트의 가지 소속이 보이지 않아D에서의 변경을 현재 적용 상태로 오해할 수 있다.

개선: 전체 범위임을 명시하고 각 기록에 가지/기준 스냅샷과 현재 적용 여부를 제공한다. **수용 기준:**기록 조회가 복원/편집을 실행하지 않으며 현재/평행 가지/자동 보관 기록이 구별된다. 토글1회 경로는 유지한다. 증빙 `history-all-branches.png`.

### UX-12 · 판정 취소의 대상 피드백 부족

요청1 메모/판정→다음 이동 옵션 켜기→요청1 반영→요청2로 이동→직전 판정 취소. 요청1 상태가 돌아가고 메모는 유지되지만 활성 요청2는 그대로이며 어떤 판정을 되돌렸는지 안내가 부족하다.

개선: ‘요청1을 추가 수정으로 되돌렸습니다’와 선택적 해당 요청 보기 제공. **수용 기준:**캔버스 undo와 섞지 않고 메모를 보존한다. 취소 피드백만으로 다음 요청을 자동 판정/선택하지 않는다. 증빙 `implementation-review.png`.

### UX-13 · 좁은 AI 창에서 인증 설정이 주 작업을 밀어냄

720×600에서 새 요청→API 방식 선택. 열린 키·모델 설정이 화면 대부분을 차지하고 프롬프트·생성 버튼은 아래로 밀린다. 미등록 안내는 정확하지만 ‘무엇을 바꾸고 싶은가’를 작성하기 전에 설정 스크롤이 길다.

개선: 미등록 요약+설정 진입을 간결하게 두고 프롬프트/실행 조건/생성 취소를 유지한다. **수용 기준:**키/모델을 숨긴 채 유료 호출하지 않으며 등록·실패·삭제·실행 중·후보 존재 상태에서 작성/비교 공간을 확보한다. 증빙 `ai-narrow.png`, `ai-api-setup.png`.

### UX-14 · 미연결에서 활성인 연결 끊기

QA 웹 편집기의 로컬 연결이 없는 상태→연결 창. 연결 끊기 버튼이 활성이다(`isEnabled=true`). 연결 완료 후 끊기는 정상 작동하고 문서·주석·스냅샷도 유지되므로 연결 데이터 손실 문제는 아니다.

개선: 미연결에서는 숨기거나 비활성화·이유 제공, 연결 중에는 취소와 구분. **수용 기준:**미연결/연결 중/연결됨/실패/직접 끊기 뒤 버튼 의미가 유효하다. 최근 에이전트 통신 기록을 현재 연결 성공으로 오해하지 않게 한다. 증빙 `mcp-disconnected.png`.

## 검사 신뢰성 · T-01

`scripts/check-desktop.mjs`의 `start()`가 stdout/stderr를 한 문자열에 합치고 scoped-capture 결과를 `JSON.parse()`한다. 이번 최초 실행에서 macOS `task_policy_set` 진단이 JSON 앞에 붙어 실제 범위 검사5개 성공 뒤 전체 검사가 실패했다. 재실행은 통과했다. 결과를 임의로 성공으로 바꾸거나 환경 진단을 제품 버그로 분류하지 않았다.

개선 후보: 프로세스 종료/실제 검증 실패는 계속 전파하되 stdout의 구조화 결과와 stderr 진단을 분리한다. 정상 JSON+stderr, 잘못된 JSON, 실제 비정상 종료를 각각 회귀 검사한다. 로그: `check-all.log`, `desktop-retry.log`.

## 권장 처리 순서와 보존 조건

1. UX-01/02/03: 가려진 컨트롤과 그래프 이름을 먼저 복구. 사각형 포함 검사뿐 아니라 실제 hit-test/카드 전체 가시성으로 검증한다.
2. UX-04/05/06: 현재 버전·전달 의도·구현 결과 식별을 명확히 해 다른 시안을 구현하거나 검토할 위험을 줄인다.
3. UX-09/10/11/12/14: 대상/이력/판정/연결의 맥락과 피드백을 정리한다.
4. UX-07/08/13: 읽기·확대·복귀·설정 흐름을 개선한다. T-01은 검사 신뢰성 작업으로 병행 가능하다.

모두 이번에는 **발견·정리한 개선안**이며 제품 수정 완료가 아니다. 버튼을 더 넣어 혼잡하게 하거나, 패널 선호/확인·이름 입력/원본 범위를 강제로 바꿔 클릭만 줄이지 않는다. 기존 편집·주석·전체 분기·휴지통·원본 식별자와 MCP 계약을 유지한다. 실제 사용자 자료·설치 앱·설치 스킬은 이번 테스트로 변경하지 않았다.

## 121개 기능 검증 매트릭스

- **제어환경 통과:** 관련 앱 기능을 가상/격리 조건에서 검사. 자동 검사는 imperative UI/엔진 호출과 실패 주입도 포함하며 사람의 클릭 완주와 다르다.
- **부분 검증:** 앱 내부 기능은 검사했으나 목표에 필요한 실제 OS·외부 대화·유료 AI 구간은 미완료. 완료로 묶지 않는다.
- **직접:** 이번 브라우저/CLI에서 해당 경로를 사용. 2개 다중 선택 등 시험한 변형에 한정하며 목표의 모든 개수/OS 조건을 실측한 것은 아니다.
- 표의 근거는 [tests](../tests/)의 관련 suite다. 기능 결과가 통과여도 오른쪽 UX 항목은 미개선 상태다. 실제 사이트 다양성/원본95% 충실도는 별도 품질 시험이며 이 가상 시나리오 결과로 대신하지 않는다.

| ID | 목표 | 기능 검증 | 직접 | 관련 근거 | UI·UX / 남은 조건 |
| --- | --- | --- | --- | --- | --- |
| A01 | 현재 보이는 화면 가져오기 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A02 | 편집기에서 새 URL을 열고 현재 화면 가져오기 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A03 | 전체 페이지로 범위를 바꿔 가져오기 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A04 | 영역을 지정해 가져오기 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A05 | 잘못 지정한 영역을 다시 지정해 가져오기 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A06 | 가져오기 실패 후 재시도 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A07 | 편집기에서 수집 경고의 대상 확인 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | UX-03 |
| A08 | 편집기에서 실제 원본 사진과 비교 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | UX-03 |
| A09 | 원본 사진을 겹쳐 농도 조절하며 비교 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A10 | 기본 선택된 누락 이미지·폰트를 읽고 적용 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A11 | 일부 성공·일부 실패한 자산을 모두 복구 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A12 | 샘플 콘솔을 가져와 시험하기 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| A13 | 원본 페이지 뒤로·앞으로·새로고침 | 제어환경 통과 | 자동 중심 | desktop-fixture, scoped-capture, shell-actions, capture-status, capture-enhancements, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B01 | 요소 또는 선택된 부모 내부의 자식 선택 | 제어환경 통과 | 사용 | selection, navigation, panels, usability, action-ux | UX-03 · UX-09 |
| B02 | 세부 요소 또는 상위 요소 선택 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | UX-09 |
| B03 | 영역 안의 여러 요소 선택 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B04 | 떨어진 요소 3개 선택 | 제어환경 통과 | 사용 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B05 | 레이어 검색으로 요소 선택 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B06 | 레이어에서 하위 요소 선택 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B07 | 선택 요소를 화면에 맞춰 보기 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B08 | 전체 화면 맞춤 또는 한 단계 확대 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | UX-07 |
| B09 | 정해진 확대 비율로 변경 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B10 | 좌우 패널을 모두 접거나 다시 펼치기 | 제어환경 통과 | 사용 | selection, navigation, panels, usability, action-ux | UX-01 |
| B11 | 패널 너비·그래프 높이·선택 도구 위치 조절 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| B12 | 주요 요소만 필터로 레이어 탐색 간소화 | 제어환경 통과 | 자동 중심 | selection, navigation, panels, usability, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| C01 | 요소 하나 이동 | 제어환경 통과 | 자동 중심 | ux, selection, unit/selection, action-ux, desktop-fixture | UX-03 · UX-09 |
| C02 | 여러 요소 함께 이동 | 제어환경 통과 | 자동 중심 | ux, selection, unit/selection, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| C03 | 선택된 요소 1px 또는 10px 이동 | 제어환경 통과 | 사용 | ux, selection, unit/selection, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| C04 | 선택된 요소의 X·Y를 정확한 값으로 변경 | 제어환경 통과 | 사용 | ux, selection, unit/selection, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| C05 | 요소 삭제 | 제어환경 통과 | 사용 | ux, selection, unit/selection, action-ux, desktop-fixture | UX-05 |
| C06 | 요소 하나 복제 | 제어환경 통과 | 자동 중심 | ux, selection, unit/selection, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| C07 | 여러 요소를 복제 | 제어환경 통과 | 사용 | ux, selection, unit/selection, action-ux, desktop-fixture | UX-10 |
| C08 | 여러 요소 정렬·간격 맞춤 | 제어환경 통과 | 자동 중심 | ux, selection, unit/selection, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| C09 | 선택된 요소의 정렬선 맞추기 켜기 | 제어환경 통과 | 자동 중심 | ux, selection, unit/selection, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| C10 | 최근 편집 또는 에이전트 작업 묶음 되돌리기·다시 실행 | 제어환경 통과 | 사용 | ux, selection, unit/selection, action-ux, desktop-fixture | UX-01 · UX-10 |
| C11 | 선택된 레이어 별칭 지정 | 제어환경 통과 | 자동 중심 | ux, selection, unit/selection, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| D01 | 새 요소에 주석 한 개 작성하고 편집으로 복귀 | 제어환경 통과 | 사용 | ux, evolution, usability, developer-workflow, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| D02 | 빈 좌표에 주석 작성하고 복귀 | 제어환경 통과 | 자동 중심 | ux, evolution, usability, developer-workflow, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| D03 | 기존 주석 수정하고 복귀 | 제어환경 통과 | 자동 중심 | ux, evolution, usability, developer-workflow, action-ux | UX-05 |
| D04 | 기존 주석 삭제하고 복귀 | 제어환경 통과 | 자동 중심 | ux, evolution, usability, developer-workflow, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| D05 | 배치 의도·반응형 제안을 골라 주석 작성 | 제어환경 통과 | 사용 | ux, evolution, usability, developer-workflow, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| D06 | 서로 다른 새 대상 10개에 주석 작성 | 제어환경 통과 | 사용 | ux, evolution, usability, developer-workflow, action-ux | UX-09 |
| D07 | 기존 요청 목록의 주석 10개를 순서대로 수정 | 제어환경 통과 | 자동 중심 | ux, evolution, usability, developer-workflow, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| D08 | 열린 주석 창에서 떨어진 요청 하나 수정 | 제어환경 통과 | 자동 중심 | ux, evolution, usability, developer-workflow, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| D09 | 전달 화면에서 요청 하나 수정 후 같은 위치로 복귀 | 제어환경 통과 | 자동 중심 | ux, evolution, usability, developer-workflow, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| E01 | 이름을 정해 스냅샷 저장 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | UX-02 |
| E02 | 다른 스냅샷 미리보기 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | UX-01 · UX-02 · UX-07 |
| E03 | 검색해 특정 스냅샷 미리보기 | 제어환경 통과 | 자동 중심 | snapshots, graphflow, evolution, trash, placement, followup | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| E04 | 과거·미래 스냅샷을 실제로 적용 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | UX-04 |
| E05 | 현재 위치 C에서 A로 돌아가 수정하고 D 분기 저장 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | UX-02 · UX-11 |
| E06 | 미리보기에서 현재 작업과 비교 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | UX-07 · UX-08 |
| E07 | 원하는 저장 버전 두 개 비교 | 제어환경 통과 | 자동 중심 | snapshots, graphflow, evolution, trash, placement, followup | UX-08 |
| E08 | 스냅샷 이름 변경 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| E09 | 스냅샷을 휴지통으로 이동 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| E10 | 스냅샷을 복구하거나 복구하고 적용 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| E11 | 열린 그래프에서 현재 버전으로 미리보기 복귀 | 제어환경 통과 | 자동 중심 | snapshots, graphflow, evolution, trash, placement, followup | UX-02 |
| E12 | 열린 비교에서 다음 변경 위치 확인 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| E13 | 열린 버전 비교에서 배율 또는 동기 스크롤 변경 | 제어환경 통과 | 사용 | snapshots, graphflow, evolution, trash, placement, followup | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| F01 | 기록된 작업의 대상을 캔버스에서 확인 | 제어환경 통과 | 자동 중심 | evolution, graphflow, activity-groups, branch-history, action-ux | UX-10 |
| F02 | 특정 작업의 주석 내용 수정 | 제어환경 통과 | 자동 중심 | evolution, graphflow, activity-groups, branch-history, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| F03 | 전체 가지 또는 특정 종류 이력 보기 | 제어환경 통과 | 사용 | evolution, graphflow, activity-groups, branch-history, action-ux | UX-11 |
| F04 | 이력 검색 | 제어환경 통과 | 사용 | evolution, graphflow, activity-groups, branch-history, action-ux | UX-11 |
| F05 | 현재 선택 요소의 이력만 보기 | 제어환경 통과 | 자동 중심 | evolution, graphflow, activity-groups, branch-history, action-ux | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| F06 | 묶인 연속 이동의 개별 기록 확인 | 제어환경 통과 | 자동 중심 | evolution, graphflow, activity-groups, branch-history, action-ux | UX-10 |
| G01 | 보이는 다른 저장 문서로 전환 | 제어환경 통과 | 사용 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | UX-04 |
| G02 | 이름을 검색해 다른 문서로 전환 | 제어환경 통과 | 사용 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | UX-04 |
| G03 | 현재 문서 이름 변경 | 제어환경 통과 | 사용 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| G04 | 현재 문서를 휴지통으로 이동 | 제어환경 통과 | 사용 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| G05 | 다른 문서를 목록에서 휴지통으로 이동 | 제어환경 통과 | 자동 중심 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| G06 | 휴지통 문서를 복구 또는 복구하고 열기 | 제어환경 통과 | 사용 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | UX-04 |
| G07 | 현재 문서의 전체 분기 포함 편집 파일 저장 | 부분 검증 | 자동 중심 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | 파일 직렬화·분기 왕복/저장 IPC 검증. 실제 OS 저장 대화상자 미조작. |
| G08 | 편집 파일 열기 | 부분 검증 | 자동 중심 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | File 입력·검증·기존 자료 보존/왕복 검증. OS 파일 선택 대화상자 미조작. |
| G09 | 원본 주소 또는 원본 화면으로 돌아가기 | 제어환경 통과 | 자동 중심 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| G10 | 다음 실행에서 마지막 작업 계속하기 | 제어환경 통과 | 자동 중심 | trash, placement, resilience, storage, navigation, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| H01 | 현재 작업 전달 이미지를 클립보드로 복사 | 제어환경 통과 | 사용 | developer-workflow, followup, resilience, integration, desktop-fixture | UX-05 |
| H02 | 현재 작업 전달 이미지를 PNG로 저장 | 부분 검증 | 사용 | developer-workflow, followup, resilience, integration, desktop-fixture | 브라우저 PNG 실제 저장 확인. 내장 앱 OS 저장 대화상자는 대체 경계. |
| H03 | 특정 저장 버전의 전달 이미지 복사 | 제어환경 통과 | 자동 중심 | developer-workflow, followup, resilience, integration, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| H04 | 확정 시안 전달 정책으로 바꿔 복사 | 제어환경 통과 | 사용 | developer-workflow, followup, resilience, integration, desktop-fixture | UX-05 |
| H05 | 추가 설명을 입력해 전달 이미지 복사 | 제어환경 통과 | 사용 | developer-workflow, followup, resilience, integration, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| H06 | 현재 이미지와 요청을 개발 에이전트에 전달 | 부분 검증 | 자동 중심 | developer-workflow, followup, resilience, integration, desktop-fixture | 이미지 복사 확인. 외부 개발 에이전트 대화에 붙여넣기·보내기는 실행하지 않음. |
| H07 | 전달 중 요청 수정 후 이미지 다시 복사 | 제어환경 통과 | 자동 중심 | developer-workflow, followup, resilience, integration, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| I01 | 이미 저장된 구현 화면을 검토에 연결 | 제어환경 통과 | 사용 | developer-workflow, action-ux, desktop-fixture | UX-06 |
| I02 | 구현 화면을 새로 가져와 목표에 연결 | 제어환경 통과 | 자동 중심 | developer-workflow, action-ux, desktop-fixture | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| I03 | 요청 하나를 확인하고 반영 여부 판정 | 제어환경 통과 | 사용 | developer-workflow, action-ux, desktop-fixture | UX-05 · UX-12 |
| I04 | 요청 10개를 순서대로 확인·판정 | 제어환경 통과 | 사용 | developer-workflow, action-ux, desktop-fixture | UX-12 |
| I05 | 현재 선택된 요청에 검토 메모 남기기 | 제어환경 통과 | 사용 | developer-workflow, action-ux, desktop-fixture | UX-12 |
| I06 | 이전 검토 결과 다시 열기 | 제어환경 통과 | 사용 | developer-workflow, action-ux, desktop-fixture | UX-06 |
| I07 | 다른 구현 결과로 새 검토 시작 | 제어환경 통과 | 자동 중심 | developer-workflow, action-ux, desktop-fixture | UX-06 |
| I08 | 열린 검토에서 남은 요청 PNG 저장 | 부분 검증 | 자동 중심 | developer-workflow, action-ux, desktop-fixture | 남은 요청/메모 PNG 생성 검증. 실제 OS 저장 대화상자 미조작. |
| J01 | 선택 요소로 MCP 시안 요청을 작성·복사 | 제어환경 통과 | 사용 | ai-variants, action-ux, official SDK | UX-13 |
| J02 | MCP 요청 전달 후 받은 후보 하나 적용 | 부분 검증 | 자동 중심 | ai-variants, action-ux, official SDK | 후보 제출·비교·적용은 fixture/SDK로 검증. 실제 외부 에이전트 시안 생성은 미실행. |
| J03 | 등록된 API로 시안 생성 후 적용 | 부분 검증 | 자동 중심 | ai-variants, action-ux, official SDK | UX-13 / mock API의 응답·오류·적용 검증. 실제 과금 모델 추론 미실행. |
| J04 | 처음 API를 등록해 시안 생성 후 적용 | 부분 검증 | 자동 중심 | ai-variants, action-ux, official SDK | UX-13 / 가상 키 등록/모델 입력/삭제·비밀 제외 검증. 실제 키/추론 미실행. |
| J05 | 주석을 바탕으로 프롬프트 없이 시안 생성 | 제어환경 통과 | 사용 | ai-variants, action-ux, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| J06 | 기존 후보 갤러리에서 시안 적용 | 제어환경 통과 | 자동 중심 | ai-variants, action-ux, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| J07 | 기존 요청과 같은 기준으로 추가 생성 | 부분 검증 | 자동 중심 | ai-variants, action-ux, official SDK | 같은 기준 재생성·취소는 mock API 검증. 실제 추가 추론 미실행. |
| J08 | 열린 갤러리에서 생성 취소 | 제어환경 통과 | 사용 | ai-variants, action-ux, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| J09 | 등록된 API 키를 삭제 | 제어환경 통과 | 자동 중심 | ai-variants, action-ux, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| J10 | 연결된 MCP 에이전트에 단일 편집 요청 | 부분 검증 | 자동 중심 | ai-variants, action-ux, official SDK | SDK 실제 연결·조회/편집 경계 검증. 외부 대화의 자연어 입력·전송 미실행. |
| J11 | 열린 AI 요청에서 후보 개수 지정 | 제어환경 통과 | 자동 중심 | ai-variants, action-ux, official SDK | UX-13 |
| J12 | 열린 AI 갤러리에서 후보 화면 확대 | 제어환경 통과 | 자동 중심 | ai-variants, action-ux, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| J13 | 열린 AI 요청 초안 초기화 | 제어환경 통과 | 사용 | ai-variants, action-ux, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| K01 | 앱 제공 스킬 설치 또는 업데이트 | 제어환경 통과 | 자동 중심 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| K02 | 앱 제공 스킬 ZIP 저장 | 부분 검증 | 자동 중심 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | 격리 파일에 실제 ZIP 저장. OS 경로 선택 대화상자는 stub. |
| K03 | 처음 MCP 등록을 마치기 | 부분 검증 | 자동 중심 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | 명령 복사·공식 SDK 연결은 확인. 사용자의 에이전트 설정 등록/재시작 미실행. |
| K04 | 로컬 MCP 연결 상태 확인 | 제어환경 통과 | 사용 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | UX-14 |
| K05 | 앱 최신 버전 확인 | 부분 검증 | 자동 중심 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | 업데이트 진입·자동 확인·오류 UI/메타데이터 검증. 최신 릴리스의 실시간 유무를 이 검사로 확정하지 않음. |
| K06 | 새 버전을 확인·다운로드·적용 후 재실행 | 부분 검증 | 자동 중심 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | 격리 교체/실패 복구·저장 중단/재시작 계약·UI 동의 검증. 사용자 설치 앱의 실제 업데이트·재실행 미실행. |
| K07 | 설정 하위 화면에서 편집으로 돌아가기 | 제어환경 통과 | 자동 중심 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| K08 | 앱 정상 종료 후 다시 시작해 작업 복원 | 제어환경 통과 | 자동 중심 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| K09 | 연결된 복제본의 MCP 연결 끊기 | 제어환경 통과 | 사용 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | UX-14 |
| K10 | 보조 웹 편집기를 로컬 MCP에 수동 연결 | 제어환경 통과 | 사용 | shell-actions, desktop-fixture, test_app_skill, test_app_update, unit/updater, official SDK | UX-14 |
| L01 | 자동 저장 실패 중 긴급 편집 파일 백업 | 부분 검증 | 자동 중심 | resilience, storage, trash, action-ux, unit/save-queue | 실제 DB 오류 주입·최신 메모리 백업/재열기 검증. OS 파일 선택 미조작. |
| L02 | 이미지 클립보드 실패 후 PNG 저장 | 제어환경 통과 | 자동 중심 | resilience, storage, trash, action-ux, unit/save-queue | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| L03 | 삭제 직후 문서·스냅샷 복구 | 제어환경 통과 | 자동 중심 | resilience, storage, trash, action-ux, unit/save-queue | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| L04 | 잘못된 편집 파일을 취소하고 기존 작업 계속 | 제어환경 통과 | 자동 중심 | resilience, storage, trash, action-ux, unit/save-queue | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| L05 | 스냅샷 복원 저장 실패 후 현재 작업 유지 | 제어환경 통과 | 자동 중심 | resilience, storage, trash, action-ux, unit/save-queue | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| M01 | 독립 HTML의 가상 샘플로 시작 | 제어환경 통과 | 자동 중심 | standalone, test_skill, test_runtime_package, test_mcp, QA CLI | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| M02 | 스킬 번들에서 런타임 준비 | 제어환경 통과 | 자동 중심 | standalone, test_skill, test_runtime_package, test_mcp, QA CLI | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| M03 | 기존 편집 JSON/ZIP을 에이전트용으로 요약 | 제어환경 통과 | 자동 중심 | standalone, test_skill, test_runtime_package, test_mcp, QA CLI | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
| M04 | 보조 로컬 MCP 서버를 시작 또는 종료 | 제어환경 통과 | 사용 | standalone, test_skill, test_runtime_package, test_mcp, QA CLI | 추가 관찰 없음. 전 환경 무결함을 의미하지 않음. |
