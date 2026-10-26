# AI 시안 실행 경로 조사 · 최신 MCP 기준

조사일 2026-10-26 · [#37](https://github.com/kimyongin/console-canvas/issues/37) · [시안 계획](ai-variants-plan.md)

## 기준과 결론

공식 `/specification/latest`가 **2026-07-28**로 연결되는 것을 확인했다. 이 확정 버전을 조사 기준으로 고정하며 draft·제안 SEP·2025년 규격과 구분한다. 이전 계획의 2025-11-25 Sampling 인용은 과거 호환 참고이며 신규 설계의 근거로 사용하지 않는다. [최신 규격](https://modelcontextprotocol.io/specification/latest)

**다중 UI 시안 생성은 유지하되 MCP Sampling에 신규 의존하지 않는다.** 최신 규격은 Sampling을 deprecated로 지정하며 신규 채택을 권장하지 않는다. 아직 삭제된 기능은 아니고, 최소 유예 기간과 실제 제거 시점도 구별해야 한다. [현재 Sampling 규격](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling), [deprecated 목록](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)

**푸시는 남아 있지만 구독한 변경 알림이다.** 실제 에이전트 작업 시작은 클라이언트의 별도 처리다. 따라서 연결만으로 대기 중 채팅이 깨어난다고 약속하지 않는다. 신규 구현은 요청 저장/조회·독립 후보·사용자 선택을 중심에 두고, 실행 경로는 수동 전달·지원되는 외부 작업 API/실행 어댑터로 분리한다.

## 최신 규격의 주요 차이

| 항목 | 2026-07-28 기준 | Console Canvas 영향 |
| --- | --- | --- |
| 발견/버전·capability | `server/discover`, 요청마다 `_meta`의 버전·클라이언트 capability | 기존 initialize 성공을 최신 준수로 보고하지 않는다. 현대/과거 프로토콜 어댑터를 구분 |
| 변경 알림 | `subscriptions/listen`에 원하는 종류/리소스를 지정하고 acknowledged 필터·subscriptionId 확인 | `resources/subscribe`나 HTTP GET SSE를 새 설계의 기본으로 삼지 않음 |
| 서버→클라이언트 요청 | 독립 JSON-RPC 요청 대신 MRTR `input_required` 응답과 클라이언트의 재요청 | Sampling/elicitation을 임의의 idle 깨우기 요청으로 보내지 않음 |
| Sampling | Deprecated. 신규 채택 비권장, 기존 지원은 유예 기간에 존속 | 제품의 여러 시안 생성과 프로토콜 Sampling을 분리 |
| HTTP 생명주기 | GET 스트림·프로토콜 세션·Last-Event-ID 재전송 제거 | 요청/후보 ID·중복 방지·재조회/재구독을 애플리케이션에서 설계 |
| 결과/장기 작업 | `resultType`, MRTR; Tasks는 별도 공식 extension으로 이동 | 과거 tasks/result 등을 그대로 최신 계약으로 사용하지 않음. 지원 확장과 요청 수명 확인 |

[공식 변경 기록](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr), [HTTP 전송](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

구독 규격은 클라이언트의 명시적 필터, 첫 acknowledged 알림, 이후 subscriptionId 연결을 요구한다. 재연결 시 다시 구독해야 한다. 표준 종류는 목록 변경/리소스 갱신이며 임의의 사용자 채팅 메시지 주입을 정의하지 않는다. docs 사이트의 해당 페이지 접근 실패로 공식 저장소의 동일 버전 원문을 확인했다. [공식 구독 원문](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/patterns/subscriptions.mdx), [stdio 규격](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)

## 설치본 읽기 전용 실험

`experiments/agent-trigger/probe.mjs`는 실제 프로젝트 어댑터를 별도 프로세스에서 호출하고, 공식 설치 SDK로 초기화/도구 메타데이터를 조회한다. 브리지를 시작하지 않도록 stdio 진입점에 가상 연결만 주입한다. Chrome MCP는 격리 설정으로 메타데이터만 조회하며 브라우저 도구를 호출하지 않는다. 결과는 Git 제외 `local/agent-trigger/installed-report.json`에 남는다.

| 대상 | 실제 결과 | 판단 범위 |
| --- | --- | --- |
| 프로젝트 SDK 1.32.2 | `LATEST_PROTOCOL_VERSION=2025-11-25`; 지원 버전에 2026-07-28 없음 | 현재 SDK 검사를 최신 규격 검증으로 사용할 수 없음 |
| Console Canvas 0.20 stdio | 현대 `server/discover`에 initialize 필요 오류; 과거 initialize 후 2025-11-25·tools.listChanged=false·13개 도구 | 과거 프로토콜 구현. 최신 발견/구독 미구현 |
| Console Canvas 구독 | `subscriptions/listen`에 -32601 Method not found | 현재 서버에서 최신 푸시 경로 사용 불가 |
| Chrome DevTools MCP 1.12.0 | 공식 SDK 조회: tools.listChanged=true·logging·39개 도구, resources capability 없음 | 서버의 도구 목록 변경 지원. 확장 요청 리소스 푸시나 모델 깨우기 증빙은 아님 |
| 로컬 Codex CLI 0.147.0 | help와 생성 JSON schema에서 turn/start·turn/interrupt·mcpServerStatus/list 존재 확인 | 설치 CLI의 app-server 제어 API 형태 확인. 실행/인증/대화 재사용은 미검증 |

현재 연결된 Codex 데스크톱 호스트의 capability/구독 수신은 이 실험에서 확보하지 못했다. CLI 스키마·공식 MCP 서버 정보로 그 지원을 추정하지 않는다. 새 모델 turn·개인 채팅 메시지·로그인 정보 조회·사용자 브라우저/문서 조작은 수행하지 않았다.

OpenAI Docs에는 app-server의 thread/resume·turn/start·진행 이벤트·interrupt가 문서화되어 있다. 이는 앱이 제어하는 실행 어댑터의 후보이며 임의의 이미 열린 데스크톱 채팅을 외부에서 제어할 수 있다는 증거는 아니다. [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)

## 구현 방향과 남은 실험

1. #38의 요청 ID/고정 기준과 수동 한 번 전달을 먼저 구현한다. 연결이 과거 버전이면 그 버전의 명시적 호환 경로로 제공하고 최신 지원이라고 표시하지 않는다.
2. #40에서 도구 확장과 함께 현대 발견/요청 메타데이터/결과·구독 계약 및 현대 SDK 검증 경로를 설계한다. 프로토콜 버전 문자열만 올리거나 기존 루프백 브리지를 Streamable HTTP라고 부르지 않는다.
3. 자동 실행은 실제 호스트가 구독·acknowledge·수신·모델 작업 시작을 각각 지원하는지 별도 QA에서 확인한다. 불가 시 수동 전달 또는 공식 외부 작업 API/CLI·SDK 어댑터를 사용한다.
4. 다중 시안은 같은 기준의 HTML/CSS 후보를 에이전트가 생성·이미지 확인·등록하는 애플리케이션 흐름으로 구현한다. deprecated Sampling은 신규 핵심 경로에서 제외한다.

남은 조건은 현대 SDK/서버 구독 실험, 실제 호스트 idle/진행 중/재연결 수신과 작업 시작, 별도 실행 어댑터의 실제 인증/모델 turn·취소, 수동 요청→후보 반환이다. #37은 아직 완료하지 않는다. 이번 결과로 자동 연결이 모든 에이전트에서 불가능하다고 단정하지 않는다.

## 0.21 구현 후속 · 2026-10-26

위 설치본 표는 0.20 시점의 역사적 실험이다. 후속에서 공식 SDK v2 `@modelcontextprotocol/client@2.4.0`을 개발 의존성으로 추가하고 stdio를 dual-era로 구현했다. pinned 2026-07-28 연결의 발견·요청별 메타데이터·캐시 메타데이터·명시적 AI 요청 리소스·subscriptions/listen acknowledged/알림·취소/재구독·후보 등록/이미지와 직접 패치/undo 및 live guide 17개를 통과했다. 기존 v1 SDK 22개는 과거 호환 증빙으로 구별한다. [공식 v2 버전 정책](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions), [구현 기록](ai-variants-0.21.md).

이는 서버→클라이언트 알림이 실제로 도착한다는 증빙이며 기존 임의 에이전트 채팅을 깨우는 증빙은 아니다. 제품은 API 직접 호출과 외부 에이전트 요청 문장 복사를 제공한다. 폐기 예정 Sampling을 신규 의존으로 채택하지 않는다.
