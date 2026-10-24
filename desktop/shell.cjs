const api=window.ConsoleCanvasShell,$=selector=>document.querySelector(selector);
let info;
function showState(value){if(value.url&&document.activeElement!==$('#address'))$('#address').value=value.url;$('#status').textContent=value.message||'';$('#capture').disabled=!!value.busy;$('#show-source').classList.toggle('active',value.view==='source');$('#show-editor').classList.toggle('active',value.view==='editor');}
api.onState(showState);api.info().then(value=>{info=value;showState(value);});
$('#navigation').addEventListener('submit',async event=>{event.preventDefault();try{await api.navigate($('#address').value);}catch(error){$('#status').textContent=error.message;}});
$('#capture').addEventListener('click',async()=>{try{await api.capture();}catch(error){$('#status').textContent=error.message;$('#capture').disabled=false;}});
$('#show-source').addEventListener('click',()=>api.show('source'));$('#show-editor').addEventListener('click',()=>api.show('editor'));
$('#back').addEventListener('click',()=>api.back());$('#forward').addEventListener('click',()=>api.forward());$('#reload').addEventListener('click',()=>api.reload());
$('#demo').addEventListener('click',()=>api.navigate(info.demo_url));
