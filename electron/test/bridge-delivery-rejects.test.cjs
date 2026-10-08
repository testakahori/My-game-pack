const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createRequire}=require('node:module');
const source=path.resolve(__dirname,'../../bridge/index.js');
const bridgeRequire=createRequire(source);
const {TikTokLiveConnection}=bridgeRequire('tiktok-live-connector');
const proto=bridgeRequire('tiktok-live-connector');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label) {
  for(let i=0;i<150;i++) { if(check()) return; await wait(20); }
  assert.fail('Timed out: '+label);
}

test('偽MODが400を返しても、後続のギフトは届き、送れなかった件数と理由が残る', async t=>{
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'bridge-delivery-rejects-')));
  const requests=[], logs=[], timers=new Set(), watchers=[];
  // A real MOD answers 400 when it cannot accept the request; it must not be resent forever.
  const server=http.createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      const event=JSON.parse(body);requests.push(event);
      const status=event.key==='broken'?400:202;
      res.writeHead(status,{'Content-Type':'application/json'});res.end(status===202?'{"ok":true}':'{"ok":false,"error":"bad_request"}');
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    for(const timer of timers) {clearInterval(timer);clearTimeout(timer);}
    for(const watcher of watchers)watcher.close();
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  fs.mkdirSync(path.join(dir,'commands'));
  for(const file of ['broken','zombie','ネコ'])fs.writeFileSync(path.join(dir,'commands',file+'.txt'),'# TITLE: '+file+'\nsay test\n');
  fs.writeFileSync(path.join(dir,'tts-settings.json'),JSON.stringify({enabled:false}));
  const config={tiktokUsername:'fixture',mappings:[
    {giftId:'1',name:'壊れた',commandFile:'broken.txt',repeat:1},
    {giftId:'2',name:'猫',commandFile:'ネコ.txt',repeat:1},
    {giftId:'3',name:'バラ',commandFile:'zombie.txt',repeat:1}],
    options:{commandsDir:'commands',commandTransport:'bridge_mod',bridgeModHost:'127.0.0.1',bridgeModPort:server.address().port}};
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(config));
  let connection;
  class FixtureConnection extends TikTokLiveConnection {
    constructor(...args){super(...args);connection=this;}
    async connect(){return {roomId:'fixture-room'};}
    async disconnect(){}
  }
  const fakeProcess=Object.assign(new EventEmitter(),{argv:['node',source],env:{},platform:process.platform,cwd:()=>dir,exit:code=>{throw Error('unexpected exit '+code);}});
  const testFs={...fs,watch:(...args)=>{const w=fs.watch(...args);watchers.push(w);return w;}};
  const context={module:{exports:{}},exports:{},__dirname:dir,__filename:source,process:fakeProcess,Buffer,URL,
    console:Object.fromEntries(['log','warn','error'].map(name=>[name,(...args)=>logs.push(args.join(' '))])),
    setTimeout:(fn,ms,...args)=>{const timer=setTimeout(fn,ms,...args);timers.add(timer);return timer;},clearTimeout,
    setInterval:(fn,ms,...args)=>{const timer=setInterval(fn,ms,...args);timers.add(timer);return timer;},clearInterval,
    require:id=>id==='tiktok-live-connector'?{TikTokLiveConnection:FixtureConnection}:id==='fs'?testFs:bridgeRequire(id)};
  vm.runInNewContext(fs.readFileSync(source,'utf8')+'\nmodule.exports.startFixture=main;',context,{filename:source});
  await context.module.exports.startFixture();
  await until(()=>logs.some(x=>x.includes('[TikTok] Connected.')),'connected');
  assert.ok(logs.some(x=>x.includes('[Config]')&&x.includes('ネコ.txt')),'起動時に名前の問題を警告する');
  let msg=100;
  const gift=async giftId=>{
    const message={...proto.WebcastGiftMessage.decode(new Uint8Array()),giftId,repeatCount:1,repeatEnd:1,
      common:{...proto.CommonMessageData.decode(new Uint8Array()),msgId:String(++msg),createTime:String(Math.floor(Date.now()/1000))},
      user:{...proto.User.decode(new Uint8Array()),id:'123',displayId:'viewer',nickname:'視聴者'},
      gift:{...proto.Gift.decode(new Uint8Array()),type:1,name:'gift'+giftId}};
    const data=proto.WebcastGiftMessage.decode(proto.WebcastGiftMessage.encode(message).finish());
    await connection.processDecodedData({type:'WebcastGiftMessage',data});
  };
  await gift('1');await gift('2');await gift('3');
  await until(()=>requests.some(x=>x.key==='zombie'),'gift after a rejected gift');
  await wait(300);
  assert.deepEqual(requests.map(x=>x.key),['broken','zombie'],'400は1回だけ、日本語名は送らない');
  const status=JSON.parse(fs.readFileSync(path.join(dir,'runtime-status.json'),'utf8'));
  // The Japanese name is refused before sending; the MOD's 400 for broken.txt arrives afterwards.
  assert.equal(status.delivery.rejected,2);
  assert.equal(status.delivery.last.commandFile,'broken.txt');
  assert.match(status.delivery.last.reason,/HTTP 400/);
  const history=fs.readFileSync(path.join(dir,'operations-history.json'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(history.map(row=>[row.commandFile,row.ok]).sort(),[['broken.txt',false],['zombie.txt',true],['ネコ.txt',false]].sort());
  assert.match(history.find(row=>row.commandFile==='ネコ.txt').message,/半角英数字/);
  // A broken save during the stream must not replace the working rules.
  const configPath=path.join(dir,'config.json');
  fs.writeFileSync(configPath+'.tmp',JSON.stringify({...config,mappings:{}}));fs.renameSync(configPath+'.tmp',configPath);
  await until(()=>logs.some(x=>x.includes('Config reload skipped')),'invalid reload is rejected');
  await gift('3');
  await until(()=>requests.filter(x=>x.key==='zombie').length===2,'previous mappings stay active');
});
