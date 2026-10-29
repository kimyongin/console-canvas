# 추가 20개 페이지 검증 · 0.24.3

2026-10-29 · #70 조사 / #68·#69 잔여 품질 · FR-01/10/11 · AC-68

## 결과와 비교 범위

이전 목록에 없던 **20개 도메인**을 내장 Chromium과 실제 제품 Chrome 확장에서 각각 시도했다. 콘솔 표·대시보드, Web Components/Shadow DOM, 개발 문서, 한국 정부·국제기구, 쇼핑, 스포츠, 대학·교육, 데이터·지도, 뉴스, 여행, 박물관을 포함한다. 수정 전 0.24.2 커밋 `3dea770`의 8개 수집 모듈 SHA-256과 대상 URL을 먼저 동결했다.

최종 **내장은 비교 가능한 16개 중 15개**, **Chrome은 15개 중 12개**가 초기 화면과 기록한 문서 영역 모두 95% 이상이다. 여기서 비교 가능은 픽셀 결과가 생성됐다는 뜻이며 팝업 없는 정상 본문 전체를 뜻하지 않는다. Chrome Airbnb는 원본 상태 차이로 문서 비교 자체가 유효하지 않아 미통과로 남겼다. 전체 시도 20개가 모두 성공한 것은 아니다. 초기 0.24.2는 내장 통과10·미달6·실패4, Chrome 통과8·미달6·실패6이었다. Chrome Khan Academy의 초기 준비 문맥 소멸은 제한된 읽기 재시도로 재수집을 완료했다.

원본·복제·차이 PNG를 동일 크기로 비교한다. 주 지표는 기존 **RGB 최대 채널 차이 16/255 이하**의 픽셀 비율이며 RGB8·완전 동일·평균 채널 차이도 보존한다. 99%라는 표기가 픽셀 완전 동일 99%를 뜻하지 않는다. 허용오차 확대·실패 영역 마스킹은 없다. 내장 1440×1000, Chrome 1600×1100이며 문서는 최대 12,000px다. 원본은 읽기 전용이며 서비스 버튼·로그인·영상 재생·DOM/스타일을 조작하지 않았다. 수집 스크롤은 복원하고 복제본은 네트워크 없이 렌더링·이동·삭제·파일 저장 왕복을 확인했다.

