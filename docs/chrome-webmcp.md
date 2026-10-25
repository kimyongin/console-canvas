# Chrome 확장과 에이전트 연결 · 0.20

확장 단독 편집에는 Node·Python·별도 호스트가 필요 없다. `npm run build`가 만드는 `dist/console-canvas-chrome.zip`을 풀고 Chrome 확장 관리의 개발자 모드에서 `console-canvas` 폴더를 로드한다. 원하는 HTTP/HTTPS 페이지에서 확장 버튼을 누르면 복제본 편집기를 연다. 원본 화면은 수정하지 않는다.

현재는 개발자용 압축 해제 배포다. Chrome 웹 스토어에 게시하거나 승인받은 상태가 아니다. 확인한 환경은 macOS Apple Silicon, Chrome **155.0.8059.85**, 공식 Chrome DevTools MCP **1.12.0**의 격리 headless 프로필과 `--enable-features=WebMCP`다. 이 조합을 최소 지원 버전이나 일반 창 검증 완료로 해석하지 않는다. WebMCP가 없어도 일반 편집은 사용할 수 있다.

## 공식 MCP 설정과 사용

에이전트 측에는 Node 22.12 이상과 공식 Chrome DevTools MCP가 필요하다. 아래는 재현 검사와 같은 별도 Chrome을 여는 설정 예다. 실제 Chrome 실행 파일과 압축 해제 폴더의 절대 경로를 넣는다. 개인 Chrome에 자동으로 연결하는 설정은 사용하지 않는다.

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y", "chrome-devtools-mcp@1.12.0",
        "--headless", "--isolated",
        "--categoryExtensions", "--categoryExperimentalWebmcp",
        "--executablePath=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "--chromeArg=--enable-features=WebMCP",
        "--filesystemRoot=/absolute/path/to/unpacked-extension",
        "--no-usage-statistics", "--no-performance-crux"
      ],
      "env": {
        "CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY": "1",
        "CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS": "1"
      }
    }
  }
}
```

공식 `install_extension({path:"/absolute/path/to/unpacked-extension/console-canvas"})`으로 별도 프로필에 설치하고 `new_page`로 사이트를 연 뒤 `trigger_extension_action({id})`을 실행한다. 확장 편집기 탭에서 **에이전트 연결 → Chrome WebMCP → 도구 공개**를 누른다. headless QA에서는 공식 UI 도구로 이 버튼을 클릭할 수 있다. 일반 Chrome 창의 설치/승인·입력 검사는 #33에서 별도로 추적한다. 에이전트 설정 등록과 문서 도구 공개는 서로 다른 단계다.

1. `list_pages`로 `chrome-extension://…/editor.html` 페이지 ID를 찾는다.
2. `list_webmcp_tools({pageId})`로 13개 `console_canvas_…` 도구를 조회한다.
3. `execute_webmcp_tool({pageId,toolName:"console_canvas_get_agent_guide",input:"{}"})`로 최신 가이드를 받는다. 캡처 전에도 공개하면 읽을 수 있다.
4. `console_canvas_list_screens` → `get_screen` → `list_elements`/`list_comments`로 대상과 최신 revision을 확인한다. `execute_webmcp_tool`의 `input`은 JSON **문자열**이다. 응답 `output`의 JSON을 읽는다.
5. `console_canvas_apply_edits`에 `editor_id`, `expected_revision`, 고유 `operation_id`, `operations`를 전달한다. 같은 계약의 `undo`로 취소하고 실제 요소·이력·`persisted`를 재조회한다. 스킬의 공통 편집 절차를 따른다.

등록 후 표시는 **공개 중 · 실제 호출 대기**, 도구 실행 후에는 **호출 확인 · 도구 · 시각**이다. 공개 해제·문서 전환·닫기·새로고침 시 도구 접근을 철회한다. 적용된 편집·자동 저장 데이터는 유지한다. 토글이 공식 Chrome MCP의 다른 브라우저 도구 권한까지 제한하는 것은 아니다.

## 이미지 전달

`console_canvas_get_review_image`는 현재 작업 또는 `snapshot_id`의 화면·번호·하단 요청 카드가 담긴 PNG를 만든다. 처음 `pending:true`면 같은 인수로 다시 조회한다. 완료 시 반환된 `preview_url`을 `new_page`로 열고 이미지 로딩을 기다린 뒤 `take_screenshot({pageId,fullPage:true})`를 호출한다. 파일 경로를 지정하지 않으면 공식 MCP의 `image/png` 콘텐츠를 받는다. **반환된 정확한 URL의 새 탭 ID**를 사용한다. 여러 미리보기 중 첫 탭을 재사용하지 않는다.

