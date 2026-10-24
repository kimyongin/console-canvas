import {copy} from './engine.js';

// Shared by the browser editor and desktop shell. It operates only on a captured copy.
export function createEditorController(options) {
  const {state}=options;
  const failure=(code,message)=>({ok:false,error:{code,message},revision:state.revision});
  function metadata() {
    if(!state.ready||!state.scene||!state.snapshot)return null;
    return {editor_id:options.editorId,document_id:state.snapshot.id,title:state.snapshot.source.title||'가져온 화면',url:state.snapshot.source.url,
      revision:state.revision,element_count:state.scene.nodes.size,comment_count:Object.keys(state.scene.annotations).length};
  }
  function screen() {
    return {...metadata(),undo_count:state.undo.length,redo_count:state.redo.length,change_count:state.scene.changes().length,
      busy:!!state.scene.drag||!!options.isBusy?.(),last_action:state.lastAction||null,snapshot_count:state.timeline?.entries.length||0,active_snapshot_id:state.timeline?.activeId||null,snapshot_dirty:options.snapshotHistory?.dirty()||false};
  }
  function nodeInfo(node) {
    const scene=state.scene,deleted=scene.hidden(node.id),offset=scene.offset(node.id),current=(!deleted&&scene.rect(node.id))||{...node.rect,x:node.rect.x+offset.x,y:node.rect.y+offset.y};
    return {id:node.id,name:node.name,tag:node.tag,kind:node.kind,parent_id:node.parentId,locator:node.locator,
      captured_visible:node.visible,deleted,original_rect:node.rect,current_rect:current,offset:scene.edits[node.id]||{},comment:scene.annotations[node.id]||''};
  }
  async function execute(command) {
    const scene=state.scene,meta=metadata(),args=command.arguments||{};
    if(!meta)return failure('not_ready','화면을 가져온 뒤 다시 요청해 주세요.');
    if(command.document_id!==meta.document_id||args.editor_id!==options.editorId)return failure('wrong_document','대상 화면이 바뀌었습니다. 화면 목록을 다시 조회해 주세요.');
    if(Date.now()>command.deadline*1000)return failure('expired','명령이 만료되어 적용하지 않았습니다.');
    const name=command.name;
    if(name==='get_screen')return {ok:true,screen:screen()};
    if(name==='list_elements') {
      const query=(args.query||'').toLowerCase(),offset=args.offset||0,limit=args.limit||50;
      const matches=[...scene.nodes.values()].filter(node=>(!args.parent_id||node.parentId===args.parent_id)&&
        (!query||(node.id+' '+node.name+' '+node.tag+' '+JSON.stringify(node.locator)).toLowerCase().includes(query)));
      return {ok:true,revision:state.revision,total:matches.length,offset,elements:matches.slice(offset,offset+limit).map(nodeInfo)};
    }
    if(name==='list_comments') {
      const comments=scene.comments().map((comment,index)=>({...comment,number:index+1})).filter(c=>!args.element_id||c.id===args.element_id),offset=args.offset||0,limit=args.limit||50;
      return {ok:true,revision:state.revision,total:comments.length,offset,comments:comments.slice(offset,offset+limit)};
    }
    if(name==='list_snapshots') {
      const entries=options.snapshotHistory.list(),offset=args.offset||0,limit=args.limit||50;
      return {ok:true,revision:state.revision,total:entries.length,offset,active_snapshot_id:state.timeline.activeId,dirty:options.snapshotHistory.dirty(),snapshots:entries.slice(offset,offset+limit)};
    }
    if(!['apply_edits','undo','redo','create_snapshot','restore_snapshot'].includes(name))return failure('unknown_tool','지원하지 않는 편집 명령입니다.');
    if(args.expected_revision!==state.revision)return failure('revision_conflict','화면이 변경되었습니다. 최신 상태를 조회한 뒤 수정해 주세요.');
    if(scene.drag||options.isBusy?.())return failure('editor_busy','사용자가 편집 중입니다. 입력을 마친 후 최신 버전으로 다시 요청해 주세요.');
    let snapshotResult={};
    if(name==='create_snapshot'||name==='restore_snapshot') {
      try{snapshotResult=name==='create_snapshot'?{snapshot_id:options.snapshotHistory.create(args.name||'',{actor:'agent'}).id}:options.snapshotHistory.restore(args.snapshot_id,{actor:'agent'});}
      catch(error){return failure('snapshot_error',error.message);}
    } else if(name==='undo'||name==='redo') {
      if(!state[name].length)return failure('nothing_to_'+name,'실행 '+(name==='undo'?'취소':'복원')+'할 작업이 없습니다.');
      options.undo(name,{actor:'agent'});
    } else {
      const operations=args.operations;
      if(!Array.isArray(operations)||!operations.length||operations.length>100)return failure('invalid_operations','1~100개의 작업을 지정해 주세요.');
      const edits=copy(scene.edits),annotations=copy(scene.annotations);
      for(const operation of operations) {
        if(!operation||!scene.elements.has(operation.element_id))return failure('unknown_element','존재하지 않는 요소입니다: '+operation?.element_id);
        const id=operation.element_id;
        if(operation.type==='move') {
          if(!['relative','absolute'].includes(operation.mode)||!Number.isFinite(operation.dx)||!Number.isFinite(operation.dy))return failure('invalid_move','이동 모드와 유한한 이동량을 지정해 주세요.');
          const previous=edits[id]||{},dx=operation.dx+(operation.mode==='relative'?(previous.dx||0):0),dy=operation.dy+(operation.mode==='relative'?(previous.dy||0):0);
          if(Math.abs(dx)>60000||Math.abs(dy)>200000)return failure('invalid_move','이동량이 허용 범위를 넘습니다.');
          edits[id]={...previous,dx,dy};
        } else if(operation.type==='delete')edits[id]={...(edits[id]||{}),deleted:true};
        else if(operation.type==='comment') {
          if(typeof operation.text!=='string'||operation.text.length>4000)return failure('invalid_comment','주석은 4,000자 이하의 문자열이어야 합니다.');
          const text=operation.text.trim();if(text)annotations[id]=text;else delete annotations[id];
        } else return failure('invalid_operation','지원하지 않는 작업입니다.');
      }
      if(JSON.stringify(edits)===JSON.stringify(scene.edits)&&JSON.stringify(annotations)===JSON.stringify(scene.annotations))return {ok:true,unchanged:true,screen:screen()};
      const previous=options.checkpoint(),redo=state.redo;
      options.historyBefore();state.commentTarget=null;
      try {
        scene.setComments(annotations);scene.setEdits(edits);scene.select(operations[operations.length-1].element_id);
        options.changeCommitted({actor:'agent',label:operations.length+'개 변경 적용'});
      } catch(error) {
        state.undo.pop();state.redo=redo;scene.setComments(previous.annotations);scene.setEdits(previous.edits);scene.select(previous.selected);
        options.render?.();return failure('apply_failed',error.message);
      }
    }
    const result={ok:true,...snapshotResult,screen:screen()};
    if(options.flush)result.persisted=await options.flush();
    return result;
  }
  return {metadata,execute};
}
