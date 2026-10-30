# 시나리오 사용성 후속 · 0.28.0

2026-10-30 · 상위 [#92](https://github.com/kimyongin/console-canvas/issues/92) · 기준 [0.27 검토](scenario-ux-audit-0.27.md).

14개 UI·UX와 검사기 결함1개를 구현했다. 기존 사용자 자료·설치 앱·설치 스킬은 변경하지 않았다. 실제 편집은 가상 NORTH와 별도 localhost/임시 프로필에서만 수행했다.

## 티켓과 구현

| 항목/티켓 | 구현과 증빙 |
| --- | --- |
| UX-01 [#93](https://github.com/kimyongin/console-canvas/issues/93) | 중앙 컨테이너 너비에 따른 필수 undo/redo·스냅샷·더보기 배치. 좁은 창에서 붙여넣기/AI/집중 보기를 더보기로 제공하고 실행 뒤 닫음. 빈 문서에서는 비활성화. 720px 실제 hit-test 회귀,850px 직접 hit-test와1280px 직접 화면 확인. |
| UX-02 [#94](https://github.com/kimyongin/console-canvas/issues/94) | 전체 카드 범위를 포함한 맞춤/실제 크기·스크롤 안내. 작은 2-lane 분기는 자동 맞춤, 명시적으로 선택한 실제 크기는 재열기/이름 변경 뒤 유지. 분기 ID/높이 선호 보존. 5노드 A→B→C/A→D 카드 가시성 회귀·직접 사용. |
| UX-03 [#95](https://github.com/kimyongin/console-canvas/issues/95) | 선택 도구의 안전 상단을 수집/원본 비교 캡션 아래로 제한하고 너비 제한/줄바꿈 적용. 손잡이·Home/키 이동과 원본 편집 불변 유지. 실제 사진 유무와 무관한 캡션 사각형 비겹침 회귀. |
| UX-04 [#96](https://github.com/kimyongin/console-canvas/issues/96) | 문서 메타데이터에 activeSnapshotName을 별도로 저장. 기존 자료는 세션의 기준을 읽기 전용으로 보완. 빠른/전체 문서 목록에 작업 기준과 최근 저장 버전을 구분. C 기준/D 최신 저장 회귀. |
| UX-05 [#97](https://github.com/kimyongin/console-canvas/issues/97) | 삭제 주석 경고와 원본 유지/편집·이번 이미지에서만 제외. 삭제 요청은 계속 전달. 전달에서 연 구현 검토도 같은 제외 기준으로 동결. 새 전달은 임시 제외 초기화, 빠른 복사 충돌은 전달 검토로 이동. 원본 주석·삭제·검토 일치 회귀·직접 사용. |
| UX-06 [#98](https://github.com/kimyongin/console-canvas/issues/98) | 직접 native 선택 경로 유지, 캡처 시각/너비·목표 문서명 표시. 선택적 미리보기 목록은 sandboxed lazy 썸네일과 명시적 선택. 과거 너비 누락은 추정하지 않으며 모든 캡처를 미리 읽지 않음. 실제 결과 선택·썸네일/metadata 회귀. |
| UX-07 [#99](https://github.com/kimyongin/console-canvas/issues/99) | 스냅샷 미리보기 전체/너비/100%/변경 위치 확대. 주 편집기의 기존 너비 맞춤 이름 명확화·좁은 창에서도 접근. iframe 실제 렌더 너비/버전은 불변. 기존 작은 창 미리보기 공간 회귀·직접 너비 확대. |
| UX-08 [#100](https://github.com/kimyongin/console-canvas/issues/100) | 비교 진입 시 그래프 문서/세대/선택/스크롤 저장. 닫을 때 동일 조건이면 그래프와 초점 복귀. 새 문서에는 재개하지 않음. 실제 비교 닫기 복귀·변경/이름/분기 보존 회귀. |
| UX-09 [#101](https://github.com/kimyongin/console-canvas/issues/101) | 선택 도구에 이름·종류·부모 경로와 상위 요소 선택. 세부/수정키 선택 기준은 유지. 상위 선택 실제 ID와 주석 대상 확인 회귀·직접 사용. |
| UX-10 [#102](https://github.com/kimyongin/console-canvas/issues/102) | 기록 생성 시 불변 원본과 copy descriptor로 사라진 복사본의 읽기 쉬운 이름을 복원. 기존 raw n-ID는 이전 요소/현재 없음으로 표시. 원본 식별/이력/undo는 유지. 묶음 붙여넣기 undo 뒤 이름 회귀. |
| UX-11 [#103](https://github.com/kimyongin/console-canvas/issues/103) | 모든 가지 범위를 명시하고 이벤트마다 기준 스냅샷·현재 작업 경로/다른 경로 표시. 전후 값·그룹/필터·가지/원본 상태 무변경. 분기 경로 회귀. |
| UX-12 [#104](https://github.com/kimyongin/console-canvas/issues/104) | 판정 취소 결과의 요청 번호/복원 상태와 메모 보존을 표시. 활성 다음 요청·캔버스를 자동 변경하지 않음. 직접 판정/취소와 상태 안내 회귀. |
| UX-13 [#105](https://github.com/kimyongin/console-canvas/issues/105) | API 설정을 작성 폼 뒤로 배치하고 명시적 키·모델 설정 버튼으로 열기/초점 이동. 미등록 생성 차단·별도 과금 안내·새 폼 프롬프트 초점 유지. 720px 직접 사용과 기존 AI52개 회귀. |
| UX-14 [#106](https://github.com/kimyongin/console-canvas/issues/106) | 미연결일 때 연결 끊기 비활성화/이유 표시. 서버 연결/최근 에이전트 통신 구분 유지. 미연결 입력 초점·버튼 유효성 회귀. |
| T-01 [#107](https://github.com/kimyongin/console-canvas/issues/107) | 네이티브 자식 프로세스 stdout과 stderr 분리. JSON은 stdout만 해석, 진단은 계속 출력·실패 문맥 보존. stderr+정상 JSON/비정상 종료/잘못된 JSON 실제 프로세스 회귀3개 및 check:all 전체 통과. |

## 검증 결과

- 최종 `npm run check:all` 종료 코드0: 타입·포맷·번들/스킬, Python45·Node52·Chromium605+smoke2, 실제 격리 Electron/공식 SDK25+현대 SDK17(2026-07-28), nativeScopes5 통과. 새 audit-fixes22개와 프로세스3개를 포함한다.
- 재현 검사는 실제 중심 hit 영역·가시 카드 전체·C 기준/D 최신 저장·삭제 주석 원본/검토 동결·이름 보존·결과 썸네일/시각/너비·판정 취소 피드백을 확인한다. 기존 주석/복사/분기/파일/저장 실패/휴지통/정상 재실행 회귀도 통과했다.
- 브라우저 직접 사용:720px 더보기/집중 보기,850px 필수 버튼 hit-test,1280px 선택 이름/부모와 주석·삭제·전달 제외, A→B→C/A→D 그래프 저장/너비 미리보기/비교 닫기 복귀, 문서 이름/재열기/두 문서, 결과 시각/1360px/미리보기 선택·판정/취소 안내,720px API 작성/미등록 생성 차단을 확인했다. 실제 유료 호출은 하지 않았다.
- skill-creator quick_validate 통과. PRD FR-33/AC-87~101·README·앱 제공 스킬/같은 가이드·124개 런타임 자산을 갱신했다. MCP19개 도구·revision/operation_id 계약은 유지한다. 공식 SDK가 새 번들 가이드도 읽었다.
- 네이티브 실패 처리 시험은 고의로 about:blank 수집을 거절하므로 예상 HTTP/HTTPS 오류가 stderr에 나온다. 이 진단을 숨기지 않으면서 stdout JSON을 올바르게 해석하고 실제 실패는 계속 전파한다.

로그·가상 화면은 Git 제외 `local/ux-028/`에 있다. `branch-final.png`, `narrow-final.png`, `selection-final.png`, `handoff-conflict-final.png`, `ai-narrow-final.png`, `result-picker-final.png`, `review-final.png`를 보관한다. 일부 초기 직접 사용 화면 뒤에는 선택 도구 폭·더보기 닫기/빈 문서 상태를 추가로 정리하고 최종 전체 검사를 통과했다.

## 보호 계약과 남은 경계

- 그래프 맞춤/확대·비교·목록·이력 조회는 실제 버전 이동이 아니다. 현재/미래/평행 분기·휴지통·원본 식별자를 제거하지 않는다. 높이/패널 설정은 사용자 선택을 보존한다.
- 전달 주석 제외는 이번 전달에만 적용하며 메모리의 임시 선택이다. 편집 JSON과 MCP의 저장 주석은 그대로다. 제외 뒤 그 전달 화면에서 연 검토에는 동일한 주석 기준이 동결된다. 전달을 새로 열면 원본 주석이 다시 기본으로 포함된다.
- 구현 결과의 과거 메타데이터에 너비가 없으면 ‘—px’로 표시하며 선택 후 실제 비교 너비를 확인한다. 임의의 추정값이나 자동 최신 결과 적용을 하지 않는다.
- 사람 다수의 속도/오류율 연구·모든121개 실제 완주·실제 IME/스크린리더·유료 AI/외부 대화 전송·사용자 OS 업데이트/설치 교체는 이번 완료 범위가 아니다. 기존 부분 검증15개가 이 작업으로 전부 완료된 것은 아니다. 설치 배포는 [#27](https://github.com/kimyongin/console-canvas/issues/27)에서 별도로 추적한다.

UI 변경의 종료는 [변경별 검증 기준](validation-policy.md)에 따른다. 클릭 수를 줄이기 위해 사용자 확인·의도·원본 보존을 생략하지 않는다.

