import {copy} from '../engine.js';
import {reviewPayload} from '../export.js';
const frame=document.querySelector('#editor'),results=[];
function check(name,passed){results.push({name,passed:!!passed});document.querySelector('#results').textContent=results.map(r=>(r.passed?'PASS ':'FAIL ')+r.name).join('\n');if(!passed)throw new Error(name);}
async function ready(){const deadline=Date.now()+20000;while(!frame.contentWindow.ConsoleCanvas?.state.ready){if(Date.now()>deadline)throw new Error('Editor did not become ready');await new Promise(r=>setTimeout(r,50));}return frame.contentWindow.ConsoleCanvas;}
try {
  let app=await ready(),doc=frame.contentDocument;
  const node=[...app.state.scene.nodes.values()].find(n=>n.tag==='button'&&n.locator.id==='new-customer');
  const select=()=>app.selectNode(node.id);
  const comment=text=>{select();doc.querySelector('#component-comment').value=text;doc.querySelector('#save-comment').click();};
  const note=text=>{const field=doc.querySelector('#review-note');field.value=text;field.dispatchEvent(new Event('change'));};
  const save=name=>{doc.querySelector('#snapshot-name').value=name;doc.querySelector('#snapshot-form').dispatchEvent(new Event('submit',{cancelable:true}));return app.state.timeline.activeId;};
  doc.querySelector('#snapshots-button').click();
  check('Snapshot panel opens with an initial saved version',!doc.querySelector('#snapshot-panel').hidden&&doc.querySelectorAll('.snapshot-entry').length===1);
  select();app.state.scene.setPosition(30,40);comment('시안 A의 주석');note('시안 A의 설명');const a=save('시안 A');
  select();app.state.scene.setPosition(70,80);comment('시안 B의 주석');note('시안 B의 설명');const b=save('시안 B');
  check('Named snapshot save buttons add versions to the visible list',doc.querySelectorAll('.snapshot-entry').length===3&&doc.querySelector('#snapshot-list').textContent.includes('시안 B'));
  doc.querySelector('[data-snapshot-id="'+a+'"]').click();
  check('Clicking a saved version restores geometry, comments and notes',app.state.scene.edits[node.id].dx===30&&app.state.scene.annotations[node.id]==='시안 A의 주석'&&doc.querySelector('#review-note').value==='시안 A의 설명');
  doc.querySelector('#next-snapshot').click();
  check('Next-version control returns to the future without losing saved versions',app.state.timeline.activeId===b&&app.state.scene.edits[node.id].dx===70&&app.state.timeline.entries.length===3);
  doc.querySelector('#previous-snapshot').click();select();app.state.scene.setPosition(100,120);comment('이동 전 미저장 주석');
  doc.querySelector('[data-snapshot-id="'+b+'"]').click();const automatic=app.state.timeline.entries.find(e=>e.kind==='automatic');
  check('UI navigation preserves unsaved edits as a visible automatic snapshot',automatic&&doc.querySelector('#snapshot-list').textContent.includes('이동 전 자동 보관'));
  await app.state.saving;const documentId=app.state.snapshot.id;
  frame.src='../editor.html?id='+encodeURIComponent(documentId);await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));app=await ready();doc=frame.contentDocument;
  check('Reopening the IndexedDB document retains snapshots and the active version',app.state.timeline.entries.length===4&&app.state.timeline.activeId===b&&app.state.scene.edits[node.id].dx===70);
  app.snapshotHistory.restore(automatic.id);
  check('Automatic snapshot contents survive an app-page restart',app.state.scene.edits[node.id].dx===100&&app.state.scene.annotations[node.id]==='이동 전 미저장 주석');
  const portable=reviewPayload(app.state.snapshot,app.state.scene,doc.querySelector('#review-note').value,copy(app.state.timeline));
  await app.importFile(new File([JSON.stringify(portable)],'snapshots.uiclone.json',{type:'application/json'}));
  app.snapshotHistory.restore(a);
  check('Exported and reimported edit files retain navigable snapshot history',app.state.timeline.entries.length===4&&app.state.scene.annotations[node.id]==='시안 A의 주석');
  app.snapshotHistory.restore(b);app.undo();
  check('Undoing a snapshot jump returns to the previous version and note',app.state.timeline.activeId===a&&doc.querySelector('#review-note').value==='시안 A의 설명');
  app.undo('redo');
  check('Redoing a snapshot jump restores the future while preserving the list',app.state.timeline.activeId===b&&app.state.timeline.entries.length===4&&doc.querySelector('#review-note').value==='시안 B의 설명');
  check('Exports share the captured DOM once rather than copying it into every version',!portable.snapshot.timeline&&portable.timeline.entries.every(e=>!e.state.html&&!e.state.snapshot));
  await app.state.saving;
  const summary={passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,total:results.length};document.querySelector('#status').textContent=JSON.stringify(summary);document.body.dataset.result=summary.failed?'fail':'pass';
}catch(error){document.querySelector('#status').textContent='FAILED: '+error.message;document.body.dataset.result='fail';console.error(error);}
