# AI 시안 MVP · 0.21.0

2026-10-26. FR-21~27 / AC-34~43의 **부분 구현**이다. 원본 사이트·개인 프로필·사용자 설치 앱은 변경하지 않았다. 실제 계정 API 추론·ChatGPT OAuth·에이전트 채팅 자동 시작은 완료되지 않았다.

## 사용 흐름

1. 화면을 가져와 요소/영역을 선택하고 **✨ 시안 만들기**를 누른다. 상단 **✨ AI 시안**은 보관된 요청을 다시 연다.
2. 자유 텍스트는 선택 사항이다. 선택·이동/삭제·HTML/CSS·주석 초안·추가 설명을 한 기준으로 고정한다. 생성/등록/미리보기는 현재 revision·undo·active/preview 버전을 바꾸지 않는다.
3. **외부 에이전트 · MCP**는 요청 문장을 복사해 대화에 한 번 붙여넣는다. 에이전트는 `list_ai_requests` → `get_ai_context` → `register_ai_candidate`를 사용한다. 앱이 기존 대화를 임의로 깨우는 기능으로 표시하지 않는다.
4. **AI API 직접 호출**은 새 요청 안의 **AI API 연결**에서 API 키·사용 가능한 모델 ID를 등록한다. 키는 실행 중 메모리에만 보관하며 등록 후 입력 필드를 비운다. 코드·주석과 화면 PNG를 OpenAI Responses API에 보낸다. 일반 API 사용량 과금 경로이며 ChatGPT 구독 키를 발급하는 기능이 아니다.
5. 후보 이름·방향을 선택하고 기준과 후보의 실제 HTML 렌더를 같은 배율로 비교한다. 기존 요청은 입력/전달 정보를 접어 미리보기에 공간을 준다. 일부 실패·취소 시 이미 받은 후보는 남긴다.
6. **시안 적용**은 현재 작업을 자동 스냅샷으로 보호하고 한 undo 단계로 적용한 뒤 캔버스로 돌아온다. 모든 완성 후보가 같은 기준의 형제 스냅샷으로 남는다. 원래 기준/선택 후보에서 추가 생성해도 이전 요청을 지우지 않는다.
7. 코드·요청·후보·주석·전체 분기는 IndexedDB와 편집 파일에 보존한다. 오른쪽은 계속 탭 없는 통합 이력이고 최종 개발 전달도 PNG 한 장이다.

## 공통 엔진과 제한

`code-patches.js`는 텍스트(하위 요소 없는 대상), 속성, 인라인 CSS, 공통 stylesheet, HTML 삽입·제거·부모/순서 이동을 검증한다. CSS로 크기·폰트·색상·간격·flex/grid를 바꿀 수 있다. 기존 이동 오프셋은 코드 레이아웃 뒤에 적용한다. 레이아웃을 바꾼 뒤 오프셋을 유지할 필요가 없으면 기존 `apply_edits`의 absolute 0으로 명시적으로 초기화한다.

캡처 HTML은 immutable이고 버전은 선언적 패치만 보관한다. 새 ID는 `a…`, 기존 캡처/복사 ID는 유지한다. 원본 locator를 새 요소의 실제 소스 근거로 위조하지 않는다. 삭제된 대상과 복사 출처의 주석 참조도 남긴다. 검증은 inert DOM에서 완료한 뒤 live iframe을 교체하며 임의 JS·이벤트·외부 CSS URL은 허용하지 않는다. 기존 캡처에 이미 있던 리소스 정책은 유지한다.

현재 한 요청 1~12개(기본 3), 문서당 100개/20MB 요청, 누적 패치 500개/2MB, 스냅샷은 기존 전체 500개 제한이다. API는 선택 요소와 부모·관련 스타일을 먼저 보내며 전체 문맥은 MCP `full_context:true`로 읽을 수 있다. API 응답은 strict JSON schema·stream:true·store:false로 받으며 완료 응답만 패치로 등록한다. 임의 모델 출력을 실행하지 않는다. API는 현재 단일 생성 응답 방식이며 모델이 후보 이미지를 다시 읽고 보정하는 자동 반복 루프는 후속 작업이다.

