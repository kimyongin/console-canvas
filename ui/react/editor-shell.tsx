import { useSyncExternalStore } from 'react';
import type { EditorAdapter } from './store';
import { dispatchEditorCommand } from './commands';
import { Button } from './components/button';
import { Input } from './components/input';
import { Textarea } from './components/textarea';
import { DialogSurface, NativeSelect } from './components/surfaces';
const emptySubscribe = () => () => {};
export function EditorShell({ adapter }: { adapter?: EditorAdapter }) {
  useSyncExternalStore(adapter?.subscribe || emptySubscribe, () => {
    const v = adapter?.getSnapshot();
    return v
      ? [v.ready, v.selected, v.selectedHidden, v.undoCount, v.redoCount].join('/')
      : 'initial';
  });
  const view = adapter?.getSnapshot();
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
            id="snapshots-button"
            onClick={() => dispatchEditorCommand('snapshots')}
            disabled={!view?.ready}
            aria-controls="snapshot-save-dialog"
            variant="outline"
          >
            {'\n          스냅샷 저장 '}
            <span id="snapshot-count" className="sr-only">
              {'0'}
            </span>
          </Button>
          <Button id="export-button" className="primary" disabled={true} variant="outline">
            {'\n          변경 내용 전달 '}
            <span aria-hidden="true">{'↗'}</span>
          </Button>
        </div>
      </header>
      <DialogSurface id="ai-dialog">
        <div id="ai-dialog-content" />
      </DialogSurface>
      <div id="notice" className="notice" role="status" hidden={true}></div>
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
            <Input
              id="layer-search"
              type="search"
              placeholder="텍스트·버튼·요소 찾기"
              aria-label="레이어 검색"
            />
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
            aria-label="변경 이력 패널 너비 조절"
            aria-orientation="vertical"
            aria-controls="properties-panel"
            title="드래그로 변경 이력 너비 조절 · 방향키로 미세 조절"
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
                <Button id="documents-button" variant="outline">
                  {'저장된 화면 전환…'}
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
                    '\n                작업은 자동 저장됩니다. 스냅샷은 시안 보관, 편집 파일은 기기 밖 백업에 사용하세요.\n              '
                  }
                </p>
                <details id="source-details">
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
              id="ai-variants-button"
              disabled={!view?.ready}
              onClick={() => dispatchEditorCommand('ai')}
              variant="outline"
            >
              ✨ AI 시안
            </Button>
            <Button
              id="snapshot-dropdown"
              disabled={true}
              popoverTarget="snapshot-panel"
              aria-label="스냅샷 목록"
              title="저장된 버전 사이 이동"
              variant="outline"
            >
              <span>{'스냅샷 목록 · '}</span>
              <span id="snapshot-active-name">{'문서 열기'}</span>
              {' ⌄\n          '}
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
              <div className="import-guide" id="import-guide" hidden={true}>
                <strong>{'Chrome 확장 프로그램 설치'}</strong>
                <ol>
                  <li>
                    <code>{'chrome://extensions'}</code>
                    {'에서 개발자 모드를 켭니다.'}
                  </li>
                  <li>
                    {
                      '\n                  ‘압축해제된 확장 프로그램을 로드합니다’를 누르고\n                  '
                    }
                    <code>{'console-canvas'}</code>
                    {' 폴더를 선택합니다.\n                '}
                  </li>
                  <li>{'원하는 웹사이트에서 확장 프로그램 버튼을 누르면 이 편집기가 열립니다.'}</li>
                </ol>
                <p>{'현재 화면에 보이는 데이터가 복제본에 포함됩니다.'}</p>
              </div>
              <div id="recent-documents" className="recent-documents"></div>
            </div>
            <div id="artboard-space" className="artboard-space" hidden={true}>
              <div id="artboard-label" className="artboard-label"></div>
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
            <Button
              id="context-ai"
              aria-label="선택 요소 AI 시안 만들기"
              disabled={!view?.selected || !!view?.selectedHidden}
              onClick={() => dispatchEditorCommand('ai')}
              variant="outline"
            >
              ✨ 시안 만들기
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
                {'맞춤'}
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
            <span id="version-status"></span>
            <span id="canvas-hint">
              {'빈 곳 드래그로 영역 선택 · ⌘/Ctrl+클릭 추가 선택 · ⌘/Ctrl+C / V 복사·붙여넣기'}
            </span>
            <span id="canvas-dimensions">{'독립된 복제본'}</span>
            <span id="mcp-state" role="status">
              {'MCP 연결 안 됨'}
            </span>
          </div>
        </section>
        <aside className="right-panel" id="properties-panel" aria-label="변경 이력 패널">
          <div className="panel-heading panel-topbar">
            <strong id="properties-panel-title">{'변경 이력'}</strong>
            <span id="activity-count" className="history-count">
              {'0'}
            </span>
            <div id="properties-toggle-home" className="panel-toggle-slot"></div>
          </div>
          <section id="history-panel" aria-label="통합 변경 이력">
            <div className="activity-controls">
              <label>
                {'범위'}
                <NativeSelect id="activity-scope">
                  <option value="branch">{'현재 가지'}</option>
                  <option value="all">{'모든 가지'}</option>
                </NativeSelect>
              </label>
              <label>
                {'종류'}
                <NativeSelect id="activity-filter">
                  <option value="all">{'전체'}</option>
                  <option value="layout">{'배치'}</option>
                  <option value="property">{'속성'}</option>
                  <option value="comment">{'주석'}</option>
                </NativeSelect>
              </label>
            </div>
            <Input
              id="activity-search"
              type="search"
              placeholder="대상·주석·변경 검색"
              aria-label="변경 이력 검색"
            />
            <label className="activity-selected">
              <Input id="activity-selected" type="checkbox" />
              {'선택 요소만'}
            </label>
            <p id="activity-branch" className="activity-branch"></p>
            <div id="activity-list" className="activity-list"></div>
          </section>
        </aside>
        <aside
          id="properties-rail"
          className="panel-rail properties-rail"
          aria-label="접힌 변경 이력 패널"
          hidden={true}
        >
          <div id="properties-toggle-rail" className="panel-toggle-slot">
            <Button
              id="toggle-properties"
              className="panel-toggle"
              type="button"
              aria-controls="properties-panel"
              aria-expanded="true"
              aria-label="변경 이력 패널 접기"
              title="변경 이력 패널 접기"
              variant="outline"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <rect x="2" y="3" width="16" height="14" rx="2"></rect>
                <path d="M13 3v14"></path>
                <path className="panel-open-chevron" d="M8 6l4 4-4 4"></path>
                <path className="panel-fill" d="M14 4h3v12h-3z"></path>
              </svg>
              <span>{'변경 이력'}</span>
            </Button>
          </div>
          <span className="panel-rail-label" aria-hidden="true">
            {'변경 이력'}
          </span>
        </aside>
      </main>
      <div id="snapshot-panel" className="snapshot-browser" popover="auto" aria-label="스냅샷 목록">
        <div className="snapshot-navigation-header">
          <div className="snapshot-browser-heading">
            <div>
              <h2>{'스냅샷 목록'}</h2>
              <p>{'노드를 선택해 미리 보고, 이 버전으로 이동하세요.'}</p>
            </div>
            <Button id="close-snapshots" aria-label="스냅샷 목록 닫기" variant="outline">
              {'×'}
            </Button>
          </div>
          <div className="list-tabs">
            <Button id="snapshots-live" aria-pressed="true" variant="outline">
              {'저장된 버전'}
            </Button>
            <Button id="snapshots-trash" aria-pressed="false" variant="outline">
              {'휴지통'}
            </Button>
          </div>
          <div id="snapshot-current" role="status"></div>
          <div id="snapshot-find" className="snapshot-find">
            <div className="snapshot-search-field">
              <Input
                id="snapshot-search"
                type="search"
                aria-label="스냅샷 검색"
                placeholder="스냅샷 이름 검색"
                autoComplete="off"
              />
              <div id="snapshot-search-results" aria-label="스냅샷 검색 결과" hidden></div>
            </div>
            <Button
              id="snapshot-find-current"
              onClick={() => dispatchEditorCommand('snapshot-current')}
              variant="outline"
            >
              현재 버전 찾기
            </Button>
          </div>
        </div>
        <div id="snapshot-tools">
          <div
            id="snapshot-graph-scroll"
            className="snapshot-graph-scroll"
            tabIndex={0}
            aria-label="스냅샷 분기 그래프 · 가로 스크롤"
          >
            <div id="snapshot-list" className="snapshot-graph"></div>
          </div>
          <div
            id="snapshot-splitter"
            role="separator"
            tabIndex={0}
            aria-label="그래프와 미리보기 크기 조절"
            aria-orientation="horizontal"
            aria-valuemin={100}
            aria-valuemax={360}
            aria-valuenow={170}
          ></div>
          <div className="snapshot-legend">
            {
              '\n          ● 현재 버전 · ◉ 선택한 미리보기 · 점선은 저장 전 작업 · 가로로 스크롤하여 탐색\n        '
            }
          </div>
        </div>
        <p id="snapshot-trash-help" className="snapshot-help" hidden={true}>
          {
            '\n        복구만으로 현재 화면을 바꾸지 않습니다. 복구하고 적용하면 해당 버전으로 이동합니다.\n      '
          }
        </p>
        <div id="snapshot-trash-list" className="snapshot-trash-list" hidden={true}></div>
        <section
          id="snapshot-preview"
          className="snapshot-preview"
          aria-label="선택한 스냅샷 미리보기"
        >
          <div className="snapshot-preview-heading">
            <div>
              <h3 id="snapshot-preview-title">{'버전을 선택하세요'}</h3>
              <p id="snapshot-preview-status" role="status">
                {'\n              선택만으로 현재 편집은 바뀌지 않습니다.\n            '}
              </p>
            </div>
            <Button id="compare-button" variant="outline">
              {'현재 작업과 비교'}
            </Button>
            <Button id="apply-snapshot" className="primary" disabled={true} variant="outline">
              {'이 버전으로 이동'}
            </Button>
          </div>
          <div id="snapshot-preview-view" className="snapshot-preview-view"></div>
        </section>
      </div>
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
          <details id="capture-notes" className="capture-notes" hidden={true}>
            <summary id="capture-notes-title">{'가져오기 참고사항'}</summary>
            <ul id="capture-notes-list"></ul>
          </details>
        </div>
      </DialogSurface>
      <DialogSurface id="snapshot-save-dialog" aria-labelledby="snapshot-save-title">
        <h2 id="snapshot-save-title">{'스냅샷 저장'}</h2>
        <p id="snapshot-parent-name"></p>
        <form id="snapshot-form">
          <label htmlFor="snapshot-name">{'스냅샷 이름'}</label>
          <div className="snapshot-create">
            <Input
              id="snapshot-name"
              maxLength={120}
              placeholder="예: 검색 영역 정리"
              required={true}
              autoComplete="off"
            />
            <Button id="save-snapshot" className="primary" type="submit" variant="outline">
              {'저장'}
            </Button>
          </div>
        </form>
        <Button id="cancel-snapshot" type="button" variant="outline">
          {'취소'}
        </Button>
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
            <div className="comment-request-pick">
              <NativeSelect id="comment-request" aria-label="검토할 요청"></NativeSelect>
              <span id="comment-progress" role="status"></span>
            </div>
            <Button id="comment-next" variant="outline" aria-label="다음 요청">
              다음 →
            </Button>
          </div>
          <strong id="comment-target-title"></strong>
          <div
            id="comment-target-preview"
            className="comment-target-preview"
            aria-label="주석 대상 미리보기"
          ></div>
          <small id="comment-preview-label"></small>
          <div className="component-comment">
            <label htmlFor="component-comment">{'이 요소에 주석 남기기'}</label>
            <p>{'어떻게 바꾸고 싶은지 적어 주세요. 입력 내용은 자동 저장됩니다.'}</p>
            <Textarea
              id="component-comment"
              rows={4}
              maxLength={4000}
              placeholder="예: 버튼을 오른쪽 위로 옮기고, 문구를 ‘고객 추가’로 바꿔 주세요."
            ></Textarea>
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
        <p>{'작업은 자동 저장됩니다. 삭제한 화면은 휴지통에서 복구할 수 있습니다.'}</p>
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
      <DialogSurface id="export-dialog">
        <form method="dialog">
          <Button className="dialog-close" aria-label="닫기" variant="outline">
            {'×'}
          </Button>
        </form>
        <div className="export-scroll">
          <div className="eyebrow">{'HAND OFF YOUR CHANGES'}</div>
          <h2>{'편집 방향을 전달하세요.'}</h2>
          <p>
            {'\n        변경 후 화면과 번호별 요청 카드를 이미지 한 장으로 전달합니다.'}
            <br />
            {'편집 파일 백업은 문서\n        메뉴에서 저장하세요.\n      '}
          </p>
          <label className="handoff-label">
            {'전달 기준'}
            <NativeSelect id="handoff-version"></NativeSelect>
          </label>
          <div id="export-summary" className="export-summary" role="status"></div>
          <div id="handoff-items" className="handoff-items" aria-label="번호별 요청 검토"></div>
          <label className="review-note-label">
            {'추가 설명 '}
            <span>{'선택'}</span>
            <Textarea
              id="review-note"
              rows={3}
              placeholder="예: 검색 조건을 위로 모으고 작업 버튼을 오른쪽에 정렬하고 싶어요."
            ></Textarea>
          </label>
          <div id="handoff-preview" className="handoff-preview"></div>
        </div>
        <div className="export-footer">
          <div className="export-actions">
            <Button id="copy-summary" variant="outline">
              {'이미지 복사'}
            </Button>
            <Button id="download-review" className="primary" variant="outline">
              {'전달 이미지 저장 ↓'}
            </Button>
          </div>
          <div id="export-status" className="export-status" aria-live="polite"></div>
        </div>
      </DialogSurface>
      <DialogSurface id="compare-dialog" aria-label="화면 버전 비교">
        <form method="dialog">
          <Button className="dialog-close" aria-label="비교 닫기" variant="outline">
            {'×'}
          </Button>
        </form>
        <h2>{'화면 비교'}</h2>
        <p>{'비교는 현재 작업이나 스냅샷을 변경하지 않습니다.'}</p>
        <div id="compare-diff" role="status"></div>
        <div className="compare-tools">
          <label>
            확대{' '}
            <NativeSelect id="compare-zoom" aria-label="비교 확대">
              <option value="fit">화면에 맞춤</option>
              <option value="0.5">50%</option>
              <option value="0.75">75%</option>
              <option value="1">100%</option>
              <option value="1.5">150%</option>
            </NativeSelect>
          </label>
          <label>
            <Input id="compare-sync" type="checkbox" defaultChecked />
            동기 스크롤
          </label>
          <label>
            변경 위치 <NativeSelect id="compare-target" aria-label="비교 변경 위치"></NativeSelect>
          </label>
          <div className="compare-step">
            <Button
              id="compare-previous"
              aria-label="이전 변경"
              onClick={() => dispatchEditorCommand('compare-previous')}
              variant="outline"
            >
              ← 이전
            </Button>
            <Button
              id="compare-next"
              aria-label="다음 변경"
              onClick={() => dispatchEditorCommand('compare-next')}
              variant="outline"
            >
              다음 →
            </Button>
          </div>
        </div>
        <div id="compare-focus-status" role="status"></div>
        <div className="compare-grid">
          <section>
            <NativeSelect id="compare-left" aria-label="비교할 첫 번째 버전"></NativeSelect>
            <div className="compare-view" id="compare-left-view"></div>
            <p id="compare-left-summary"></p>
          </section>
          <section>
            <NativeSelect id="compare-right" aria-label="비교할 두 번째 버전"></NativeSelect>
            <div className="compare-view" id="compare-right-view"></div>
            <p id="compare-right-summary"></p>
          </section>
        </div>
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
        <div className="eyebrow">{'CONNECT YOUR AGENT'}</div>
        <h2>{'에이전트와 함께 편집'}</h2>
        <section id="webmcp-controls" hidden>
          <h3>Chrome WebMCP</h3>
          <p>
            Chrome MCP에서 이 문서의 도구를 사용할 수 있도록 공개합니다. 공식 MCP의 Chrome 연결
            설정은 별도로 필요합니다. 문서를 바꾸거나 새로고침하면 다시 공개해야 합니다.
          </p>
          <p>
            <a
              href="https://github.com/kimyongin/console-canvas/blob/main/docs/chrome-webmcp.md"
              target="_blank"
              rel="noreferrer"
            >
              공식 MCP 설정·이미지 전달 안내
            </a>
          </p>
          <Button id="webmcp-enable" type="button">
            도구 공개
          </Button>
          <Button id="webmcp-disable" type="button" variant="outline">
            공개 해제
          </Button>
          <p id="webmcp-status" role="status">
            WebMCP 도구 미공개
          </p>
        </section>
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
      </DialogSurface>
      <Input id="file-input" type="file" accept=".json,.uiclone" hidden={true} />
      <div id="toast" className="toast" role="status" hidden={true}></div>
    </>
  );
}
