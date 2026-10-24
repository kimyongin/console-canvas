const api=window.ConsoleCanvasShell,$=selector=>document.querySelector(selector);
let info;
function showState(value){if(value.url&&document.activeElement!==$('#address'))$('#address').value=value.url;$('#status').textContent=value.message||'';$('#capture').disabled=!!value.busy;for(const view of ['source','editor','agent'])$('#show-'+view).classList.toggle('active',value.view===view);$('#agent-setup').hidden=value.view!=='agent';$('#fallback').hidden=value.view==='agent';}
api.onState(showState);api.info().then(value=>{info=value;showState(value);});
$('#navigation').addEventListener('submit',async event=>{event.preventDefault();try{await api.navigate($('#address').value);}catch(error){$('#status').textContent=error.message;}});
$('#capture').addEventListener('click',async()=>{try{await api.capture();}catch(error){$('#status').textContent=error.message;$('#capture').disabled=false;}});
$('#show-source').addEventListener('click',()=>api.show('source'));$('#show-editor').addEventListener('click',()=>api.show('editor'));
$('#back').addEventListener('click',()=>api.back());$('#forward').addEventListener('click',()=>api.forward());$('#reload').addEventListener('click',()=>api.reload());
$('#demo').addEventListener('click',()=>api.navigate(info.demo_url));
function displaySkill(value){$('#skill-version').textContent='앱 번들 v'+value.version;$('#skill-path').textContent=value.path;$('#skill-install-status').textContent=value.current?'설치된 스킬이 앱과 같습니다.':value.installed?'스킬 업데이트가 있습니다.':'스킬을 설치할 수 있습니다.';$('#install-skill').textContent=value.current?'스킬 설치 확인':'Codex 스킬 설치·업데이트';$('#mcp-command').value=value.mcp_command;}
$('#show-agent').addEventListener('click',async()=>{await api.show('agent');try{displaySkill(await api.skillInfo());}catch(error){$('#agent-result').textContent=error.message;}});
$('#install-skill').addEventListener('click',async()=>{const button=$('#install-skill');button.disabled=true;try{const result=await api.installSkill();displaySkill(result);$('#agent-result').textContent='스킬을 설치했습니다. 다음 대화에서 $console-canvas로 사용할 수 있습니다.'+(result.backup?' 이전 파일 백업: '+result.backup:'');}catch(error){$('#agent-result').textContent=error.message;}finally{button.disabled=false;}});
$('#save-skill').addEventListener('click',async()=>{try{const result=await api.saveSkill();if(!result.canceled)$('#agent-result').textContent='스킬 ZIP을 저장했습니다: '+result.path;}catch(error){$('#agent-result').textContent=error.message;}});
$('#copy-mcp').addEventListener('click',async()=>{try{await api.copyMcpCommand();$('#agent-result').textContent='MCP 등록 명령을 복사했습니다. 터미널에서 한 번 실행하고 에이전트의 MCP 연결을 시작해 주세요.';}catch(error){$('#agent-result').textContent=error.message;}});
