# 개인 사용 설치·라이선스

2026-11-01 · #152 · 사용자 확정: 본인 Mac에서 개인적으로 사용한다. 불특정 사용자에게 배포하지 않는다.

## 확인한 것

- 설치 앱은 고정 Apple Development 신원으로 서명한다. 개발 기기의 업데이트·자료 유지 검증과 공개 배포 적격은 다른 조건이다.
- Electron 원본은 공식 SHA-256을 검증한다. 앱의 `Resources/licenses/`에는 Electron `LICENSE`와 `LICENSES.chromium.html`이 포함된다.
- UI 번들에 실제 포함되는 패키지는 esbuild 의존성 그래프로 추적하고 `THIRD_PARTY_NOTICES.txt`에 라이선스 전문을 모은다. 이 파일은 공개 런타임 ZIP·앱에도 포함된다. shadcn 소스 출처는 `ui/react/SOURCES.md`에 있다. lockfile의 production 표기 패키지84개는 MIT81·Apache-2.0 1·ISC1·0BSD1로 기록되며 실제 번들 포함 목록과 구별한다.
- 앱 내부 AI/OAuth/API 키 경로는 제거됐다. 과거 제공자 인증 결과는 현재 배포의 선행 조건이 아니다.
- 프로젝트는 사용자 승인으로 MIT를 적용했다. 최상위 `LICENSE`와 package 메타데이터, 런타임/스킬 ZIP·앱·단독 HTML에 같은 전문을 포함한다. 의존성의 저작권/라이선스는 `THIRD_PARTY_NOTICES.txt`와 Electron/Chromium 고지로 별도 유지한다.

## 확정 범위

1. **사용자 결정: MIT 적용 승인(2026-11-01).** 이전 보류 이후 MIT를 선택했다. 프로젝트 저작권 표기는 `2026 kimyongin`이며 의존성의 기존 고지는 바꾸지 않는다.
2. **개인 사용 확정.** 공개 배포용 Developer ID 발급·공증·외부 기기 설치 검증은 요구사항에서 제거하고 #152의 남은 작업을 취소한다. 미수행 항목을 통과한 것으로 바꾸는 뜻은 아니다.
3. 현재 고정 Apple Development 신원과 로컬 설치/업데이트·자료 보존·백업·MCP·스킬 검증을 유지한다. 개인 사용에도 필요한 설치 패키지와 업데이트 기능을 제거하지 않는다.

MIT와 제3자 라이선스 고지는 유지한다. 개인 사용 결정만으로 GitHub 저장소의 공개 범위를 바꾸지 않는다. 서명 개인 키·P12·계정 정보는 공개하지 않는다.
