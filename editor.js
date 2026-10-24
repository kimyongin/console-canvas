import {saveDocument,getDocument,listDocuments} from './db.js';
import {CanvasScene,copy,validateSnapshot} from './engine.js';
import {download,instructionText,reviewPayload,buildReview} from './export.js';
import {createEditorController} from './editor-controller.js';
import {createMcpBridge} from './bridge-client.js';
import {createSnapshotHistory} from './snapshot-history.js';

const $=selector=>document.querySelector(selector);
const isExtension=typeof chrome!=='undefined'&&!!chrome.runtime?.id;
const state={snapshot:null,scene:null,undo:[],redo:[],expanded:new Set(),zoom:1,size:{width:1280,height:900},saving:Promise.resolve(),generation:0,commentTarget:null,mode:'edit',ready:false,revision:0,lastAction:null,lastSaveError:null,mcpStatus:{connected:false}};
const editorId=globalThis.crypto?.randomUUID?.()||('editor-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const kinds={text:'텍스트',pseudo:'생성된 문구',icon:'아이콘',raster:'이미지 레이어',element:'요소'};
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);}
function notice(message){$('#notice').textContent=message;$('#notice').hidden=!message;}
function checkpoint(){return {edits:copy(state.scene.edits),annotations:copy(state.scene.annotations),selected:state.scene.selected,note:$('#review-note').value,activeSnapshotId:state.timeline?.activeId||null};}
function applyCheckpoint(point){state.commentTarget=null;state.scene.setComments(point.annotations);state.scene.setEdits(point.edits);state.scene.select(point.selected);$('#review-note').value=point.note||'';}
function historyBefore(){state.undo.push(checkpoint());if(state.undo.length>100)state.undo.shift();state.redo=[];}
function commitCommentDraft(){if(state.scene&&state.commentTarget)state.scene.setComment(state.commentTarget,$('#component-comment').value);}
function changeCommitted(detail={}) {
  if(detail.cancel)state.undo.pop();else {state.revision++;state.lastAction={actor:detail.actor||'user',label:detail.label||'화면 편집'};}renderInspector();renderLayers();renderChanges();renderHistory();renderSnapshots();renderMcpStatus();save();
}
function renderHistory(){$('#undo').disabled=!state.undo.length;$('#redo').disabled=!state.redo.length;}
function undo(direction='undo',detail={}) {
  if(!state.scene)return;const from=state[direction],to=state[direction==='undo'?'redo':'undo'],previous=from.pop();if(!previous)return;
  to.push(checkpoint());applyCheckpoint(previous);if(state.timeline)state.timeline.activeId=previous.activeSnapshotId||null;state.revision++;state.lastAction={actor:detail.actor||'user',label:direction==='undo'?'실행 취소':'다시 실행'};renderInspector();renderLayers();renderChanges();renderHistory();renderSnapshots();renderMcpStatus();save();
}
function save() {
  if(!state.snapshot||!state.scene)return;
  const value={...state.snapshot,edits:copy(state.scene.edits),annotations:copy(state.scene.annotations),timeline:copy(state.timeline),note:$('#review-note').value,updatedAt:new Date().toISOString()};
  $('#save-status').textContent='저장 중…';
  state.saving=state.saving.catch(()=>{}).then(()=>saveDocument(value)).then(()=>{state.lastSaveError=null;$('#save-status').textContent='이 기기에 저장됨';}).catch(error=>{state.lastSaveError=error.message;$('#save-status').textContent='자동 저장 실패 · 파일로 저장해 주세요';});
}
function sizeChanged(size){state.size=size;updateZoom();}
function updateZoom() {
  if(!state.scene)return;
  const {width,height}=state.size,zoom=state.zoom;
  state.scene.setDisplayScale(zoom);
  $('#scene-frame').width=width;$('#scene-frame').height=height;$('#scene-frame').style.transform='scale('+zoom+')';
  $('#artboard').style.width=width*zoom+'px';$('#artboard').style.height=height*zoom+'px';
  const select=$('#zoom');let option=[...select.options].find(option=>Number(option.value)===zoom);
  if(!option){option=document.createElement('option');option.value=zoom;option.dataset.custom='';select.append(option);}option.textContent=Math.round(zoom*100)+'%';select.value=String(zoom);
  $('#canvas-dimensions').textContent=width+' × '+height+' · '+Math.round(zoom*100)+'%';
}
function zoomTo(value){state.zoom=Math.max(.1,Math.min(2.5,value));updateZoom();}
function fit(){zoomTo(Math.min(1,Math.max(.1,($('#viewport').clientWidth-96)/state.size.width)));}
function renderInspector() {
  const scene=state.scene,id=scene?.selected,node=id&&scene.nodes.get(id);
  $('#no-selection').hidden=!!node;$('#inspector').hidden=!node;
  $('#delete').disabled=!node||scene.hidden(id)||state.mode==='comment';$('#select-parent').disabled=!node||!scene.parent(id);
  $('#direct-edit-controls').hidden=state.mode==='comment';
  if(!node){state.commentTarget=null;return;}
  const comment=scene.annotations[id]||'';
  if(state.commentTarget!==id||document.activeElement!==$('#component-comment'))$('#component-comment').value=comment;
  state.commentTarget=id;$('#clear-comment').disabled=!comment&&!$('#component-comment').value.trim();
  $('#comment-status').textContent=comment?'저장된 주석 · 전달 파일에 포함됩니다.':'주석은 화면을 바꾸지 않고 요청으로 전달됩니다.';
  $('#element-kind').textContent=(kinds[node.kind]||'요소')+' · '+node.tag;
  $('#element-name').textContent=node.name||node.tag;
  $('#element-path').textContent=[...scene.ancestors(id).reverse().map(id=>scene.nodes.get(id).tag),node.tag].join(' › ')+' · '+id;
  const edit=scene.edits[id]||{};$('#offset-x').value=edit.dx||0;$('#offset-y').value=edit.dy||0;
  const rect=scene.rect(id)||node.rect;$('#element-size').textContent=Math.round(rect.width)+' × '+Math.round(rect.height)+' px'+(scene.hidden(id)?' · 삭제됨':'');
  $('#inspector-delete').disabled=scene.hidden(id);
}
function selectNode(id,{reveal=false}={}) {
  if(!state.scene)return;
  state.scene.select(id);for(const parent of state.scene.ancestors(id))state.expanded.add(parent);renderLayers();
  if(reveal){const r=state.scene.rect(id);if(r){$('#viewport').scrollTo({left:Math.max(0,r.x*state.zoom-100),top:Math.max(0,r.y*state.zoom-100),behavior:'smooth'});}}
}
function renderLayers() {
  const scene=state.scene,container=$('#layers');if(!scene)return;
  const query=$('#layer-search').value.trim().toLowerCase(),fragment=document.createDocumentFragment();
  const commentNumbers=new Map(Object.keys(scene.annotations).map((id,index)=>[id,index+1]));
  const children=new Map();for(const node of scene.nodes.values()){if(!children.has(node.parentId))children.set(node.parentId,[]);children.get(node.parentId).push(node);}
  let matches=null;
  if(query){matches=new Set();for(const node of scene.nodes.values())if((node.name+' '+node.tag+' '+node.id).toLowerCase().includes(query)){matches.add(node.id);scene.ancestors(node.id).forEach(id=>matches.add(id));}}
  function add(node,depth) {
    if(matches&&!matches.has(node.id))return;
    const descendants=children.get(node.id)||[],expanded=state.expanded.has(node.id)||!!query;
    const row=document.createElement('div');row.className='layer-row'+(scene.selected===node.id?' selected':'')+(scene.hidden(node.id)?' deleted':'');row.style.paddingLeft=Math.min(depth*12,96)+'px';row.dataset.layerId=node.id;
    const toggle=document.createElement('button');toggle.className='tree-toggle';toggle.textContent=descendants.length?(expanded?'⌄':'›'):'';toggle.disabled=!descendants.length;toggle.setAttribute('aria-label',(expanded?'접기':'펼치기')+' '+node.name);toggle.setAttribute('aria-expanded',String(expanded));
    toggle.addEventListener('click',()=>{if(state.expanded.has(node.id))state.expanded.delete(node.id);else state.expanded.add(node.id);renderLayers();});
    const pick=document.createElement('button');pick.className='layer-pick';pick.setAttribute('aria-pressed',String(scene.selected===node.id));
    const icon=document.createElement('span');icon.className='layer-icon';icon.textContent=node.kind==='text'?'T':node.kind==='icon'?'◇':node.kind==='raster'?'▧':'▱';
    const label=document.createElement('span');label.className='layer-label';label.textContent=node.name||node.tag;pick.title=node.name+' · '+node.tag+' · '+node.id;pick.append(icon,label);pick.addEventListener('click',()=>selectNode(node.id,{reveal:true}));row.append(toggle,pick);
    if(scene.annotations[node.id]){const mark=document.createElement('span');mark.className='layer-comment';mark.textContent='주석 '+commentNumbers.get(node.id);mark.title=scene.annotations[node.id];row.append(mark);}
    if(scene.edits[node.id]?.deleted||scene.edits[node.id]?.dx||scene.edits[node.id]?.dy){const mark=document.createElement('span');mark.className='layer-mark';mark.textContent=scene.edits[node.id]?.deleted?'×':'•';row.append(mark);}
    fragment.append(row);if(expanded)descendants.forEach(child=>add(child,depth+1));
  }
  (children.get(null)||[]).forEach(node=>add(node,0));container.replaceChildren(fragment);
  $('#layer-count').textContent=scene.elements.size.toLocaleString();
}
function renderChanges() {
  if(!state.scene)return;const changes=state.scene.changes(),comments=state.scene.comments(),container=$('#changes');container.replaceChildren();$('#change-count').textContent=changes.length+comments.length;
  if(!changes.length&&!comments.length){const empty=document.createElement('div');empty.className='empty-small';empty.textContent='이동·삭제 기록과 요소별 주석을 모읍니다.';container.append(empty);}
  for(const change of changes){const item=document.createElement('div');item.className='change-item';const title=document.createElement('strong');title.textContent=change.name;const detail=document.createElement('span');detail.textContent=change.action==='delete'?'삭제'+(change.affectedDescendants?' · 하위 '+change.affectedDescendants+'개 포함':''):'X '+change.delta.x+' · Y '+change.delta.y;item.append(title,detail);container.append(item);}
  comments.forEach((comment,index)=>{const item=document.createElement('div');item.className='change-item';const pick=document.createElement('button');pick.type='button';const title=document.createElement('strong');title.textContent='주석 '+(index+1)+' · '+comment.name;pick.append(title);pick.addEventListener('click',()=>{selectNode(comment.id,{reveal:true});focusComment();});const text=document.createElement('span');text.className='comment-text';text.textContent=comment.text;item.append(pick,text);if(comment.targetDeleted){const deleted=document.createElement('span');deleted.className='comment-target-deleted';deleted.textContent='대상이 삭제된 상태 · 요청 내용 확인 필요';item.append(deleted);}container.append(item);});
}
function focusComment(){const field=$('#component-comment');field.focus({preventScroll:true});field.scrollIntoView({block:'nearest'});}
const snapshotHistory=createSnapshotHistory({state,checkpoint,historyBefore,apply:applyCheckpoint,changed:changeCommitted});
function showSnapshots(show=true){$('#snapshot-panel').hidden=!show;$('#inspect-panel').hidden=show;$('#snapshots-button').setAttribute('aria-expanded',String(show));if(show)renderSnapshots();}
function renderSnapshots() {
  if(!state.timeline)return;
  const entries=snapshotHistory.list(),index=entries.findIndex(e=>e.active),dirty=snapshotHistory.dirty();
  $('#snapshot-count').textContent=entries.length;$('#snapshot-position').textContent=(index+1)+' / '+entries.length;
  $('#previous-snapshot').disabled=index<=0;$('#next-snapshot').disabled=index<0||index>=entries.length-1;
  $('#snapshot-current').textContent=dirty?'현재 작업 중 · 다른 버전으로 이동하면 자동 보관됩니다.':'저장된 버전을 보고 있습니다.';
  const fragment=document.createDocumentFragment();
  entries.forEach((entry,i)=>{
    const button=document.createElement('button');button.type='button';button.className='snapshot-entry';button.dataset.snapshotId=entry.id;button.setAttribute('aria-pressed',String(entry.active));
    const title=document.createElement('strong');title.textContent=(i+1)+'. '+entry.name;
    const meta=document.createElement('span');meta.textContent=new Date(entry.created_at).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · 변경 '+entry.change_count+' · 주석 '+entry.comment_count;
    const badge=document.createElement('small');badge.textContent=entry.active?(dirty?'현재 버전 + 편집 중':'현재 버전'):entry.kind==='automatic'?'이동 전 자동 보관':entry.kind==='initial'?'시작점':'저장된 버전';
    button.append(title,meta,badge);button.addEventListener('click',()=>restoreSnapshot(entry.id));fragment.append(button);
  });$('#snapshot-list').replaceChildren(fragment);
}
function restoreSnapshot(id){try{commitCommentDraft();const result=snapshotHistory.restore(id);toast(result.automatic_snapshot_id?'현재 작업을 자동 보관하고 스냅샷으로 이동했어요.':'저장한 스냅샷으로 이동했어요.');}catch(error){toast(error.message);}}
$('#snapshots-button').addEventListener('click',()=>{commitCommentDraft();showSnapshots($('#snapshot-panel').hidden);});
$('#close-snapshots').addEventListener('click',()=>showSnapshots(false));
$('#snapshot-form').addEventListener('submit',event=>{event.preventDefault();try{commitCommentDraft();snapshotHistory.create($('#snapshot-name').value);$('#snapshot-name').value='';toast('현재 화면과 주석을 스냅샷으로 저장했어요.');}catch(error){toast(error.message);}});
for(const [id,delta] of [['#previous-snapshot',-1],['#next-snapshot',1]])$(id).addEventListener('click',()=>{const entries=snapshotHistory.list(),index=entries.findIndex(e=>e.active);if(entries[index+delta])restoreSnapshot(entries[index+delta].id);});
function onKey(event) {
  if(!state.scene||$('#export-dialog').open)return;
  const editing=event.target.closest?.('input,textarea,select');if(editing&&event.target.ownerDocument===document)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo(event.shiftKey?'redo':'undo');return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();undo('redo');return;}
  if(event.key==='Escape'){state.scene.select(null);renderLayers();return;}
  if(state.mode==='comment')return;
  if(event.key==='Delete'||event.key==='Backspace'){if(state.scene.selected){event.preventDefault();state.scene.remove();}return;}
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(delta&&state.scene.selected){event.preventDefault();state.scene.nudge(delta[0]*(event.shiftKey?10:1),delta[1]*(event.shiftKey?10:1));}
}
async function openSnapshot(snapshot,edits={},note='',annotations={},timeline=null) {
  validateSnapshot(snapshot);const generation=++state.generation;
  commitCommentDraft();state.commentTarget=null;state.ready=false;state.revision++;
  $('#welcome').hidden=true;$('#artboard-space').hidden=false;$('#export-button').disabled=true;$('#snapshots-button').disabled=true;
  const {timeline:storedTimeline,edits:storedEdits,annotations:storedComments,note:storedNote,...capture}=snapshot;
  timeline=timeline||storedTimeline;state.timeline=null;state.snapshot=capture;state.undo=[];state.redo=[];state.expanded=new Set(snapshot.nodes.filter(node=>!node.parentId).map(node=>node.id));
  $('#source-title').textContent=snapshot.source.title||'가져온 화면';$('#document-title').textContent=snapshot.source.title||'가져온 화면';$('#source-url').textContent=snapshot.source.url;
  try {const url=new URL(snapshot.source.url);$('#source-url').href=/^https?:$/.test(url.protocol)?url.href:'#';}catch{$('#source-url').href='#';}
  $('#source-url').hidden=false;$('#source-meta').textContent=snapshot.source.viewport.width+' × '+snapshot.source.viewport.height+' · '+snapshot.nodes.length.toLocaleString()+'개 요소';$('#review-note').value=note;
  $('#artboard-label').textContent=(snapshot.source.title||'화면')+' / '+snapshot.source.viewport.width+' px';
  const scene=new CanvasScene($('#scene-frame'),snapshot,{onSelect:id=>{if(id!==state.commentTarget)commitCommentDraft();if(state.scene&&id)for(const parent of state.scene.ancestors(id))state.expanded.add(parent);renderInspector();renderLayers();},onCommentSelect:focusComment,onSize:sizeChanged,onBeforeChange:historyBefore,onLiveChange:renderInspector,onCommit:changeCommitted,onKey});
  state.scene=scene;
  try {await scene.mount();if(generation!==state.generation)return;scene.interactionMode=state.mode;scene.setComments(annotations);scene.setEdits(edits);snapshotHistory.initialise(timeline);fit();$('#viewport').scrollLeft=(snapshot.source.scroll?.x||0)*state.zoom;$('#viewport').scrollTop=(snapshot.source.scroll?.y||0)*state.zoom;renderInspector();renderLayers();renderChanges();renderHistory();renderSnapshots();$('#export-button').disabled=false;$('#snapshots-button').disabled=false;
    $('#capture-notes').hidden=!snapshot.warnings.length;$('#capture-notes-title').textContent='가져오기 참고 '+snapshot.warnings.length+'건';$('#capture-notes-list').replaceChildren();
    for(const warning of snapshot.warnings){const li=document.createElement('li');li.textContent=warning.message;$('#capture-notes-list').append(li);}
    state.ready=true;connectDesktopIfReady();renderMcpStatus();save();toast('화면을 가져왔어요. 요소를 옮기거나 주석으로 수정 방향을 남겨 보세요.');
  }catch(error){notice(error.message);$('#welcome').hidden=false;$('#artboard-space').hidden=true;throw error;}
}
async function loadSample() {
  const button=$('#sample-button');button.disabled=true;button.textContent='콘솔 화면을 가져오는 중…';
  let source;
  try {
    if(window.CONSOLE_CANVAS_SAMPLE){await openSnapshot(copy(window.CONSOLE_CANVAS_SAMPLE));return;}
    source=document.createElement('iframe');source.width='1360';source.height='980';source.style.cssText='position:fixed;left:-20000px;top:0;width:1360px;height:980px;border:0';source.src='fixtures/console.html';
    const loaded=new Promise((resolve,reject)=>{source.onload=resolve;source.onerror=()=>reject(new Error('샘플 화면을 열지 못했습니다.'));});document.body.append(source);await loaded;
    const snapshot=await globalThis.UICloneCapture.capture(source.contentDocument);await openSnapshot(snapshot);
  }catch(error){notice(error.message);}finally{source?.remove();button.disabled=false;button.textContent='샘플 콘솔로 시작 →';}
}
async function importFile(file) {
  if(!file)return;if(file.size>85_000_000)throw new Error('파일이 너무 큽니다. 85MB 이하의 화면 파일을 선택해 주세요.');
  const data=JSON.parse(await file.text());
  if(data.format==='console-canvas-review'){await openSnapshot(data.snapshot,data.edits,data.note||'',data.annotations||{},data.timeline);}
  else await openSnapshot(data,data.edits||{},data.note||'',data.annotations||{},data.timeline);
}
$('#file-input').addEventListener('change',event=>{importFile(event.target.files[0]).catch(error=>notice('파일을 열지 못했습니다: '+error.message));event.target.value='';});
for(const id of ['#import-button','#welcome-import'])$(id).addEventListener('click',()=>$('#file-input').click());
$('#installation-button').addEventListener('click',()=>{$('#import-guide').hidden=!$('#import-guide').hidden;});
$('#sample-button').addEventListener('click',loadSample);
$('#layer-search').addEventListener('input',renderLayers);
$('#component-comment').addEventListener('input',()=>{$('#comment-status').textContent='작성 중 · 저장하거나 다른 요소를 선택하면 기록됩니다.';$('#clear-comment').disabled=!$('#component-comment').value.trim()&&!state.scene?.annotations[state.commentTarget];});
$('#component-comment').addEventListener('change',commitCommentDraft);
$('#save-comment').addEventListener('click',()=>{commitCommentDraft();renderInspector();});
$('#clear-comment').addEventListener('click',()=>{$('#component-comment').value='';commitCommentDraft();renderInspector();});
$('#comment-mode').addEventListener('click',()=>{commitCommentDraft();state.mode=state.mode==='comment'?'edit':'comment';if(state.scene)state.scene.interactionMode=state.mode;$('#comment-mode').setAttribute('aria-pressed',String(state.mode==='comment'));$('#canvas-hint').textContent=state.mode==='comment'?'요소 클릭 → 오른쪽에 주석 작성 · 드래그로 이동하지 않습니다.':'클릭해서 선택 · 드래그해서 이동 · Shift+클릭으로 상위 요소 선택';renderInspector();});
$('#undo').addEventListener('click',()=>undo());$('#redo').addEventListener('click',()=>undo('redo'));
$('#select-parent').addEventListener('click',()=>selectNode(state.scene.parent(state.scene.selected)));
$('#delete').addEventListener('click',()=>state.scene?.remove());$('#inspector-delete').addEventListener('click',()=>state.scene?.remove());
for(const button of document.querySelectorAll('[data-nudge]'))button.addEventListener('click',()=>{const delta={left:[-8,0],up:[0,-8],down:[0,8],right:[8,0]}[button.dataset.nudge];state.scene?.nudge(...delta);});
for(const id of ['#offset-x','#offset-y'])$(id).addEventListener('change',()=>state.scene?.setPosition(Number($('#offset-x').value),Number($('#offset-y').value)));
$('#zoom').addEventListener('change',event=>zoomTo(Number(event.target.value)));$('#zoom-in').addEventListener('click',()=>zoomTo(state.zoom+.1));$('#zoom-out').addEventListener('click',()=>zoomTo(state.zoom-.1));$('#fit').addEventListener('click',fit);
$('#viewport').addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();zoomTo(state.zoom+(event.deltaY>0?-.05:.05));}},{passive:false});
document.addEventListener('keydown',onKey);
$('#review-note').addEventListener('change',()=>changeCommitted({label:'추가 설명 수정'}));
$('#export-button').addEventListener('click',()=>{commitCommentDraft();const changes=state.scene.changes(),deleted=changes.filter(c=>c.action==='delete').length;$('#export-summary').textContent='이동 '+(changes.length-deleted)+'개 · 삭제 '+deleted+'개 · 주석 '+state.scene.comments().length+'개 · 원본과 편집본 포함';$('#export-status').textContent='주석은 수정 요청으로 전달되며 화면에 자동 반영되지 않습니다. ZIP을 이 대화에 첨부해 주세요.';$('#export-dialog').showModal();});
$('#copy-summary').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(instructionText(state.snapshot,state.scene.changes(),$('#review-note').value,state.scene.comments()));$('#export-status').textContent='지시문을 복사했어요. 이 대화에 붙여넣을 수 있습니다.';}catch{$('#export-status').textContent='클립보드에 접근하지 못했습니다. ZIP의 instructions.txt를 사용해 주세요.';}});
$('#download-session').addEventListener('click',()=>{download('console-canvas-'+state.snapshot.id.slice(0,8)+'.uiclone.json',JSON.stringify(reviewPayload(state.snapshot,state.scene,$('#review-note').value,state.timeline)),'application/json');$('#export-status').textContent='스냅샷 목록을 포함해 편집 파일을 저장했어요. 화면 파일 열기로 다시 편집할 수 있습니다.';});
$('#download-review').addEventListener('click',async()=>{
  const button=$('#download-review');button.disabled=true;
  try {const result=await buildReview(state.snapshot,state.scene,$('#review-note').value,message=>$('#export-status').textContent=message,state.timeline);download('console-canvas-review-'+state.snapshot.id.slice(0,8)+'.zip',result.blob);$('#export-status').textContent='ZIP을 저장했어요. 이 대화에 첨부하고 “이 편집 결과를 기준으로 수정해 줘”라고 보내 주세요.'+(result.warnings.length?' 비교 이미지 일부를 생성하지 못해 HTML 비교 화면을 포함했습니다.':'');}
  catch(error){$('#export-status').textContent='내보내지 못했습니다: '+error.message;}finally{button.disabled=false;}
});
window.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
window.addEventListener('drop',event=>{if(event.dataTransfer?.files.length){event.preventDefault();importFile(event.dataTransfer.files[0]).catch(error=>notice(error.message));}});
function renderMcpStatus() {
  const status=state.mcpStatus;$('#mcp-button').textContent=status.connected?'MCP 연결됨':'MCP 연결';$('#mcp-button').classList.toggle('connected',!!status.connected);
  $('#mcp-state').textContent=(status.connected?'MCP 연결됨 · r'+state.revision:status.message||'MCP 연결 안 됨')+(state.lastAction?' · '+(state.lastAction.actor==='agent'?'에이전트':'직접 편집')+' '+state.lastAction.label:'');
}
const controller=createEditorController({state,editorId,checkpoint,historyBefore,changeCommitted,undo,snapshotHistory,
  isBusy:()=>$('#export-dialog').open||$('#mcp-dialog').open||document.activeElement===$('#snapshot-name')||!!(state.commentTarget&&$('#component-comment').value.trim()!==(state.scene?.annotations[state.commentTarget]||'')),
  render:()=>{renderInspector();renderLayers();renderChanges();renderHistory();},flush:async()=>{await state.saving;return !state.lastSaveError;}});
