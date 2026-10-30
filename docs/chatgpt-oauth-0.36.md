# ChatGPT 로그인과 앱 내 AI 시안 · 0.36

후속0.37.1에서 검사기의 OS 홈 덮어쓰기·스킬 격리를 수정하고 실제 macOS 암호화/복호화·설치 앱 갱신·기존 자료 보존을 확인했다. 아래0.36 실패는 과거 기록으로 유지한다. 실제 계정 동의/추론 상태는 [최신 배포·검증](deployment-0.37.md)을 따른다.

2026-10-31 · #149(전체) / #150(인증) / #151(UI·생성) / #152(실제 계정·배포 잔여), 기존 #43/#44. FR-41·AC-136~138.

## 조사 결론

OpenAI 공식 문서는 로컬/OSS 도구의 동적 등록·사용자 동의로 ChatGPT 요금제를 사용하는 Responses API 경로를 제공한다. 상용 파트너 client ID 신청과 구별한다. Codex app-server도 선택지지만 이 앱은 선언적 HTML/CSS 패치만 받으면 되므로 공통 Responses 어댑터를 재사용하는 직접 OAuth 경로를 채택했다. 추가 Codex 실행 파일·로컬 도구 실행·다른 앱의 인증 캐시가 필요하지 않다.

- [개요와 적용 범위](https://developers.openai.com/siwc/token-sharing-open-source): 로컬 환경, host ID와 등록의 관계. 유료/원격 서비스는 별도 접근 조건이다.
- [등록·로그인](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): dynamic_agent_client는 첫 진입이며 callback의 issued ID로 교환/재로그인한다. client secret·partner API key를 요구하지 않는 public client 흐름이다.
- [계정·갱신·철회](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions): 계정/워크스페이스별 분리와 회전 refresh token·동시 갱신 직렬화.
- [모델·추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): 계정의 /v1/models 목록 visibility/list와 slug·display_name을 사용하고 /v1/responses의 완료 이벤트를 확인한다.
- [현재 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): store:false/stream:true, 이미지 입력은 모델 지원에 따르며 hosted MCP·이미지 생성 등의 별도 도구는 사용하지 않는다. UI 시안은 생성 이미지가 아닌 검증된 HTML/CSS 패치다.
- [실패와 복구](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery): 동의/계정 자격·한도·미지원·갱신 실패를 구분하며 과금 경로를 자동 변경하지 않는다.

저장소가 공개라는 사실은 OSS 라이선스/상용 배포 자격의 증거가 아니다. 현재 루트 LICENSE가 없어 새 라이선스를 임의 부여하지 않았다. 이번 구현은 개인 로컬 개발·검증 범위이며 공개 배포/계정 적격은 #152에서 확인한다. 문헌의 지원 경로가 사용자 계정의 실제 동의·추론 성공을 보증하지 않는다.

## 사용자 흐름

AI 시안 → AI API 연결 → 직접 호출 인증에서 **ChatGPT 로그인 · 요금제 사용**을 선택한다. **Continue with ChatGPT**는 시스템 브라우저를 열고 앱 등록과 요금제 사용을 요청한다. 승인 뒤 앱에서 계정·허용 모델을 확인하고, 실행 방식을 AI 직접 호출로 선택해 문장/시안 수를 정한 다음 명시적으로 생성한다. 후보를 비교해 사용자가 고른 안만 적용한다.

계정 추가·선택·재로그인·로그인 취소·로그아웃·계정/모델 새로고침과 ChatGPT 사용량/연결 관리 진입을 같은 인증 영역에 둔다. 새 큰 모달을 쌓지 않는다. 로그인은 화면을 시스템 브라우저로 한 번 이동해야 하지만 생성/비교/선택은 앱 안에서 끝난다. UI 웹 미리보기에서는 내장 앱 전용임을 안내하고 로그인/생성 버튼을 비활성화한다. 기존 API 키와 외부 MCP 경로는 별도 선택으로 유지한다.

## 인증·보존 경계

`desktop/chatgpt.cjs`가 공식 discovery에서 인증/토큰/JWKS/철회 주소를 읽고 auth.openai.com 출처만 허용한다. 127.0.0.1의 임시 포트·고정 /auth/callback, 무작위 state/nonce·S256 PKCE, issued ID, RSA 서명·iss/aud/exp/nonce와 복귀 계정 sub를 검증한다. 등록 실패/취소는 활성 계정을 덮어쓰지 않는다.

앱 프로필의 `ai-auth/chatgpt-accounts.enc`는 safeStorage 암호화·0600 임시 파일/rename으로 저장한다. 암호화 가능 플래그에만 의존하지 않고 비밀이 아닌 값의 실제 비동기 암호화/복호화를 먼저 확인한다. 이 OS 검사가 실패하거나 보호 저장소가 없으면 로그인을 차단하고 기기 잠금/키체인 확인·앱 재실행을 안내하며 평문으로 내리지 않는다. stable host UUID, 계정별 issuer/sub/client ID와 암호화된 토큰을 유지한다. 독립 파일 잠금과 직렬 작업으로 여러 앱 인스턴스의 갱신을 조정한다. 중단된 프로세스가 잠금 파일을 남긴 경우 자동으로 잠금을 빼앗지 않고 account_busy로 중단한다. 모든 앱을 정상 종료했음을 확인한 뒤 관리자가 잠금을 정리하는 복구가 필요하다.

로그아웃은 생성/로그인을 취소하고 갱신 세션 철회를 시도한 뒤 로컬 토큰을 비운다. 원격 철회가 확인되지 않으면 ChatGPT 설정의 연결 해제를 안내한다. issued ID/host는 재로그인을 위해 유지한다. 일시적인 네트워크/서비스 오류로 토큰을 지우지 않으며 사용 불능이 확인된 refresh token은 비운다.

`chatgpt-ipc.cjs`는 정확한 editor mainFrame만 허용한다. renderer에는 계정 표시 정보·모델·완료 후보만 전달하고 OAuth URL/토큰을 반환하지 않는다. 원본 웹사이트·복제 iframe에는 로그인 API를 노출하지 않는다. MCP 도구/인증·기존 문서 저장 형식과 사용자의 실제 데이터는 유지한다. 계정과 인증 선택은 실행 중 앱 설정이며 문서의 aiDraft에 비밀을 보관하지 않는다. 제출한 요청에는 비밀이 아닌 authentication 종류만 기록한다.

## 생성과 실패

고정 HTML/CSS·선택/부모·주석/PNG·프롬프트를 각 시안에 사용한다. OAuth 토큰은 main에서만 Authorization 헤더에 붙이고 공식 Responses 스트림을 처리한다. response.completed인 패치만 renderer의 기존 후보 검증/분기 엔진에 넘긴다. 요청을 시작한 계정 ID와 모델은 모든 시안에 고정하고 계정이 달라지면 추론 전에 거절한다. 생성 도중 계정/인증 변경을 차단한다. 상태 조회도 갱신과 같은 큐/잠금을 사용해 회전한 토큰을 덮어쓰지 않는다. 후보를 받는 것과 캔버스 적용은 다르다. 취소 시 늦은 후보를 버리고 이미 등록한 후보는 보존한다.

계정 자격/사용 동의·401/403/429·subscription_sharing 계열 오류·불완전 스트림을 처리한다. HTTP 실패는 상태·오류 코드·요청 ID·본문 형상을 보존하며 민감할 수 있는 원문 본문을 편집 문서에 저장하지 않는다. 자동 API 키 전환이나 재과금 재시도는 없다. 일시 오류는 사용자가 새로고침/재시도를 결정한다. 스크립트/외부 URL 패치는 기존 정제와 공통 엔진 검증을 거친다.

## 검증 기록

최종 `npm run check:all` 종료0:타입/포맷·번들/스킬, Python52·Node75·Chromium916+smoke2, 공식 SDK25+modern SDK17(2026-07-28), 실제 표시 기반 격리 Electron nativeScopes5가 통과했다. 정상 종료/재실행 뒤 문서 이름·주석·전체 스냅샷/휴지통·패널 보존과 원본 무변경도 통과했다. 최종 로그는 Git 제외 `local/oauth-036/check-all-stable.log`다. 의도한 잘못된 URL 거절은 stderr에 보존했으며 offscreen 대체 실행은 하지 않았다.

신규 Node20개는 실제 RSA·127.0.0.1 callback·PKCE/nonce/ID 검증·계정/보호 파일·갱신/철회·두 인스턴스/상태 조회 직렬화·생성 계정 고정·시안 순번/방향·불완전/한도·스트림 취소·정확한 IPC 프레임·실제 암호화 probe 실패를 검사한다. 신규 Chromium17개는 로그인 대기/취소·권한 부족·모델·코드/PNG·세 후보/고정 기준·무적용·재열기·한도/부분 보존·파일 비노출·720px/단일 모달을 검사한다.

실제 격리 앱 결과는 `chatgptIpc:true`, **`chatgptProtectedStorage:false`**다. 현재 OS/격리 프로필에서 실제 암호화를 사용할 수 없어 로그인은 차단된 상태다. 이 결과는 암호화 성공이나 실제 계정 연결 성공이 아니다. 실제 설치 프로필의 키체인/저장소·OAuth 동의/계정 모델·추론은 #152에서 확인해야 한다.

직접 사용은 localhost54256의 QA 가상 NORTH에서1280px 인증 선택/생성 비활성·Continue 대기/취소·API 키 과금 표시로 전환·ChatGPT 복귀,720×600 키보드 탐색과 최종 화면이다. 가상 인증 화면의 QA 안내를 유지했고 실제 로그인이나 유료 호출을 하지 않았다. 캡처는 `chatgpt-settings-final.png`, `chatgpt-settings-720.png`다. 실제 사용자 자료·설치 앱0.34/개인 스킬은 변경하지 않았다.

중간 전체 실행은 웹/SDK 경로 통과와 별개로 격리 OS 저장소의 실제 비동기 암호화 실패로 종료1이었다(`check-all-final.log`). available 플래그만 true인 상태를 사용 가능으로 표시하지 않도록 시작 시 실제 roundtrip 검사를 추가했다. 가상 OS의 true/실패와 정상 roundtrip을 회귀 검사하고, 실제 격리 결과의 chatgptProtectedStorage 값을 별도로 기록한다. 이 환경 조건을 실제 OAuth 계정 동의/추론 성공으로 보고하지 않는다. 이전 미래 OAuth 문구를 기대하던 UI 검사와 인증 종류를 요청 복사본에만 붙였던 새 검사 실패도 수정했다. 실패 로그를 지우지 않는다. 실제 사용자 계정 로그인/동의·추론·공개 배포 자격은 미검증이며 #152를 열어 둔다. 가상 RSA 키·localhost callback·mock HTTP/SSE/가상 모델을 실제 OpenAI 계정 성공으로 보고하지 않는다. 사용자 설치 앱/프로필/개인 스킬 배포는 #27과 구별한다.