키는 디스크에 기억하지 않고 모델 입력·문서/스냅샷·MCP·스킬·로그에 포함하지 않는다. 키 삭제는 실행 중 API 요청도 중단한다. 문서 전환/앱 flush는 생성 작업을 취소·정리하고 완료 후보를 보존한다. 재시작 중단은 실패/부분 완료로 표시한다. API 401/403/429, 미완성/과대 응답·취소·저장 오류가 현재 작업을 덮어쓰지 않는다. 다른 결제 경로로 자동 전환하지 않는다.

## MCP 2026과 과거 호환

- 공통 도구는 19개다. 새 도구는 `list_ai_requests`, `get_ai_context`, `create_ai_request`, `register_ai_candidate`, `cancel_ai_request`, `apply_code_patches`다. 후보 등록과 직접 코드 적용을 구별하며 후보 선택 적용은 사용자 UI에서 한다.
- `get_ai_context`는 기준 또는 `candidate_id`의 HTML/CSS/locator를 읽는다. `get_review_image`의 `request_id`+`candidate_id`는 적용하지 않은 후보 PNG를 반환한다. 원본/현재/저장 버전 이미지도 유지한다.
- stdio는 2026-07-28의 `server/discover`, 요청별 `_meta`, `resultType`, serverInfo, 캐시 `ttlMs:0`/private를 구현한다. 초기화로 modern 상태를 기억하지 않는다.
- 명시적 `console-canvas://editors/{id}/ai-requests` 리소스, `subscriptions/listen`의 첫 acknowledged·honored filter·subscriptionId·변경 알림·취소/재구독을 제공한다. 구독은 알림 수신이며 대화 자동 실행을 의미하지 않는다. MRTR/Sampling/Tasks를 사용하지 않는다.
- 2025-11-25 이하 initialize 방식은 별도 호환 경로다. 공식 v1 SDK 검사를 modern 검증으로 보고하지 않는다. 루프백 HTTP는 내부 브리지이며 공개 MCP HTTP endpoint가 아니다.

최신 구현 근거: [공식 MCP 버전/호환](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [구독 규격](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions), [공식 SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions). API 계약은 [OpenAI Docs의 Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)와 [Streaming](https://developers.openai.com/api/docs/guides/streaming-responses)을 확인했다.

## 검증과 남은 작업

- `npm run check`: 타입·포맷·번들·Python 43·Node 33·Chromium 시나리오 360개, standalone/native-area smoke 2개 통과. `tests/ai-variants.js`는 독립 후보·형제 분기·적용/undo·과거/미래·HTML 구조/정제·JSON/DB·취소·저장 실패와 테스트 전용 API UI를 검사한다. `tests/unit/ai-provider.test.mjs`는 고정 endpoint·키 비노출·스트림/부분 실패·취소/401/403/429를 검사한다.
- 격리 앱 `test:desktop:offscreen`: 기존 공식 SDK 22개 + `@modelcontextprotocol/client@2.4.0`으로 pinned 2026-07-28 검사 17개. 후보 등록·재시도·실제 후보 PNG·구독/알림·취소/재구독·코드 적용/undo와 정상 재실행을 확인했다. OS 캡처·사용자 설치 앱 직접 사용의 증빙은 아니다.
- 최종 Chrome 전용 ZIP을 별도 프로필에 설치해 공식 Chrome MCP 1.12.0/Chrome 155의 native WebMCP 검사 62개 통과. 19개 도구·고정 HTML/CSS·세 후보 등록·후보 PNG·재시도·분기·저장 실패/공개 해제를 포함한다. Chrome HTML 문맥은 pending 재조회로 iframe 렌더를 분리하고 이미지 작업은 요청/후보 ID까지 구분한다.
- 별도 가상 웹 문서에서 마우스로 요청 입력→MCP 후보 3개 수신→비교→명시적 적용→undo/redo→형제 그래프→과거/미래 이동을 수행했다. 실제 사용자 문서는 사용하지 않았다.
- API 검사는 가짜 키와 결정적 SSE 응답을 사용하는 **mock**이다. 실제 계정·요금·모델 사용 가능 여부와 완료 추론은 미검증이다. ChatGPT OAuth는 제품 라이선스/배포·계정 자격 및 동의·토큰 검증/갱신/철회 검증이 남아 있어 지원 완료로 표시하지 않는다.
- #36~#44는 부분 진행 상태를 유지한다. 계정 인증/추론·반복 보정·자동 실행·OS/스토어/설치 조건을 이 버전으로 닫지 않는다. 사용자 설치 앱/스킬 배포는 #27에서 별도 수행한다.
