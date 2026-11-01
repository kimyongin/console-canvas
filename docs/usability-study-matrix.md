# 25개 실제 티켓 · 검증 매핑

후속: [0.51.1 동등 조건25개 재측정](cleanup-0.51.1.md). 아래는 원래 구현 티켓/당시 비동등 계수의 역사 기록이다. 새 시험은 별도 저장소·별도 티켓으로 수행했으며 원래25개 목표를 바꾸지 않았다.

2026-11-01 · 별도 브라우저 저장소의 가상 시험 자료다. 설치 앱의 사용자 티켓과 구별한다. 아래25개는 UI로 생성했고 최신 공식 SDK로 다시 조회했다. 모든 goal_id는 착수 당시 값과 같고 review(검토 대기)다. 사람 승인은 실행하지 않았다.

| 회차 | 사례 | 실제 ID | 목표/현재 주석 | 실제 소스 | 기록된 기준선 조작 | 재사용 검사 조작 |
| --- | --- | --- | --- | --- | --- | --- |
| I1 | DASH-1 | CC-3 (94867e36) | 같은 goal / 주석1 | [소스](../samples/ux-study/dashboard/) | 라벨 분리 미확정 | 15 |
| I1 | DASH-2 | CC-4 (0abab10c) | 같은 goal / 주석1 | [소스](../samples/ux-study/dashboard/) | 라벨 분리 미확정 | 15 |
| I1 | DASH-3 | CC-5 (9514aefe) | 같은 goal / 주석1 | [소스](../samples/ux-study/dashboard/) | 라벨 분리 미확정 | 15 |
| I1 | DASH-4 | CC-6 (df256a62) | 같은 goal / 주석1 | [소스](../samples/ux-study/dashboard/) | 라벨 분리 미확정 | 15 |
| I1 | DASH-5 | CC-7 (612c1cdf) | 같은 goal / 주석1 | [소스](../samples/ux-study/dashboard/) | 라벨 분리 미확정 | 15 |
| I2 | SHOP-1 | CC-14 (63774689) | 같은 goal / 주석1 | [소스](../samples/ux-study/shop/) | 부분 0 | 4 |
| I2 | SHOP-2 | CC-15 (6bdc3e94) | 같은 goal / 주석1 | [소스](../samples/ux-study/shop/) | 부분 0 | 4 |
| I2 | SHOP-3 | CC-16 (e9b08753) | 같은 goal / 주석1 | [소스](../samples/ux-study/shop/) | 부분 0 | 4 |
| I2 | SHOP-4 | CC-17 (1abd4e86) | 같은 goal / 주석1 | [소스](../samples/ux-study/shop/) | 부분 4 | 4 |
| I2 | SHOP-5 | CC-18 (a3212cfc) | 같은 goal / 주석1 | [소스](../samples/ux-study/shop/) | 부분 11 | 4 |
| I3 | BOARD-1 | CC-19 (3488eb20) | 같은 goal / 주석1 | [소스](../samples/ux-study/board/) | 15 | 4 |
| I3 | BOARD-2 | CC-20 (9be6939b) | 같은 goal / 주석1 | [소스](../samples/ux-study/board/) | 16 | 4 |
| I3 | BOARD-3 | CC-21 (e8656060) | 같은 goal / 주석1 | [소스](../samples/ux-study/board/) | 15 | 4 |
| I3 | BOARD-4 | CC-22 (03c103dd) | 같은 goal / 주석1 | [소스](../samples/ux-study/board/) | 15 | 4 |
| I3 | BOARD-5 | CC-23 (72576418) | 같은 goal / 주석1 | [소스](../samples/ux-study/board/) | 16 | 4 |
| I4 | BOOK-1 | CC-24 (21bdc438) | 같은 goal / 주석1 | [소스](../samples/ux-study/booking/) | 16 | 18 |
| I4 | BOOK-2 | CC-25 (c43337fc) | 같은 goal / 주석1 | [소스](../samples/ux-study/booking/) | 16 | 11 |
| I4 | BOOK-3 | CC-26 (e7164aee) | 같은 goal / 주석1 | [소스](../samples/ux-study/booking/) | 15 | 11 |
| I4 | BOOK-4 | CC-27 (dc2e28b2) | 같은 goal / 주석1 | [소스](../samples/ux-study/booking/) | 15 | 11 |
| I4 | BOOK-5 | CC-28 (0e71d308) | 같은 goal / 주석1 | [소스](../samples/ux-study/booking/) | 16 | 11 |
| I5 | CMS-1 | CC-39 (63ef5417) | 같은 goal / 주석1 | [소스](../samples/ux-study/cms/) | 16 | 11 |
| I5 | CMS-2 | CC-40 (6bc8c68d) | 같은 goal / 주석1 | [소스](../samples/ux-study/cms/) | 16 | 11 |
| I5 | CMS-3 | CC-41 (a9af4ad8) | 같은 goal / 주석1 | [소스](../samples/ux-study/cms/) | 15 | 11 |
| I5 | CMS-4 | CC-42 (1da76bc9) | 같은 goal / 주석1 | [소스](../samples/ux-study/cms/) | 15 | 11 |
| I5 | CMS-5 | CC-43 (4a0c1bbe) | 같은 goal / 주석1 | [소스](../samples/ux-study/cms/) | 16 | 14 |

## 계수의 해석

표는 저장된 실제 조작 로그의 행 수다. 클릭/메뉴/입력/링크 이동을 각1로 기록했고 클릭과 그 결과 전환을 중복 더하지 않았다. 사진/AX 조회·SDK 도구 호출·개발 코드 편집은 사람 조작 횟수에 넣지 않았다. 원본 사이트 준비·MCP 최초 연결·파일 선택·중간 복구·사본 정리는 본문 실행 기록과 별도 로그에 있다. 전체 사용자 여정의 빠짐없는 총수로 해석하지 않는다.

I1 초기 로그 라벨은 준비 비용과 사례가 섞였고 I2 초기 일부는 도구 시간 제한으로 소실됐다. 나머지도 기준선은 생성/편집/확정, 재실행은 저장 편집/주석 재사용이라 완료 조건이 다르다. 이 수치를 서로 빼거나 평균 감소율을 만들지 않는다. 정확히 비교 가능한 이름 변경4→3, 목표 확정 후 캔버스 복귀3→2는 별도 하위 경로다. 모든 시나리오의 동일 조건 전후 총수는 남은 검증 항목이다.

## 재현 근거

기준 소스8c30475, 회차별 제품/소스 커밋3fa274c·31b0e76·52ab6df·9a06dd1과 I5 최종 커밋. 실제 수집은 scripts/capture-study.cjs, 실제 저장 티켓 SDK 조회/상태 기록은 scripts/study-agent.mjs로 재현한다. UI 생성은 이 스크립트가 하지 않는다. 사적 사진·토큰·브라우저 저장 자료는 ignored local/ux-study에 있고 저장소에 올리지 않는다.