| 페이지·카테고리 | 내장 초기 / 문서 (비교 높이) | Chrome 초기 / 문서 (비교 높이) |
| --- | ---: | ---: |
| [ant-design-table](https://ant.design/components/table/) · 콘솔·표 | 98.08 / 97.02% (12,000px) | 98.35 / 96.26% (12,000px) |
| [element-plus-table](https://element-plus.org/en-US/component/table.html) · 콘솔·표 | 요소 순회 15,000개 한도 | 60초 안에 편집기 미생성 |
| [mui-dashboard](https://mui.com/material-ui/getting-started/templates/dashboard/) · 콘솔·대시보드 | 99.93 / 99.93% (1,000px) | 99.95 / 99.95% (1,100px) |
| [shoelace-input](https://shoelace.style/components/input) · 컴포넌트·입력 | 99.66 / 99.88% (12,000px) | 99.69 / 99.89% (12,000px) |
| [rust-book](https://doc.rust-lang.org/book/) · 개발 문서 | 100.00 / 100.00% (1,000px) | 100.00 / 100.00% (1,100px) |
| [stripe-docs](https://docs.stripe.com/) · 개발 문서 | 99.90 / 99.90% (1,000px) | 99.91 / 98.67% (1,100px) |
| [seoul](https://www.seoul.go.kr/main/index.jsp) · 정부·한국어 | 99.91 / 99.97% (2,975px) | 99.92 / 97.28% (2,975px) |
| [united-nations](https://www.un.org/en/) · 국제기구 | 99.95 / 95.34% (12,000px) | 403 Forbidden · 본문 제외 |
| [uniqlo](https://www.uniqlo.com/kr/ko/) · 쇼핑·한국어 | Access Denied · 본문 미검증 | Access Denied · 본문 제외 |
| [etsy](https://www.etsy.com/) · 쇼핑 | 탐색 중 실행 문맥 소멸 · 본문 미검증 | CAPTCHA · 본문 제외 |
| [formula1-results](https://www.formula1.com/en/results/2026/races) · 스포츠·결과 | 99.98 / 99.95% (3,197px) | 100.00 / 99.96% (3,197px) |
| [nhl](https://www.nhl.com/) · 스포츠 | 99.88 / 99.47% (6,615px) | 99.68 / 99.72% (6,615px) |
| [mit](https://www.mit.edu/) · 교육 | 99.79 / 99.93% (2,894px) | 94.93 / 96.06% (3,022px) **미달** |
| [khan-academy](https://www.khanacademy.org/) · 교육 | 99.73 / 99.62% (8,391px) | 99.78 / 99.56% (8,391px) |
| [our-world-in-data](https://ourworldindata.org/) · 데이터 | 99.10 / 99.41% (4,898px) | 98.95 / 96.49% (4,901px) |
| [openstreetmap](https://www.openstreetmap.org/) · 지도 | 99.98 / 99.98% (1,000px) | 99.99 / 99.99% (1,100px) |
| [reuters](https://www.reuters.com/) · 뉴스 | CAPTCHA · 본문 제외 | CAPTCHA · 본문 제외 |
| [the-verge](https://www.theverge.com/) · 뉴스 | 99.89 / 99.60% (12,000px) | 99.99 / 98.90% (12,000px) |
| [airbnb](https://www.airbnb.com/) · 여행 | 98.21 / 98.21% (1,000px) | 99.90 / 6.59% (1,100px) **미달** |
| [national-museum](https://www.museum.go.kr/site/main/home) · 문화·한국어 | 99.99 / 93.04% (5,395px) **미달** | 99.99 / 79.29% (4,609px) **미달** |

Ant Design의 원본 높이는 53,709px이며 표의 12,000px만 비교했다. 픽셀 보완 한도 경고도 기록했다. 전체 문서 통과로 확대하지 않는다. MUI·Rust·Stripe·OpenStreetMap 등 root 스크롤이 뷰포트 크기인 문서는 내부 스크롤의 모든 상태를 시험한 것이 아니다. 지도는 정적 화면 복제 검증이다. Shoelace의 홍보 모달, Formula 1 쿠키 모달, Khan 동의 배너, Airbnb 팝업은 원본에서 보인 그대로 포함한다. 가려진 정상 본문은 통과로 주장하지 않는다.

## 사이트 이름에 의존하지 않는 수정

1. **고정 레이어의 원래 쌓임 관계**를 보존한다. 모달 배경·패널·툴바와 중첩 fixed를 같은 전역 portal로 올려 순서가 바뀌던 문제를 수정했다. 원래 조상 stacking context 안에 별도 fixed scope를 만들고, 중첩 fixed는 부모 요소의 overflow 밖이면서 부모 이동을 따르는 wrapper에 배치한다. 배경이 본문 위를 덮거나 작은 스크롤 버튼이 큰 동의 패널을 자르는 문제를 함께 해결했다. CSS zoom/회전/스케일/3D 변환은 기존 문서 좌표 경로로 폴백하며 전체 변환 행렬 지원을 주장하지 않는다.
2. **HTML 재파싱 구조 복구**: 스크립트가 만든 중첩 p를 직렬화 후 브라우저가 자동으로 닫는 경우, 캡처 parentId로 작업 복사본의 구조를 복원한다. 실제 복구가 필요한 바깥 p만 스타일을 유지한 중립 상자로 바꾸며 원본 태그·식별 메타데이터는 유지한다.
3. **소수점 폭 정밀도**: 계산 스타일의 문자열 반올림으로 딱 맞던 flex 행이 줄바꿈되던 문제를 Blink의 1/64 CSS px 단위로 복구했다. zoom 하위는 제외하고 작업 복사본만 보정한다.
4. **Chrome 공개 CSS 폰트 선언 복구**: 관측한 stylesheet URL에서 폰트 관련 at-rule만 읽고 상대 자산 주소를 절대화한다. HTTP(S)·자격 증명 없음·URL 내 인증 정보 거부·32개 URL/병렬8/응답당2초·2MB 스트리밍 한도를 적용한다. 응답 한도 초과는 중단한다. 임의 CSS/스크립트 실행, 호스트 권한 확대, 로그인 쿠키 사용은 없다.
5. **원본 메타데이터 불변성**: 설치 보존 전후 대조에서 기존 pseudo 요소 좌표 갱신이 캡처 노드까지 변경하던 문제가 드러났다. 런타임 노드를 복사해 좌표 갱신을 작업 장면 안에 한정했다. 설치 전 원본 백업과 전체 파일 내용 비교로 다시 확인한다.

같은 저장 원본을 유지한 내장 초기 화면 전후는 MUI **92.10→99.93%**, Shoelace **59.03→99.66%**, Formula 1 **93.46→99.98%**, NHL **49.87→99.88%**, Khan **91.53→99.73%**다. 페이지별 좌표/ID/도메인 분기는 추가하지 않았다.

Chrome Khan의 폰트 보완 후 실제 새 수집은 **99.78/99.56%**다. 최초 준비 실패와 다른 원본이므로 단순 전후로 묶지 않았다. 대신 같은 최종 캡처·동일 독립 원본 이미지에서 보완된 폰트 선언만 제거한 ablation은 **87.99/88.87%**로 떨어졌다. 나머지 HTML·자산을 유지해 선언 복구 효과를 분리했다. 잘못된 참조 방식의 중간 실험은 최종 판정에서 사용하지 않는다.

## 남은 문제

- **국립중앙박물관**: 초기 화면은 두 경로 모두99.99%지만 문서의 슬라이더/포스터 영역 위치·내용이 다르다. 내장93.04%, Chrome79.29%. 순환 배너의 수집 시점 차이가 의심되지만 근본 원인을 확정하지 않았다.
- **MIT Chrome**: 초기94.93%로 글자 모양·폭이 다르다. 공개 CSS 폰트 선언 보완만으로 해결되지 않았다. 특정 응답의 CORS 차단이라고 단정하지 않고 폰트 정의/자산을 추가 조사한다. 내장 결과와 구별한다.
- **Airbnb Chrome**: 초기99.90%지만 독립 문서 원본은 팝업이 사라지고 헤더·레이아웃이 바뀐 상태다. 복제는 가져올 당시 팝업을 유지한다. 문서6.59%를 숨기지 않고 **동일 상태 문서 비교 미확보**로 남긴다. 참조 이미지를 바꾸거나 영역을 마스킹해 통과시키지 않았다.
- **Element Plus**: 내장은 순회 HTML 요소15,000개 한도 오류다(결과 노드 수와 다른 한도). Chrome은60초 안에 편집기가 생성되지 않았고 동일 원인인지는 직접 확인하지 못했다. 기존 제한을 무작정 늘리지 않았다.
- **접근 실패**: UN Chrome403, Uniqlo Access Denied, Etsy/Reuters Chrome CAPTCHA는 실제 본문 성공에서 제외했다. Etsy 내장은 탐색 중 문맥 소멸로 실패해 원인을 CAPTCHA로 단정하지 않는다. CAPTCHA 해결·보안 우회는 하지 않았다.
- 기존 [0.24.2](unseen-pages-0.24.2.md)의 IKEA 영상·Chrome NASA 외부 이미지 문제도 해결됐다고 주장하지 않는다.

잔여 품질은 [#69](https://github.com/kimyongin/console-canvas/issues/69), 일반화 목표는 [#68](https://github.com/kimyongin/console-canvas/issues/68)에서 열림을 유지한다. #70의 조사·공통 회귀 완료와 모든 사이트95% 달성을 구별한다.

## 재현 증빙과 검사

Git 제외 `local/diverse-0242/`에 수정 전 `baseline.json`, 대상 `cases.json`, 최초 `native-report.json`/`chrome-report.json`, 최종 `final-native-report.json`/`final-chrome-report.json`과 `final-native/`/`final-chrome/` 원본·복제·차이 PNG를 보존한다. Chrome Khan은 `chrome-font-khan-final/`, `chrome-font-khan-comparison/`, 폰트 제거 대조는 `font-ablation-independent/`다. 실제 사이트 캡처·프로필·사용자 편집 파일은 공개 저장소에 올리지 않는다.

기존 각10개 사이트의 **저장 원본**도 두 경로 모두95% 이상을 유지했다(`old-native/report.json`, `old-chrome/report.json`). 새20개를 실제 수집한 시험과 구별한다. fixed 겹침/조상 scope/부모·자식 이동/overflow/소수 폭/문단/코드 왕복/원본 좌표 불변성의 실제 DOM 회귀를 추가했다.

최종 공통 검사 `preservation-check.log`는 타입·포맷·빌드/스킬 패키징, Python43·Node46·Chromium485개와 standalone/실제 포인터 검사를 통과했다. 새 레이아웃 회귀16개를 포함한다. 정확한 배포 런타임의 공식 SDK22+17개·sandbox·원본 무변경·정상 종료/재실행·자료 보존과 실제 제품 Chrome62개도 최종 원본 메타데이터 수정 후 재통과했다(`packaged-sdk-preservation.log`, `chrome-product-preservation/`). 대표 MUI/NHL/Khan의 동일 저장 원본을 다시 렌더해 최종 수치와 편집 왕복이 유지됨을 확인했다(`postmeta-native/`). 소스 최종10개 모듈의 신규 도메인 문자열0건과 일반 URL/프레임 조건을 감사했다(`final-code-audit.json`). 스킬 quick_validate도 통과했다.

공식 Electron SHA-256·ad-hoc 서명·DMG 체크섬을 검증해0.24.3을 빌드했다. 사용자 앱을 정상 종료한 뒤 앱·전체 userData·브리지·설치 스킬·확장을 백업했다. 실제 설치 앱은0.24.3으로 다시 실행했고 편집 파일 전후 전체 대조에서 생성/갱신 시각만 다르며 **364요소·기존 편집/주석·스냅샷3개·휴지통·분기 내용은 동일**하다. 초기 배포 대조에서 pseudo 좌표 차이를 발견해 수정·재검사했으며 중간 증빙도 보존한다. 사용자 문서에 테스트 편집은 적용하지 않았다.

설치 스킬4개 관리 파일 자동 동기화, 배포 런타임120개 파일·앱 번들/스킬 ZIP 바이트 일치, 공식 SDK의 설치 스킬 경유 실제0.24.3 guide/요소·주석·스냅샷 읽기 전용 연결을 확인했다. 일반 Chrome도 같은 ID/경로로0.24.3을 재로드했다. 사용자 확장 문서는 기존 URL 정책 제한 때문에 직접 열람하지 않았고 우회하지 않았다. 이 조건은 격리 프로필의 실제 확장 수집/제품 검사와 구별한다. 설치는 백업을 동반한 직접 교체이며 업데이트 버튼의 자기 교체 시험을 뜻하지 않는다. 보존 증빙은 Git 제외 `local/deployment-0243-backup/`다.
