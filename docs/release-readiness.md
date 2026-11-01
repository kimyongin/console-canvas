# 배포 준비 상태

2026-11-01 · #152 · 로컬 설치와 불특정 사용자 배포를 구분한다.

## 확인한 것

- 설치 앱은 고정 Apple Development 신원으로 서명한다. 개발 기기의 업데이트·자료 유지 검증과 공개 배포 적격은 다른 조건이다.
- Electron 원본은 공식 SHA-256을 검증한다. 앱의 `Resources/licenses/`에는 Electron `LICENSE`와 `LICENSES.chromium.html`이 포함된다.
- UI 번들에 실제 포함되는 패키지는 esbuild 의존성 그래프로 추적하고 `THIRD_PARTY_NOTICES.txt`에 라이선스 전문을 모은다. 이 파일은 공개 런타임 ZIP·앱에도 포함된다. shadcn 소스 출처는 `ui/react/SOURCES.md`에 있다. lockfile의 production 표기 패키지84개는 MIT81·Apache-2.0 1·ISC1·0BSD1로 기록되며 실제 번들 포함 목록과 구별한다.
- 앱 내부 AI/OAuth/API 키 경로는 제거됐다. 과거 제공자 인증 결과는 현재 배포의 선행 조건이 아니다.
- 프로젝트는 사용자 승인으로 MIT를 적용했다. 최상위 `LICENSE`와 package 메타데이터, 런타임/스킬 ZIP·앱·단독 HTML에 같은 전문을 포함한다. 의존성의 저작권/라이선스는 `THIRD_PARTY_NOTICES.txt`와 Electron/Chromium 고지로 별도 유지한다.

## 결정·외부 조건

1. **사용자 결정: MIT 적용 승인(2026-11-01).** 이전 보류 이후 MIT를 선택했다. 프로젝트 저작권 표기는 `2026 kimyongin`이며 의존성의 기존 고지는 바꾸지 않는다.
2. 일반 macOS 공개 배포 경로를 정한다. 현재 Apple Development 설치물을 Developer ID 서명·공증 완료 앱이라고 표시하지 않는다. 실제 발급·공증·외부 기기 설치 확인 전에는 이 조건을 완료하지 않는다.

서명 개인 키·P12·계정 정보는 공개하지 않는다. 이 문서는 실제 자산·검사 상태와 결정 대기 항목을 기록하며, 법률적 적격 판단이나 공개 배포 허가를 대신하지 않는다.