미리보기는 로컬 blob으로 5분 또는 편집기 탭 종료 시 만료된다. 클라우드 업로드는 없다. PNG 생성 한도는 20MiB다. Chrome MCP/에이전트의 스크린샷 크기 제한도 별도로 적용될 수 있다. 긴 이미지는 클라이언트가 축소할 수 있으므로 번호·카드 문구를 읽을 수 있는지 확인한다. 렌더 중 revision이 바뀌면 최신 상태로 재요청한다. 조회는 선택·편집·active/preview·revision·이력을 바꾸지 않는다.

## 오류와 갱신

- 미지원/등록 오류: API 존재와 실제 등록 성공은 다르다. 위 검증 환경과 기능 설정을 확인한다. CSP·sandbox·webSecurity를 끄지 않는다. 일반 편집/PNG 저장은 계속 사용할 수 있다.
- 도구 없음: 올바른 편집기 탭인지, 명시적으로 공개했는지 확인한다. 새로고침·문서 전환 후에는 다시 공개한다.
- `revision_conflict`/`editor_busy`: 사람 입력이 끝난 후 최신 상태를 조회한다. 실패를 적용 완료로 보고하지 않는다.
- `operation_id_reused`: 같은 ID에 다른 내용을 넣지 않는다. 최근 200개 결과는 같은 페이지의 공개 해제/재공개에도 유지한다. 이전 editor_id는 새로고침 후 거절된다. 결과가 불명확하면 먼저 상태를 확인한다.
- `persisted:false`: 편집 적용과 기기 저장 성공은 다르다. 파일로 백업하고 저장 오류를 해결한다. 스냅샷 복원 저장 오류는 롤백한다.

live guide는 번들 스킬의 최신 내용을 읽으며 파일을 설치하지 않는다. 스킬 ZIP의 설치/갱신은 에이전트 환경에서 별도로 한다. Chrome 확장이 설치된 스킬 폴더를 자동 수정하지 않는다. 독립 앱의 기존 스킬 자동 동기화·로컬 MCP는 유지한다.

## 패키지·자료 보존과 배포 준비

- `console-canvas-chrome.zip`: 공개 편집기·수집·가이드만 포함한다. Python·Electron 구현은 제외한다. `dist/chrome-package.json`에 버전·ZIP SHA-256·공통 자산별 체크섬을 기록한다.
- `console-canvas-extension.zip`: 기존 스킬 helper/독립 앱용 전체 런타임이다. Chrome 전용 ZIP과 구별한다.
- 개발용 압축 해제 확장은 **같은 폴더 경로**를 유지하고 새 파일로 교체한 뒤 새로고침한다. ID가 달라지면 별도 IndexedDB다. 이전 설치를 제거하거나 새 경로를 로드하기 전 문서별 편집 JSON을 저장한다. 스토어 ID/서명 키는 스토어 채널 준비 때 확정하며 비밀 키를 저장소에 넣지 않는다.
- 문서 이동은 **문서명 → 편집 파일 저장/열기**다. 현재 편집·주석·추가 설명·이력·전체 분기/휴지통을 포함한다. 앱/확장 전체 프로필·로그인·다른 문서는 자동 이전하지 않는다. 같은 ID 업데이트와 앱↔확장 실제 JSON 왕복의 최종 검증은 #35에 남아 있다.

스토어 설명 초안: “현재 웹 화면을 소스 없이 복제하여 배치·삭제·주석과 분기 스냅샷으로 개선안을 만들고, 번호와 요청 카드가 담긴 PNG 한 장으로 전달합니다. 선택하면 에이전트가 공개한 복제본을 편집할 수 있습니다.”

권한 설명: `activeTab`/`scripting`은 사용자가 확장 버튼을 누른 탭의 화면 수집, `storage`/`unlimitedStorage`는 로컬 문서·세션 보관, `http://127.0.0.1/*`은 선택적인 기존 로컬 MCP 연결이다. 우리 코드에 원격 분석/AI API 업로드는 없으며 사용자가 연결한 에이전트·공식 MCP의 접근 범위는 별개다. 페이지 문구·입력·이미지가 캡처에 포함될 수 있고 비밀번호는 제외한다. 게시 전 실제 일반 Chrome·리소스/권한·동일 ID 업데이트와 스토어 제출 자산을 검증해야 한다.