const mcpBridge=createMcpBridge({metadata:controller.metadata,execute:controller.execute,onStatus:status=>{state.mcpStatus=status;renderMcpStatus();}});
$('#mcp-button').addEventListener('click',()=>$('#mcp-dialog').showModal());
$('#mcp-connect').addEventListener('click',async()=>{const button=$('#mcp-connect');button.disabled=true;try{commitCommentDraft();await mcpBridge.connect($('#mcp-address').value.trim(),$('#mcp-code').value.trim());$('#mcp-code').value='';$('#mcp-dialog').close();}catch(error){$('#mcp-message').textContent=error.message;}finally{button.disabled=false;}});
$('#mcp-disconnect').addEventListener('click',async()=>{await mcpBridge.disconnect();$('#mcp-dialog').close();});
if(window.ConsoleCanvasDesktop){
  document.body.classList.add('desktop-editor');
  window.ConsoleCanvasDesktop.onBeforeUpdate(async()=>{if(state.scene?.drag)throw new Error('요소 드래그를 마친 뒤 다시 시도해 주세요.');if(state.snapshot&&!state.ready)throw new Error('화면을 여는 중입니다. 잠시 후 다시 시도해 주세요.');commitCommentDraft();save();await state.saving;if(state.lastSaveError)throw new Error('편집 내용을 저장하지 못했습니다. 파일로 백업한 뒤 다시 시도해 주세요.');return {document_id:state.snapshot?.id||null};});
  window.ConsoleCanvasDesktop.onSnapshot(value=>openSnapshot(value).catch(error=>notice(error.message)));
  window.ConsoleCanvasDesktop.getConnection().then(connection=>{if(connection){state.desktopConnection=connection;connectDesktopIfReady();}}).catch(error=>notice(error.message));
}
const params=new URLSearchParams(location.search);
if(params.has('error'))notice(params.get('error'));
if(params.has('id'))getDocument(params.get('id')).then(value=>{if(!value)throw new Error('저장된 화면을 찾을 수 없습니다. 웹사이트에서 다시 가져와 주세요.');return openSnapshot(value,value.edits,value.note,value.annotations);}).catch(error=>notice(error.message));
else if(params.has('sample'))loadSample();
else listDocuments().then(values=>{for(const snapshot of values.slice(0,4)){const button=document.createElement('button');button.className='recent-item';const title=document.createElement('span');title.textContent=snapshot.source.title;const date=document.createElement('small');date.textContent=new Date(snapshot.capturedAt).toLocaleDateString('ko-KR');button.append(title,date);button.addEventListener('click',()=>openSnapshot(snapshot,snapshot.edits,snapshot.note,snapshot.annotations));$('#recent-documents').append(button);}}).catch(()=>{});
// Exposed for the local integration harness; contains only this editor's current document.
window.ConsoleCanvas={state,openSnapshot,importFile,undo,selectNode,controller,snapshotHistory,buildReview:()=>buildReview(state.snapshot,state.scene,$('#review-note').value,undefined,state.timeline)};
function connectDesktopIfReady(){if(state.desktopConnection&&state.ready&&!mcpBridge.isConnected()){const connection=state.desktopConnection;state.desktopConnection=null;mcpBridge.connect(connection.url,connection.token).catch(error=>notice(error.message));}}
