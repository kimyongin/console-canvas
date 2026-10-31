import { useSyncExternalStore } from 'react';
import type { EditorAdapter } from './store';
import { dispatchEditorCommand } from './commands';
import { Button } from './components/button';
import { Input } from './components/input';
import { Textarea } from './components/textarea';
import { DialogSurface, NativeSelect, TaskHeader } from './components/surfaces';
const emptySubscribe = () => () => {};
export function EditorShell({ adapter }: { adapter?: EditorAdapter }) {
  useSyncExternalStore(adapter?.subscribe || emptySubscribe, () => {
    const v = adapter?.getSnapshot();
    return v
      ? [v.ready, v.selected, v.selectedHidden, v.undoCount, v.redoCount].join('/')
      : 'initial';
  });
  const view = adapter?.getSnapshot();
  const compact = (command: Parameters<typeof dispatchEditorCommand>[0]) => {
    document.getElementById('compact-tools')?.hidePopover();
    dispatchEditorCommand(command);
  };
  return (
    <>
      <header className="app-header">
        <a
          className="brand"
          href={location.href.split('?')[0]}
          aria-label="Console Canvas 시작 화면"
        >
          <span className="brand-mark">{'▧'}</span>
          <span>
            {'Console '}
            <strong>{'Canvas'}</strong>
            <small>{'PROTOTYPE'}</small>
          </span>
        </a>
        <div className="document-title">
          <span className="status-dot"></span>
          <span id="document-title">{'화면을 가져와 편집 방향을 보여주세요'}</span>
        </div>
        <div className="header-actions">
          <Button
            id="tickets-button"
            disabled={!view?.ready}
            onClick={() => dispatchEditorCommand('tickets')}
            variant="outline"
          >
            작업 티켓
          </Button>
          <Button
            id="new-ticket-button"
            disabled={!view?.ready}
            onClick={() => dispatchEditorCommand('new-ticket')}
          >
            목표 확정
          </Button>

          <Button id="export-button" className="primary" disabled={true} variant="outline">
            {'\n          전달 이미지 '}
            <span aria-hidden="true">{'↗'}</span>
          </Button>
        </div>
      </header>
      <DialogSurface id="commands-dialog" aria-label="명령과 단축키">
        <h2>명령과 단축키</h2>
        <p>기존 버튼과 메뉴도 그대로 사용할 수 있습니다. 입력 중에는 단축키가 실행되지 않습니다.</p>
        <div id="command-list"></div>
        <Button id="commands-close" variant="outline">
          닫기
        </Button>
      </DialogSurface>

      <div id="notice" className="notice" role="status" hidden={true}></div>
      <Button id="emergency-backup" hidden variant="outline">
        편집 파일로 백업
      </Button>
      <main className="workspace" id="workspace">
        <aside className="left-panel" id="layers-panel" aria-label="레이어 패널">
          <div className="panel-heading panel-topbar">
            <strong>{'레이어'}</strong>
            <div className="panel-heading-actions">
              <span id="layer-count">{'0'}</span>
              <div id="layers-toggle-home" className="panel-toggle-slot"></div>
            </div>
          </div>
          <div className="layer-search">
            <div className="layer-search-field">
              <Input
                id="layer-search"
                type="search"
                placeholder="텍스트·버튼·요소 찾기"
                aria-label="레이어 검색"
                aria-describedby="layer-search-status"
              />
              <Button
                id="layer-search-clear"
                hidden
                variant="ghost"
                aria-label="레이어 검색 지우기"
                onClick={() => dispatchEditorCommand('layer-search-clear')}
              >
                ×
              </Button>
            </div>
            <small id="layer-search-status" role="status" hidden />
            <label className="layer-filter">
              <Input type="checkbox" id="major-layers" />
              {' 주요 요소만'}
            </label>
          </div>
          <div id="layers" className="layers" aria-label="화면 요소 목록">
            <div className="empty-small">{'화면을 가져오면 요소가 여기에 표시됩니다.'}</div>
          </div>
          <div className="left-foot">
            <span className="status-dot"></span>
            <span id="save-status">{'이 브라우저에 저장'}</span>
          </div>
        </aside>
        <aside
          id="layers-rail"
          className="panel-rail layers-rail"
          aria-label="접힌 레이어 패널"
          hidden={true}
        >
          <div id="layers-toggle-rail" className="panel-toggle-slot">
            <Button
              id="toggle-layers"
              className="panel-toggle"
              type="button"
              aria-controls="layers-panel"
              aria-expanded="true"
              aria-label="레이어 패널 접기"
              title="레이어 패널 접기"
              variant="outline"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <rect x="2" y="3" width="16" height="14" rx="2"></rect>
                <path d="M7 3v14"></path>
                <path className="panel-open-chevron" d="M8 6l4 4-4 4"></path>
                <path className="panel-fill" d="M3 4h3v12H3z"></path>
              </svg>
              <span>{'레이어'}</span>
            </Button>
          </div>
          <span className="panel-rail-label" aria-hidden="true">
            {'레이어'}
          </span>
        </aside>
        <section className="canvas-panel" aria-label="복제 화면 편집 공간">
          <div
            id="resize-layers"
            className="panel-resizer layers-resizer"
            role="separator"
            tabIndex={0}
            aria-label="레이어 패널 너비 조절"
            aria-orientation="vertical"
            aria-controls="layers-panel"
            title="드래그로 레이어 너비 조절 · 방향키로 미세 조절"
          ></div>
          <div
            id="resize-properties"
            className="panel-resizer properties-resizer"
            role="separator"
            tabIndex={0}
            aria-label="요청·주석 패널 너비 조절"
            aria-orientation="vertical"
            aria-controls="properties-panel"
            title="드래그로 요청·주석 너비 조절 · 방향키로 미세 조절"
          ></div>
          <div className="canvas-tools">
            <div id="document-menu" className="document-menu">
              <Button
                id="document-menu-button"
                popoverTarget="document-menu-content"
                aria-label="문서 메뉴"
                variant="outline"
              >
                <span id="source-title">{'문서 열기'}</span>
                <span aria-hidden="true">{'⌄'}</span>
              </Button>
              <div id="document-menu-content" className="document-menu-content" popover="auto">
                <Input
                  id="quick-document-search"
                  type="search"
                  aria-label="문서 바로 검색"
                  placeholder="문서 이름·주소로 검색"
                />
                <div id="quick-documents" className="quick-documents"></div>
                <small id="quick-document-status" role="status"></small>
                <div className="document-management">
                  <Button
                    id="show-commands"
                    variant="outline"
                    onClick={() => dispatchEditorCommand('commands')}
                  >
                    명령과 단축키…
                  </Button>
                  <Button id="documents-button" variant="outline">
                    {'전체 저장 화면 목록…'}
                  </Button>
                  <Button
                    id="rename-current"
                    data-current-document=""
                    disabled={true}
                    variant="outline"
                  >
                    {'이름 변경…'}
                  </Button>
                  <Button id="import-button" variant="outline">
                    {'편집 파일 열기…'}
                  </Button>
                  <Button
                    id="save-document"
                    data-current-document=""
                    disabled={true}
                    variant="outline"
                  >
                    {'편집 파일 저장…'}
                  </Button>
                  <p className="document-save-help">
                    {
                      '\n                작업은 자동 저장됩니다. 확정한 목표는 작업 티켓에, 문서와 티켓 백업은 편집 파일에 저장합니다.\n              '
                    }
                  </p>
                  <Button
                    id="direct-open-source"
                    data-current-document=""
                    disabled={true}
                    variant="outline"
                  >
                    원본 사이트 열기
                  </Button>
                  <details id="source-details">
                    <label>
                      프로젝트
                      <Input
                        id="project-id"
                        placeholder="레포지터리 이름 또는 로컬 경로"
                        maxLength={300}
                      />
                    </label>
                    <Button id="duplicate-document" variant="outline">
                      현재 문서 복제
                    </Button>
                    <summary>{'원본 정보'}</summary>
                    <a id="source-url" target="_blank" rel="noreferrer" hidden={true}></a>
                    <div id="source-meta" className="source-meta">
                      {'편집할 화면을 열어 주세요.'}
                    </div>
                    <Button id="recapture-button" hidden={true} variant="outline">
                      {'원본에서 다시 가져오기'}
                    </Button>
                  </details>
                  <Button id="documents-trash-button" variant="outline">
                    {'문서 휴지통…'}
                  </Button>
                  <Button
                    id="trash-current"
                    data-current-document=""
                    className="danger-menu"
                    disabled={true}
                    variant="outline"
                  >
                    {'\n                이 문서를 휴지통으로 이동\n              '}
                  </Button>
                </div>
              </div>
            </div>
            <div className="canvas-toolbar">
              <div className="history-controls">
                <Button
                  id="undo"
                  onClick={() => dispatchEditorCommand('undo')}
                  aria-label="실행 취소"
                  disabled={!view?.undoCount}
                  variant="outline"
                >
                  {'↶'}
                </Button>
                <Button
                  id="redo"
                  onClick={() => dispatchEditorCommand('redo')}
                  aria-label="다시 실행"
                  disabled={!view?.redoCount}
                  variant="outline"
                >
                  {'↷'}
                </Button>
                <span className="toolbar-divider"></span>
                <Button
                  id="paste"
                  onClick={() => dispatchEditorCommand('paste')}
                  title="이 화면에 요소 붙여넣기 · ⌘/Ctrl+V"
                  variant="outline"
                >
                  {'붙여넣기'}
                </Button>
              </div>
            </div>

            <Button
              id="compact-tools-button"
              popoverTarget="compact-tools"
              aria-label="추가 편집 도구"
            >
              ⋯
            </Button>
          </div>
          <div id="compact-tools" popover="auto" aria-label="추가 편집 도구">
            <Button disabled={!view?.ready} onClick={() => compact('paste')}>
              붙여넣기
            </Button>

            <Button disabled={!view?.ready} onClick={() => compact('focus-view')}>
              캔버스 넓히기 · 이전 패널로 복귀
            </Button>
          </div>
          <div id="viewport" className="canvas-viewport">
            <div id="welcome" className="welcome">
              <div className="welcome-icon">{'▧'}</div>
              <div className="eyebrow">{'FROM BROWSER TO CANVAS'}</div>
              <h2>
                {'옮겨도 좋고,'}
                <br />
                {'말로 남겨도 좋아요.'}
              </h2>
              <p>
                {'실제 콘솔 화면을 복제하고'}
                <br />
                {'원하는 배치나 요소별 주석으로 방향을 전달하세요.'}
              </p>
              <Button id="sample-button" className="primary large" variant="outline">
                {'\n              샘플 콘솔로 시작 '}
                <span aria-hidden="true">{'→'}</span>
              </Button>
              <div className="welcome-options">
                <Button id="welcome-import" variant="outline">
                  {'가져온 화면 파일 열기'}
                </Button>
                <Button id="installation-button" variant="outline">
                  {'실제 웹사이트 가져오는 방법'}
                </Button>
              </div>
              <div id="import-guide" className="capture-start-help" hidden={true}>
                <strong>내장 앱에서 화면 가져오기</strong>
                <p>상단 웹사이트에서 주소를 열고, 원하는 상태에서 ‘이 화면 가져오기’를 누르세요.</p>
                <p>기존 Chrome 확장 문서는 편집 파일로 저장한 뒤 이 앱에서 열 수 있습니다.</p>
              </div>
              <div id="recent-documents" className="recent-documents"></div>
            </div>
            <div id="artboard-space" className="artboard-space" hidden={true}>
              <div className="artboard-caption">
                <div id="artboard-label" className="artboard-label"></div>
                <Button
                  id="direct-source-compare"
                  variant="ghost"
                  onClick={() => dispatchEditorCommand('source-compare')}
                >
                  원본과 비교
                </Button>
                <Button
                  id="capture-status-button"
                  variant="outline"
                  onClick={() => dispatchEditorCommand('capture-status')}
                  disabled={!view?.ready}
                >
                  가져오기 정보
                </Button>
              </div>
              <div id="artboard" className="artboard">
                <iframe
                  id="scene-frame"
                  title="편집할 복제 화면"
                  sandbox="allow-same-origin"
                  referrerPolicy="no-referrer"
                ></iframe>
              </div>
            </div>
          </div>
          <div id="selection-actions" role="toolbar" aria-label="선택 요소 작업" hidden={true}>
            <div className="selection-identity">
              <strong id="selection-name"></strong>
              <small id="selection-path"></small>
              <Button id="selection-parent" variant="ghost">
                상위 요소 선택
              </Button>
            </div>
            <Button
              id="selection-toolbar-handle"
              aria-label="선택 도구 모음 이동"
              title="드래그 또는 방향키로 도구 모음 이동 · Home으로 자동 위치 복원"
              variant="ghost"
            >
              ⠿
            </Button>{' '}
            <Button
              id="context-comment"
              onClick={() => dispatchEditorCommand('comment')}
              disabled={!view?.selected}
              variant="outline"
              aria-label="선택 요소 주석 편집"
            >
              {'주석'}
            </Button>
            <Button
              id="edit-properties"
              onClick={() => dispatchEditorCommand('properties')}
              disabled={!view?.selected}
              title="선택 요소의 위치·정렬 편집"
              variant="outline"
            >
              {'\n                요소 편집\n              '}
            </Button>
            <Button
              id="copy"
              onClick={() => dispatchEditorCommand('copy')}
              title="선택 요소 복사 · ⌘/Ctrl+C"
              disabled={!view?.selected || !!view?.selectedHidden}
              variant="outline"
            >
              {'복사'}
            </Button>
            <Button
              id="delete"
              onClick={() => dispatchEditorCommand('delete')}
              disabled={!view?.selected || !!view?.selectedHidden}
              variant="outline"
            >
              {'삭제'}
            </Button>
          </div>
          <div className="canvas-footer">
            <div className="zoom-controls">
              <Button id="zoom-out" aria-label="축소" variant="outline">
                {'−'}
              </Button>
              <NativeSelect id="zoom" aria-label="확대 비율">
                <option value="0.25">{'25%'}</option>
                <option value="0.5">{'50%'}</option>
                <option value="0.75">{'75%'}</option>
                <option value="1">{'100%'}</option>
                <option value="1.25">{'125%'}</option>
                <option value="1.5">{'150%'}</option>
                <option value="2">{'200%'}</option>
              </NativeSelect>
              <Button id="zoom-in" aria-label="확대" variant="outline">
                {'＋'}
              </Button>
              <Button id="fit" variant="outline">
                {'너비 맞춤'}
              </Button>
              <Button
                id="zoom-selection"
                title="선택한 요소에 맞추기"
                disabled={true}
                variant="outline"
              >
                {'선택 맞춤'}
              </Button>
            </div>
            <Button
              id="mcp-button"
              className="connection-badge"
              title="에이전트 연결 상태"
              variant="outline"
            >
              {'\n            연결 확인'}
            </Button>

            <span id="canvas-hint">
              {'빈 곳 드래그로 영역 선택 · ⌘/Ctrl+클릭 추가 선택 · ⌘/Ctrl+C / V 복사·붙여넣기'}
            </span>
            <span id="canvas-dimensions">{'독립된 복제본'}</span>
            <span id="mcp-state" role="status">
              {'MCP 연결 안 됨'}
            </span>
          </div>
        </section>
        <aside className="right-panel" id="properties-panel" aria-label="요청·주석 패널">
          <div className="panel-heading panel-topbar">
            <strong id="properties-panel-title">{'요청·주석'}</strong>
            <span id="activity-count" className="history-count">
              {'0'}
            </span>
            <div id="properties-toggle-home" className="panel-toggle-slot"></div>
          </div>
          <section id="requests-panel" aria-label="요청과 주석">
            <label>
              추가 설명
              <Textarea
                maxLength={12000}
                id="review-note"
                placeholder="공통으로 반영할 의도와 조건을 남기세요."
              />
            </label>
            <Input
              id="requests-search"
              type="search"
              placeholder="요청·주석 찾기"
              aria-label="요청과 주석 검색"
            />
            <div id="requests-list" />
          </section>
          <div className="history-foot">항목을 누르면 대상을 확인하고 주석을 수정합니다.</div>
        </aside>
        <aside
          id="properties-rail"
          className="panel-rail properties-rail"
          aria-label="접힌 요청·주석 패널"
          hidden={true}
        >
          <div id="properties-toggle-rail" className="panel-toggle-slot">
            <Button
              id="toggle-properties"
              className="panel-toggle"
              type="button"
              aria-controls="properties-panel"
              aria-expanded="true"
              aria-label="요청·주석 패널 접기"
              title="요청·주석 패널 접기"
              variant="outline"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <rect x="2" y="3" width="16" height="14" rx="2"></rect>
                <path d="M13 3v14"></path>
                <path className="panel-open-chevron" d="M8 6l4 4-4 4"></path>
                <path className="panel-fill" d="M14 4h3v12h-3z"></path>
              </svg>
              <span>{'요청·주석'}</span>
            </Button>
          </div>
          <span className="panel-rail-label" aria-hidden="true">
            {'요청·주석'}
          </span>
        </aside>
      </main>

      <DialogSurface id="properties-dialog" aria-label="선택 요소 편집">
        <div className="popover-heading">
          <h2>{'선택 요소 편집'}</h2>
          <Button id="close-properties" aria-label="요소 편집 닫기" variant="outline">
            {'×'}
          </Button>
        </div>
        <div id="inspect-panel">
          <div id="no-selection" className="no-selection">
            <strong>{'요소를 선택해 편집하세요'}</strong>
            <p>{'⌘/Ctrl+클릭으로 여러 요소 선택 · Alt+클릭으로 세부 요소 선택'}</p>
          </div>
          <section id="inspector" className="inspector" hidden={true}>
            <h2 id="element-name"></h2>
            <div id="direct-edit-controls">
              <div id="batch-controls" hidden={true}>
                <strong id="selection-count"></strong>
                <div className="batch-actions">
                  <Button data-align="left" variant="outline">
                    {'왼쪽 정렬'}
                  </Button>
                  <Button data-align="top" variant="outline">
                    {'위쪽 정렬'}
                  </Button>
                  <Button data-align="center-x" variant="outline">
                    {'가로 중앙'}
                  </Button>
                  <Button data-align="center-y" variant="outline">
                    {'세로 중앙'}
                  </Button>
                  <Button data-align="distribute-x" variant="outline">
                    {'가로 간격'}
                  </Button>
                  <Button data-align="distribute-y" variant="outline">
                    {'세로 간격'}
                  </Button>
                </div>
              </div>
              <label className="snap-setting">
                <Input type="checkbox" id="snap-enabled" />
                {' 정렬선에 맞추기\n              '}
                <small>{'Alt로 일시 해제'}</small>
              </label>
              <div className="inspector-divider"></div>
              <div className="field-heading">{'원래 위치에서 이동'}</div>
              <div className="coordinate-fields">
                <label>
                  {'X '}
                  <Input id="offset-x" type="number" step="1" aria-label="가로 이동 거리" />
                </label>
                <label>
                  {'Y '}
                  <Input id="offset-y" type="number" step="1" aria-label="세로 이동 거리" />
                </label>
              </div>
              <div className="nudge-controls">
                <Button data-nudge="left" aria-label="왼쪽으로 이동" variant="outline">
                  {'←'}
                </Button>
                <Button data-nudge="up" aria-label="위로 이동" variant="outline">
                  {'↑'}
                </Button>
                <Button data-nudge="down" aria-label="아래로 이동" variant="outline">
                  {'↓'}
                </Button>
                <Button data-nudge="right" aria-label="오른쪽으로 이동" variant="outline">
                  {'→'}
                </Button>
              </div>
              <div className="element-size" id="element-size"></div>
            </div>
            <details className="inspector-details">
              <summary>요소 정보·이름 변경</summary>
              <div className="element-kind" id="element-kind"></div>
              <details className="layer-alias-editor">
                <summary>{'레이어 이름 변경'}</summary>
                <label className="layer-alias-field">
                  {'레이어 별칭'}
                  <Input id="layer-alias" maxLength={120} placeholder="예: 고객 검색 영역" />
                </label>
                <Button id="save-layer-alias" variant="outline">
                  {'별칭 저장'}
                </Button>
                <Button id="clear-layer-alias" variant="ghost">
                  {'기본 이름 사용'}
                </Button>
              </details>
              <div id="element-path" className="element-path"></div>
              <Button
                id="select-parent"
                disabled={true}
                title="상위 요소 선택 · Shift+클릭"
                variant="outline"
              >
                {'\n            상위 요소 선택 ↑\n          '}
              </Button>
            </details>
            <details className="inspector-secondary">
              <summary>주석·삭제</summary>
              <Button id="inspector-delete" className="danger-outline" variant="outline">
                {'이 요소 삭제'}
              </Button>
              <div className="inspector-comment-summary">
                <p id="selected-comment-summary"></p>
                <Button id="edit-selected-comment" variant="outline">
                  {'주석 남기기'}
                </Button>
              </div>
            </details>
          </section>
        </div>
      </DialogSurface>
      <DialogSurface id="capture-status-dialog" aria-labelledby="capture-task-title">
        <TaskHeader
          title={<span id="capture-task-label">가져오기 정보</span>}
          titleId="capture-task-title"
          context={
            <span id="capture-task-context" hidden>
              가져오기 정보
            </span>
          }
          back={
            <Button
              id="capture-task-back"
              hidden
              variant="ghost"
              aria-label="가져오기 정보로 돌아가기"
              onClick={() => dispatchEditorCommand('capture-back')}
            >
              ←
            </Button>
          }
          close={
            <form method="dialog">
              <Button id="capture-task-close" aria-label="가져오기 정보 닫기" variant="ghost">
                ×
              </Button>
            </form>
          }
        />
        <section id="capture-info-view" hidden={false} className="capture-task-page">
          <p id="capture-status-summary" role="status"></p>
          <p id="capture-repair-summary" role="status"></p>
          <p className="capture-verification-note">
            아래는 수집 과정에서 확인한 정보입니다. 원본과의 시각적 일치율은 측정하지 않았습니다.
          </p>
          <p id="capture-status-scope"></p>
          <ul id="capture-status-list" className="capture-status-list"></ul>
          <p id="capture-status-empty" hidden>
            기록된 제한은 없습니다. 이미지·글자·배치가 원본과 같은지 확인한 뒤 편집하세요.
          </p>
          <Button
            id="repair-assets-button"
            onClick={() => dispatchEditorCommand('repair-assets')}
            variant="outline"
          >
            이미지·폰트 다시 읽기
          </Button>
          <p id="repair-assets-note"></p>
          <Button
            id="source-compare-button"
            onClick={() => dispatchEditorCommand('source-compare')}
            variant="outline"
          >
            원본 사진과 비교
          </Button>
          <p id="source-compare-unavailable" hidden>
            원본 촬영 사진이 없는 문서입니다. 편집 전 복제본과 실제 원본 사진은 다릅니다.
          </p>
          <Button id="capture-source-button" hidden={true} variant="outline">
            원본 사이트 확인
          </Button>
          <p id="capture-source-note" hidden>
            현재 사이트 상태는 가져온 시점과 다를 수 있습니다.
          </p>
        </section>
        <section id="repair-assets-dialog" hidden={true} className="capture-task-page">
          <p>
            저장된 주소에서 공개 자산을 다시 읽어 별도 미리보기를 만듭니다. 현재 편집과 촬영 원본은
            유지되며, 적용한 복구는 실행 취소할 수 있습니다.
          </p>
          <p>
            최대 16개·각 900KB·합계 1.25MB. 로그인 자산·SVG·캡처에 없는 선언은 복구하지 않습니다.
          </p>
          <ul id="repair-assets-results"></ul>
          <Button id="repair-assets-fetch" variant="outline">
            선택한 자산 다시 읽기
          </Button>
          <Button id="repair-assets-retry" hidden variant="outline">
            실패한 항목 다시 읽기
          </Button>
          <p id="repair-assets-status" role="status"></p>
          <div id="repair-assets-preview" className="repair-view"></div>
          <Button id="repair-assets-apply" variant="default" disabled>
            미리보기 적용
          </Button>
        </section>
        <section id="source-compare-dialog" hidden={true} className="capture-task-page">
          <p>저장된 실제 사진과 복제본을 비교합니다. 현재 웹사이트를 다시 촬영하지 않습니다.</p>
          <div className="reference-tools">
            <label>
              보기{' '}
              <NativeSelect id="source-compare-mode">
                <option value="side">좌우 비교</option>
                <option value="overlay">겹쳐 보기</option>
              </NativeSelect>
            </label>
            <label>
              복제본{' '}
              <NativeSelect id="source-compare-version">
                <option value="baseline">편집 전 복제본</option>
                <option value="current">현재 작업</option>
              </NativeSelect>
            </label>
            <label>
              배율{' '}
              <NativeSelect id="source-compare-zoom">
                <option value="fit">화면에 맞춤</option>
                <option value=".5">50%</option>
                <option value="1">100%</option>
                <option value="1.5">150%</option>
              </NativeSelect>
            </label>
            <label id="source-compare-blend-label" hidden>
              복제본 농도{' '}
              <Input id="source-compare-blend" type="range" min="0" max="100" defaultValue="50" />
            </label>
          </div>
          <div className="source-comparison-labels">
            <strong>가져오기 당시 실제 원본 사진</strong>
            <strong id="source-compare-clone-label">편집 전 복제본</strong>
          </div>
          <div id="source-compare-grid" className="source-comparison-grid">
            <div id="source-compare-photo" className="reference-view"></div>
            <div id="source-compare-clone" className="reference-view"></div>
          </div>
          <p id="source-compare-status" role="status"></p>
        </section>
      </DialogSurface>

      <DialogSurface id="comment-dialog" aria-labelledby="comment-dialog-title">
        <div className="popover-heading">
          <h2 id="comment-dialog-title">{'주석 남기기'}</h2>
          <Button id="close-comment-dialog" aria-label="주석 입력 닫기" variant="outline">
            {'×'}
          </Button>
        </div>
        <div id="comment-editor-host">
          <div className="comment-navigation">
            <Button id="comment-previous" variant="outline" aria-label="이전 요청">
              ← 이전
            </Button>
            <NativeSelect id="comment-request" aria-label="검토할 요청"></NativeSelect>
            <Button id="comment-next" variant="outline" aria-label="다음 요청">
              다음 →
            </Button>
            <span id="comment-progress" role="status"></span>
          </div>
          <strong id="comment-target-title"></strong>
          <div
            id="comment-target-preview"
            className="comment-target-preview"
            aria-label="주석 대상 미리보기"
          ></div>
          <small id="comment-preview-label"></small>
          <div id="comment-intent-suggestions" />
          <div className="component-comment">
            <label htmlFor="component-comment">{'이 요소에 주석 남기기'}</label>
            <p>{'어떻게 바꾸고 싶은지 적어 주세요. 입력 내용은 자동 저장됩니다.'}</p>
            <Textarea
              id="component-comment"
              rows={4}
              maxLength={4000}
              placeholder="예: 버튼을 오른쪽 위로 옮기고, 문구를 ‘고객 추가’로 바꿔 주세요."
            ></Textarea>
          </div>
        </div>
        <div className="comment-dialog-footer">
          <div className="comment-actions">
            <Button id="clear-comment" variant="outline">
              {'주석 삭제'}
            </Button>
            <Button id="save-comment" className="primary" variant="outline">
              {'완료'}
            </Button>
          </div>
          <span id="comment-status" role="status"></span>
        </div>
      </DialogSurface>
      <DialogSurface id="rename-dialog" aria-labelledby="rename-title">
        <form id="rename-form">
          <h2 id="rename-title">{'이름 변경'}</h2>
          <label htmlFor="rename-name">{'새 이름'}</label>
          <Input id="rename-name" maxLength={120} required={true} autoComplete="off" />
          <p id="rename-error" role="status"></p>
          <div className="rename-actions">
            <Button id="rename-cancel" type="button" variant="outline">
              {'취소'}
            </Button>
            <Button id="rename-save" className="primary" type="submit" variant="outline">
              {'저장'}
            </Button>
          </div>
        </form>
      </DialogSurface>
      <DialogSurface id="documents-dialog" aria-label="저장된 화면">
        <form method="dialog">
          <Button className="dialog-close" aria-label="문서 목록 닫기" variant="outline">
            {'×'}
          </Button>
        </form>
        <h2>{'저장된 화면'}</h2>
        <p>
          캔버스 편집은 자동 저장됩니다. 화면 이름은 ‘저장’으로 확정하세요. 삭제한 화면은 휴지통에서
          복구할 수 있습니다.
        </p>
        <div className="list-tabs">
          <Button id="documents-live" aria-pressed="true" variant="outline">
            {'저장된 화면'}
          </Button>
          <Button id="documents-trash" aria-pressed="false" variant="outline">
            {'휴지통'}
          </Button>
        </div>
        <Input
          id="document-search"
          type="search"
          aria-label="저장된 화면 검색"
          placeholder="화면 이름 또는 주소로 검색"
        />
        <p id="document-list-status" role="status"></p>
        <div id="document-list" className="document-list"></div>
      </DialogSurface>

      <aside
        id="comment-popover"
        className="comment-popover"
        aria-label="선택한 요소에 주석 작성"
        hidden={true}
      >
        <div className="popover-heading">
          <strong id="floating-comment-title">{'주석'}</strong>
          <Button id="close-comment-popover" aria-label="주석 입력 닫기" variant="outline">
            {'×'}
          </Button>
        </div>
        <div id="floating-comment-host"></div>
      </aside>
      <DialogSurface id="mcp-dialog">
        <form method="dialog">
          <Button className="dialog-close" aria-label="MCP 창 닫기" variant="outline">
            {'×'}
          </Button>
        </form>
        <div id="mcp-content">
          <div className="eyebrow">{'CONNECT YOUR AGENT'}</div>
          <h2>{'에이전트와 함께 편집'}</h2>
          <h3>로컬 MCP 서버 연결</h3>
          <p>
            {'\n        연결한 이 화면의 복제본만 에이전트가 읽고 편집합니다.'}
            <br />
            {'독립 앱에서는 자동으로\n        연결됩니다.\n      '}
          </p>
          <label className="review-note-label">
            {'로컬 서버 주소'}
            <Input id="mcp-address" defaultValue="http://127.0.0.1:8849" type="url" />
          </label>
          <label className="review-note-label">
            {'연결 코드'}
            <Input
              id="mcp-code"
              type="password"
              autoComplete="off"
              placeholder="에이전트가 준비한 연결 코드"
            />
          </label>
          <div className="export-actions">
            <Button id="mcp-disconnect" variant="outline">
              {'연결 끊기'}
            </Button>
            <Button id="mcp-connect" className="primary" variant="outline">
              {'연결'}
            </Button>
          </div>
          <div id="mcp-message" className="export-status" role="status"></div>
        </div>
      </DialogSurface>
      <DialogSurface id="tickets-dialog" aria-labelledby="tickets-title">
        <div id="tickets-content" />
      </DialogSurface>
      <Input id="file-input" type="file" accept=".json,.uiclone" hidden={true} />
      <div id="toast" className="toast" role="status" hidden={true}></div>
    </>
  );
}
