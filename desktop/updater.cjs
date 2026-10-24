const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');

// Only the trusted shell can call this controller. All URLs and paths are fixed here.
function createUpdater({app,root,python,version,skillSync,notify,flush}){
  const cache=path.join(app.getPath('userData'),'updates'),helper=path.join(root,'mcp/app_update.py');
  let value={phase:'idle',current_version:version,message:'GitHub에서 새 버전을 확인하세요.',skill_update:skillSync},running=false,plan;
  const send=patch=>{value={...value,...patch};notify(value);return value;};
  async function run(action){
    if(running)throw new Error('업데이트 작업이 진행 중입니다.');
    running=true;send({phase:action==='check'?'checking':'downloading',message:action==='check'?'새 버전 확인 중…':'업데이트 준비 중…',percent:0});
    try{
      const args=[helper,action,'--current',version,'--arch',process.arch];
      if(action==='prepare')args.push('--cache',cache,'--target',path.resolve(root,'../../..'));
      const result=await new Promise((resolve,reject)=>{
        const child=spawn(python,args,{stdio:['ignore','pipe','pipe']});let buffer='',result,error='',stderr='';
        child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const item=JSON.parse(line);if(item.type==='progress')send(item);if(item.type==='result')result=item;if(item.type==='error')error=item.message;}catch{error='업데이트 응답을 읽지 못했습니다.';}}});
        child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
        child.on('error',reject);child.on('close',code=>code===0&&result?resolve(result):reject(new Error(error||stderr||'업데이트 작업을 완료하지 못했습니다.')));
      });
      if(action==='prepare'){plan=result.plan;return send({phase:'ready',message:'업데이트 준비가 끝났습니다. 편집 내용을 저장한 뒤 다시 시작합니다.',latest_version:result.version,percent:100});}
      return send({phase:result.available?'available':'current',latest_version:result.release?.version||null,message:result.available?'새 버전 v'+result.release.version+'을 사용할 수 있습니다.':'최신 버전을 사용하고 있습니다.'});
    }catch(error){send({phase:'error',message:error.message});throw error;}finally{running=false;}
  }
  async function install(){
    if(running||value.phase!=='ready'||!plan)throw new Error('먼저 업데이트를 다운로드해 주세요.');
    running=true;send({phase:'installing',message:'편집 내용을 저장하고 다시 시작합니다…'});
    try{
      const document=await flush();
      fs.writeFileSync(path.join(cache,'reopen.json'),JSON.stringify(document),{mode:0o600});
      const standalone=path.join(cache,'apply-update.py');fs.copyFileSync(helper,standalone);
      const log=fs.openSync(path.join(cache,'apply.log'),'a',0o600);
      try{
        const child=spawn(python,[standalone,'apply','--plan',plan,'--parent-pid',String(process.pid)],{detached:true,stdio:['ignore',log,log]});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
      }finally{fs.closeSync(log);}
      app.quit();return {restarting:true};
    }catch(error){running=false;send({phase:'ready',message:error.message});throw error;}
  }
  return {info:()=>value,check:()=>run('check'),download:()=>run('prepare'),install};
}
module.exports={createUpdater};
