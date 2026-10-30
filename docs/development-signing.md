# 고정 개발 서명과 키체인 · 0.39

현재 개발 기기는 무료 Apple Development 신원을 고정했고, **0.39.0→0.39.1 실제 업데이트에서 추가 키체인 승인 없이 계정/모델 조회를 완료했다.** 최초 신원 이전의 사용자 허용과 구별한다. [실제 두 버전·자료 보존 검증](deployment-0.39.md).

아래는 자체 서명에서 확인한 이전 문제다. 일반 macOS 빌드는 준비한 개발 인증서를 재사용한다. 번들 ID와 인증서가 같은 designated requirement를 유지하지만, **자체 서명만으로 업데이트 뒤 Keychain 재승인이 사라지지는 않는다.** 0.38.1→0.38.2 실제 교체에서도 Safe Storage 승인이 다시 나타났다. [Electron 설명](https://www.electronjs.org/docs/latest/api/safe-storage)·[Apple 지정 요구사항/Keychain](https://developer.apple.com/library/archive/technotes/tn2206/).

Apple securityd는 지원하는 Apple 개발/배포 서명을 teamid partition으로, 그 밖의 서명은 cdhash partition으로 분류한다. 실제 이 앱의 Safe Storage 접근 메타데이터에서도 이전 두 빌드의 cdhash가 확인됐으며 비밀 값은 조회하지 않았다. 같은 자체 인증서를 신뢰 등록했어도 이 조건은 빌드마다 달라진다. [Apple 구현](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp#L176-L274). 인증서 요구사항 일치를 Keychain 무재승인으로 대체해 판정하지 않는다.

당시에는 자체 인증서만 준비돼 있었고, Apple 개발/Developer ID로의 전환 검증이 남아 있었다. 이후 무료 Apple Development 발급과 같은 신원의 실제 두 버전 검증을 완료한 것이 위0.39 결과다. 결제·등록·새 권한 부여를 자동 진행하지 않는다. 키체인 ACL/partition을 넓히거나 평문으로 저장하는 우회는 구현하지 않는다.

앱 시작에서는 계정 암호화 검사/복호화를 지연시켜 편집과 MCP를 먼저 시작한다. ChatGPT 기능 사용 시에만 보호 저장소를 초기화하고 대기 상태를 표시한다. 거절 뒤 **계정 저장소 다시 확인**을 지원하며 원래 암호화 파일은 보존한다. 이는 일반 작업의 차단을 해소하는 수정이며 실제 AI 인증의 재승인 제거와 구별한다.

## 한 번 준비하고 계속 사용

### 무료 Apple Development 신원 선택 · 0.39

무료 계정은 Xcode의 Accounts → Personal Team → Manage Certificates에서 Apple Development 인증서를 준비한다. Xcode가 없으면 공식 App Store에서 현재 macOS와 호환되는 버전을 설치한다. 사용자 계정 로그인·약관/최초 OS 허용은 사용자가 완료한다. Developer ID의 외부 배포/공증과 무료 로컬 개발을 구별한다. [Apple 개발 계정](https://developer.apple.com/get-started/)·[Xcode 인증서 관리](https://help.apple.com/xcode/mac/current/en.lproj/dev154b28f09.html).

처음에는 `python3 scripts/build_desktop.py --signing identity --identity '<Apple Development 인증서 SHA-1 지문>'`으로 서명한다. `python3 scripts/apple_signing.py inspect --app 'dist/Console Canvas.app'`은 strict/deep 서명·Apple 체인·Team ID·leaf 인증서 지문과 해당 개인 키의 가용성을 확인한다. 인증서 공개 바이트만 임시로 추출하고 비밀 키는 내보내지 않는다.

사용자가 승인한 신원은 같은 앱으로 `python3 scripts/apple_signing.py select --app 'dist/Console Canvas.app'`을 실행해 고정한다. 사용자 전용 서명 폴더의 `apple-development.json`에는 공개 지문·Team ID만0600으로 보관한다. 이후 기본 빌드는 해당 Apple 신원을 사용한다. 신원 부재/팀 변경/손상/빌드별 DR이면 중단하고 자체 서명이나 ad-hoc으로 자동 대체하지 않는다. 기존 자체 인증서는 복구용으로 보존한다.

실제 검증은 기존 편집·주석·분기 전체 백업/지문 대조 후 서로 다른 두 앱 버전에서 계정 저장소와 모델 조회를 직접 실행한다. 최초 자체→Apple 신원 변경에 필요한 사용자 허용과, 이후 같은 Apple 신원의 버전 변경을 구별한다. 단순 앱 시작은 계정 복호화를 지연하므로 무재승인 증거가 아니다. 이 절차를 적거나 도구 검사를 통과한 것만으로 실제 기기 검증 완료라 하지 않는다.

### 자체 개발 인증서 유지

`python3 scripts/dev_signing.py prepare`는 사용자 전용 `~/Library/Application Support/Console Canvas Development Signing`에 인증서·암호화 복구 P12·개발 키체인과 자동 빌드용 잠금 해제 정보를 만든다. 디렉터리는0700, 자격 증명은0600이다. 이 폴더는 Git/앱/스킬 ZIP에 포함하지 않으며 복구 가능한 비공개 백업을 유지한다. `CONSOLE_CANVAS_SIGNING_DIR`로 이미 준비한 같은 신원을 지정할 수도 있다.

신뢰 등록은 자동으로 수행하지 않는다. 사용자가 선택한 개발 인증서를 현재 사용자 계정의 **코드 서명** 용도로 승인하는 별도 설정이다. 공개 인증서는 사용자 키체인에, 개인 키는 전용 개발 키체인에 둔다. 기존 로그인 항목의 접근 정책을 바꾸거나 모든 앱의 접근을 허용하지 않는다. 현재 개발 기기의 최초 등록은 사용자 승인을 받고 진행했다.

일반 빌드는 `python3 scripts/build_desktop.py`다. 없거나 손상된 신원을 조용히 재생성하지 않고, 서명 실패 시 중단한다. 부분 자료는 기존 백업에서 같은 인증서로 복구한다. `python3 scripts/dev_signing.py info`는 공개 식별 정보만 출력한다.

서명할 때만 전용 키체인을 탐색 목록에 추가하고 작업 후 그 추가분을 제거한다. 서명 간 잠금으로 동시 빌드를 직렬화하고, 원래 목록과 무관한 변경은 보존한다. CLI 오류에 비밀번호나 전체 명령 인수를 출력하지 않는다.

## 다른 빌드 방식

- 인증서 지정: `python3 scripts/build_desktop.py --signing identity --identity '<certificate identity>'`와 선택적 `--keychain <path>`. 실패 시 ad-hoc으로 전환하지 않는다.
- 명시적 격리 검사: `python3 scripts/build_desktop.py --signing adhoc`. 일반 사용자 앱 갱신의 기본값으로 사용하지 않는다.
- Developer ID·공증과 공개 배포 자격은 별도다. 이 Mac의 개발 인증서 신뢰를 다른 사용자 기기의 신뢰 또는 Gatekeeper/공증 완료로 해석하지 않는다.

## 검증 범위

무료 Apple Development 전환의 실제 준비/보존과 두 버전 검증 상태는 [0.39 기록](deployment-0.39.md)을 따른다.

준비 신원 재사용·불완전/손상/넓은 권한 거절·암호 비노출·ad-hoc 결과 거절·실패 시 탐색 목록 복원을7개 Python 회귀로 확인한다. 실제 서로 다른 두 Mach-O 빌드는 같은 인증서 요구사항을 가지며, 두 번째가 첫 번째 요구사항을 만족했다. 실제 앱의 최초 이전·다른 버전 업데이트·ChatGPT 연결·자료 보존은 [배포 기록](deployment-0.37.md)과 [#153](https://github.com/kimyongin/console-canvas/issues/153)에서 별도로 추적한다.
