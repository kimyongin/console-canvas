import {saveDocument} from './db.js';

chrome.action.onClicked.addListener(async tab=>{
  if(!tab.id)return;
  await chrome.action.setBadgeText({tabId:tab.id,text:'…'});
  await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:'#5152cd'});
  try {
    if(!/^https?:\/\//.test(tab.url||''))throw new Error('일반 HTTP·HTTPS 웹 화면에서 확장 버튼을 눌러 주세요. 브라우저 설정 화면에는 접근할 수 없습니다.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['capture.js']});
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>globalThis.UICloneCapture.capture(document)});
    const snapshot=results[0]?.result;
    if(!snapshot?.html)throw new Error('화면을 가져오지 못했습니다. 로딩이 끝난 뒤 다시 시도해 주세요.');
    try {
      const active=await chrome.tabs.query({active:true,windowId:tab.windowId});
      if(active[0]?.id===tab.id)snapshot.screenshot=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
      else snapshot.warnings.push({type:'screenshot',message:'가져오는 동안 탭이 바뀌어 원본 스크린샷을 생략했습니다.'});
    }catch(error){snapshot.warnings.push({type:'screenshot',message:'원본 스크린샷 없이 요소 구조를 가져왔습니다: '+error.message});}
    await saveDocument({...snapshot,edits:{},updatedAt:new Date().toISOString()});
    await chrome.tabs.create({url:chrome.runtime.getURL('editor.html')+'?id='+encodeURIComponent(snapshot.id)});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
  } catch(error) {
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.tabs.create({url:chrome.runtime.getURL('editor.html')+'?error='+encodeURIComponent(error.message)});
  }
});
