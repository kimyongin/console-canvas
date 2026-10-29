# 미검증 페이지 일반화 검토 · 0.24.2

2026-10-29 · #68/#69 · FR-01/10/11 · AC-67 부분 검증

## 결론과 검사 방법

기존 사이트 전용 분기는 발견하지 않았다. 수정 전 0.24.1 커밋 `58e8901`의 수집 모듈 SHA-256과 최초 10개 URL을 먼저 기록하고 기존 목록에 없던 페이지를 실제 내장 Chromium·제품 Chrome 확장으로 가져왔다. 이전 시험 사이트 이름/도메인과 URL 조건·selector를 검토했다. URL 조건은 원본 동일성·프레임 대응·스크롤 복원이며 사이트별 좌표/ID로 바꾸는 처리는 없었다. 일반 header/nav·겹침·픽셀/시간 한도 같은 휴리스틱은 남아 있으므로 이 감사만으로 모든 페이지 호환성을 보장하지 않는다.

초기 10개 도메인에 shadcn·Hacker News·의회도서관·Debian을 추가해 총 **14개**를 시도했다. 결과는 정상 본문과 접근 제한/동의 화면을 구별한다. iframe이나 전체 화면을 평탄화해 품질 지표를 높이지 않는다. 복제 HTML은 네트워크 없는 렌더러에서 표시하고 요소 편집·파일/저장 왕복도 확인한다. 원본 사이트의 서비스 버튼·입력·동영상 재생 상태는 조작하지 않았다. 수집기의 스크롤은 종료 시 복원한다.

원본/복제/차이 PNG는 같은 뷰포트와 기록한 문서 영역을 사용한다. 주 지표는 기존 RGB 최대 채널 차이 16/255 이내 픽셀 비율이며 RGB8·완전 동일 수치도 보존한다. 제외 마스크·허용오차 확대는 없다. 내장은 1440×1000, 확장은 1600×1100이며 문서는 최대 12,000px로 검사했다. 아래 괄호는 실제 비교 높이다. 반복 실행에서 영상은 미달이 재현됐으므로 한 번의 통과를 최종 결과로 채택하지 않았다.

## 공통 수정

