const frame=document.querySelector('#editor'),results=[],storageKey='console-canvas-panels-v1',original=localStorage.getItem(storageKey);
function check(name,passed){results.push({name,passed:!!passed});document.querySelector('#results').textContent=results.map(r=>(r.passed?'PASS ':'FAIL ')+r.name).join('\n');if(!passed)throw new Error(name);}
async function open(url){const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));frame.src=url;await loaded;const deadline=Date.now()+20000;while(!frame.contentWindow.ConsoleCanvas?.state.ready){if(Date.now()>deadline)throw new Error('Editor did not become ready');await new Promise(r=>setTimeout(r,50));}return frame.contentWindow.ConsoleCanvas;}
try{
  localStorage.removeItem(storageKey);
  let app=await open('../editor.html?sample=1'),doc=frame.contentDocument;
  let click=id=>doc.querySelector('#'+id).click(),width=()=>doc.querySelector('#viewport').getBoundingClientRect().width;
  const initialWidth=width(),leftWidth=doc.querySelector('#layers-panel').getBoundingClientRect().width,rightWidth=doc.querySelector('#properties-panel').getBoundingClientRect().width,zoom=app.state.zoom;
  check('Both panels start expanded with accessible toggle buttons',!doc.querySelector('#layers-panel').hidden&&!doc.querySelector('#properties-panel').hidden&&doc.querySelector('#toggle-layers').getAttribute('aria-expanded')==='true');
  click('toggle-layers');
  check('Collapsing layers gives its full width to the canvas',doc.querySelector('#layers-panel').hidden&&Math.abs(width()-initialWidth-leftWidth)<1);
  click('toggle-properties');
  check('Both panels can collapse while their reopen buttons stay visible',Math.abs(width()-initialWidth-leftWidth-rightWidth)<1&&['toggle-layers','toggle-properties'].every(id=>doc.querySelector('#'+id).getBoundingClientRect().width>0));
  check('Panel changes preserve the current canvas zoom',app.state.zoom===zoom);
  click('toggle-layers');click('toggle-properties');
  const node=[...app.state.scene.nodes.values()].find(n=>n.tag==='button'&&n.locator.id==='new-customer');app.selectNode(node.id);doc.querySelector('#component-comment').value='접어도 보존할 수정 방향';click('toggle-properties');
  check('Collapsing properties commits the comment draft without losing selection',app.state.scene.annotations[node.id]==='접어도 보존할 수정 방향'&&app.state.scene.selected===node.id);
  click('snapshots-button');
  check('Snapshots reopen a collapsed properties panel',!doc.querySelector('#properties-panel').hidden&&!doc.querySelector('#snapshot-panel').hidden);
  click('toggle-properties');click('snapshots-button');
  check('Snapshots reopen even when the hidden panel already contains the snapshot list',!doc.querySelector('#properties-panel').hidden&&!doc.querySelector('#snapshot-panel').hidden);
  click('toggle-properties');click('toggle-layers');await app.state.saving;const documentId=app.state.snapshot.id;
  app=await open('../editor.html?id='+encodeURIComponent(documentId));doc=frame.contentDocument;
  check('Both collapsed preferences survive reopening the app page',doc.querySelector('#layers-panel').hidden&&doc.querySelector('#properties-panel').hidden);
  click('toggle-layers');click('toggle-properties');app.selectNode(node.id);
  check('Reopened panels retain the saved document, comment and snapshot list',app.state.snapshot.id===documentId&&doc.querySelector('#component-comment').value==='접어도 보존할 수정 방향'&&app.state.timeline.entries.length===1);
  click('snapshots-button');click('toggle-properties');
  // Selecting a comment from the change list explicitly opens its input, unlike ordinary selection.
  doc.querySelector('#changes button').click();
  check('Opening a comment reveals its inspector instead of the hidden snapshot list',!doc.querySelector('#properties-panel').hidden&&doc.querySelector('#snapshot-panel').hidden&&doc.activeElement.id==='component-comment');
  await app.state.saving;
  document.querySelector('#status').textContent=JSON.stringify({passed:results.length,failed:0,total:results.length});document.body.dataset.result='pass';
}catch(error){document.querySelector('#status').textContent='FAILED: '+error.message;document.body.dataset.result='fail';console.error(error);}
finally{if(original===null)localStorage.removeItem(storageKey);else localStorage.setItem(storageKey,original);}