- 내장 앱에서 Inspector 캐시/리소스 로더로 읽지 못한 **이미 관측한 Font/Image**만 HTTP(S) 공개 읽기로 보완한다. 인증 정보 없이 2.5초·5MB 제한을 적용하고 스트리밍 중 한도 초과도 중단한다. 다른 프로토콜·URL 내 자격 증명은 거절한다. 사이트 이름이나 인증 헤더를 사용하지 않는다. [Electron net.fetch 공식 문서](https://www.electronjs.org/docs/latest/api/net).
- 읽을 수 있는 압축 사진 바이트를 우선해 JPEG를 큰 PNG로 바꾸지 않는다. NASA 내장 캡처 HTML은 58.68MB→34.06MB다. Chrome에서 NASA/IKEA가 60MB 문서 한도 때문에 빈 편집기로 끝나던 문제도 새 수집에서 해소했다. 이미지 시각 일치 미달은 별도로 남는다.
- 계산된 border-image 속성을 보존한다. npm의 Source Sans Pro/Fira Mono 임베딩과 그라디언트 테두리를 공통 경로에서 복구해 내장 초기 화면 **88.57→99.62%**, 문서 **91.83→99.70%**다.
- root의 실제 scrollingElement 높이를 사용해 고정 body의 숨은 콘텐츠를 가짜 문서 높이로 잡지 않는다. 동의 화면이 1000px만 보이면 그 범위로 명시한다.
- 보이는 IMG/CSS 배경의 디코딩·paint 대기를 제한 시간 안에서 수행하고, 최종 DOM 직렬화 전에 원본 paint를 준비한다. 원본 준비의 각 응답은 10초 제한이며 rAF 대기도 제한한다. 무한 대기를 성공으로 처리하지 않는다.
- 영상의 object-fit/object-position을 유지한다. 영상은 정지 이미지임을 경고한다. 영상 전체를 composited screenshot으로 바꾸는 실험은 HTML 문구·그라디언트 중복 때문에 철회했다. 원시 프레임의 조기 캐시도 안정적으로 개선하지 못해 채택하지 않았다.

## 새 본문 결과

초기 화면 / 문서 순서다. **내장 정상 본문 11개 중 10개**가 두 영역 모두 95% 이상이다. **Chrome 정상 본문 10개 중 8개**가 통과했고 npm은 보안 확인 때문에 본문 검증에 포함하지 않는다. 즉 전체 신규 페이지/경로가 95%를 달성한 상태는 아니다.

| 페이지 | 내장 초기 / 문서 (비교 높이) | Chrome 초기 / 문서 (비교 높이) |
| --- | ---: | ---: |
| [Bootstrap Dashboard](https://getbootstrap.com/docs/5.3/examples/dashboard/) | 98.31 / 98.60% (1,226px) | 99.86 / 99.85% (1,282px) |
| [Tabler](https://demo.tabler.io/) | 96.63 / 97.81% (3,711px) | 95.34 / 98.02% (3,711px) |
| [GOV.UK](https://www.gov.uk/) | 99.84 / 99.20% (4,923px) | 99.70 / 99.28% (4,923px) |
| [NASA](https://www.nasa.gov/) | 99.88 / 99.07% (7,782px) | 72.18 / 90.96% (7,782px) **미달** |
| [Python asyncio 문서](https://docs.python.org/3/library/asyncio.html) | 99.17 / 99.63% (2,671px) | 99.32 / 99.67% (2,671px) |
| [npm React](https://www.npmjs.com/package/react) | 99.62 / 99.70% (2,332px) | 보안 확인 · 제외 |
| [IKEA 한국](https://www.ikea.com/kr/ko/) | 91.17 / 92.64% (12,000px) **미달** | 87.18 / 74.56% (12,000px) **미달** |
| [shadcn Dashboard](https://ui.shadcn.com/examples/dashboard) | 99.91 / 99.94% (2,049px) | 99.97 / 96.84% (2,033px) |
| [Hacker News](https://news.ycombinator.com/) | 99.62 / 98.89% (1,246px) | 99.67 / 98.98% (1,246px) |
| [미국 의회도서관](https://www.loc.gov/) | 99.89 / 99.29% (4,199px) | 99.86 / 99.36% (4,199px) |
| [Debian](https://www.debian.org/) | 99.61 / 99.66% (2,083px) | 99.85 / 99.92% (2,141px) |

내장 IKEA는 최종 영상 배치 수정 상태의 재현 실행이다. 그 전 전체 합성 이미지 실험의 98.18/97.58%는 올바른 개별 오버레이 편집성을 보장하지 않아 최종 통과로 쓰지 않는다. Chrome IKEA도 최종 패키지에서 배치 수정 후 다시 수집·비교한 결과다. NASA의 Chrome 문제는 영상이 아니라 외부 JPG 이미지 폴백이다.

## 배제·미해결을 숨기지 않기

- **AdminLTE**: 내장 준비 응답 지연/원본 로딩 지연, Chrome 편집기 미생성. 본문 복제 성공을 확인하지 못했다. 제한 시간 내 오류로 끝내는 회귀를 추가했다. 수집기 없는 별도 진단은 앱 준비 단계에서 로그가 나오지 않아 원인 판정의 근거로 쓰지 않는다. 일반 JavaScript 장애나 보안 차단이라고 단정하지 않는다.
- **ESPNcricinfo**: Access Denied(8개 노드)라 실제 본문을 검사하지 못했다.
- **Chrome npm**: 한국어 Cloudflare 보안 확인을 최초 도구가 놓쳐 99.85%로 측정했다. 잘못된 성공을 제외하고 한국어 제목/문구 탐지를 보완했다. CAPTCHA를 해결하거나 보안을 우회하지 않았다. 내장 npm 본문 검증과 구별한다.
- **Guardian**: 원본이 동의 화면으로 root 스크롤을 잠갔다. 내장 수정 후 보이는 1000px 화면은 약95.84%지만 전체 기사/정상 본문 통과에 합산하지 않는다. 확장 수정 후 재확인은 미검증이다.
- **Chrome NASA**: 외부 공개 JPG는 200 응답·242,313bytes이나 CORS 허용 헤더가 없고 현재 확장에는 해당 호스트 권한이 없다. 캡처 픽셀에는 그라디언트가 포함돼 복제의 HTML 오버레이가 이중 적용된다. 내장 공개 자산 읽기의 성공을 확장 성공으로 간주하지 않는다. [Chrome 공식 네트워크 권한 설명](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
- **IKEA**: 재생 영상의 수집/원본 사진/독립 전체 사진 시점이 달라 반복 실행에서 95% 미달이다. 정지 이미지로 서로 다른 시간의 모든 타일을 동시에 재현할 수 없다. 원본 영상 일시정지나 비교 마스킹으로 맞추지 않았다.

남은 Chrome 외부 자산·영상 품질은 [#69](https://github.com/kimyongin/console-canvas/issues/69), 전체 신규 검증은 [#68](https://github.com/kimyongin/console-canvas/issues/68)에서 **열림**으로 추적한다. 사이트별 예외 추가 대신 필요한 권한·촬영 모델과 편집성의 한계를 해결해야 한다.

## 증빙·검증 상태

수정 전후 원본·복제·차이 PNG, 수집 JSON·좌표·엄격 지표는 ignored `local/unseen-0241/`에 보관한다. `baseline.json`, `code-audit.json`(수정 전), `final-site-branch-audit.json`(최종 8개 모듈, 신규/기존 도메인명 0건), `native-cases-report.json`, `native-verified/`, `native-video-fit/`, `native-debian/`, `chrome-baseline/`, `chrome-fixed-comparison/`, `chrome-raw-video-comparison/`, `chrome-debian-comparison/`가 근거다. 실제 사이트 자료·프로필은 Git에 올리지 않는다.

스킬 quick_validate·타입·포맷도 통과했다. 최종 `npm run check`는 Python43·Node44·Chromium469개(수집 품질45개 포함), 독립 HTML·실제 포인터 검사를 통과했다. 정확한 배포 앱 런타임은 격리 프로필에서 공식 SDK22+17개·sandbox·원본 무변경·정상 종료/재실행·주석/분기/휴지통 보존을 통과했다. 실제 제품 Chrome 확장 통합62개도 통과했다.

기존 각10개 사이트는 저장된 원본을 유지한 최종 렌더 회귀에서 모두95% 이상이다. 새로 수집한14개 도메인 시험과 구별한다. 검사 로그는 `local/unseen-0241/{final2-check.log,packaged-sdk.log,chrome-product-final/,native-old-regression/,chrome-old-regression/,chrome-final-ikea-comparison/}`다.

공식 Electron SHA-256·ad-hoc 서명·DMG 체크섬·119개 배포 런타임 파일과 앱 번들/스킬 ZIP의 바이트 일치를 확인했다. 실제 사용자 앱에서 편집 파일을 내보내고 정상 종료 후 앱·전체 userData·브리지·스킬·확장을 백업해0.24.1→0.24.2를 설치·재실행했다. 전후 파일은 생성/갱신 시각을 제외한 전체 내용이 동일하다(364요소·스냅샷3개). 설치 스킬4개 관리 파일 자동 갱신과 개인 추가 파일 보존, 새 공식 SDK의 설치 스킬 경유 guide0.24.2/요소·주석·스냅샷 읽기 전용 조회를 확인했다. 사용자 문서에 테스트 편집은 하지 않았다.

일반 Chrome도 같은 ID/설치 경로로0.24.2를 재로드했다. 사용자 확장 문서 직접 열람의 URL 정책 제한은 우회하지 않았고 격리 프로필의 실제 확장 수집/제품 검사와 구분한다. 설치는 백업을 동반한 직접 교체이며 업데이트 버튼의 자기 교체 흐름을 재시험한 것은 아니다. 설치 보존 증빙은 `local/deployment-0242-backup/`다.

배포 커밋 `96bd7d1`, [v0.24.2 공개 프리릴리스](https://github.com/kimyongin/console-canvas/releases/tag/v0.24.2). 게시된5개 자산 digest와 로컬 SHA-256이 모두 일치하고 실제 설치 앱의 업데이트 확인에서 “최신 버전입니다”를 확인했다. #68/#69는 미달 조건이 남아 열림을 유지한다.
