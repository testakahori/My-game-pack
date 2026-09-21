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
test('本番ハンドラー: protobuf→100いいね→タラ、贈り主名、接続中の設定2回保存をHTTPまで確認', async t=>{
  // Windows CI's TEMP may contain an 8.3 alias (RUNNER~1). fs.watch's native
  // rename notifications use the long path; watch the same canonical spelling.
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'bridge-live-events-')));
  const requests=[], logs=[], timers=new Set(), watchers=[];
  const server=http.createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      requests.push(JSON.parse(body));res.writeHead(202,{'Content-Type':'application/json'});res.end('{"ok":true}');
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
  for(const file of ['cod','zombie','skeleton'])fs.writeFileSync(path.join(dir,'commands',file+'.txt'),'# TITLE: '+file+'\nsay test\n');
  fs.writeFileSync(path.join(dir,'tts-settings.json'),JSON.stringify({enabled:false}));
  const config={tiktokUsername:'fixture',mappings:[{giftId:'5655',name:'バラ',commandFile:'zombie.txt',repeat:1}],
    likeEvents:[{enabled:true,threshold:100,commandFile:'cod.txt',repeat:1}],
    options:{commandsDir:'commands',commandTransport:'douma_mod',doumaModHost:'127.0.0.1',doumaModPort:server.address().port,likeBatchWindowMs:100}};
  const configPath=path.join(dir,'config.json');fs.writeFileSync(configPath,JSON.stringify(config));
  let connection,connections=0;
  class FixtureConnection extends TikTokLiveConnection {
    constructor(...args){super(...args);connection=this;}
    async connect(){connections++;return {roomId:'fixture-room'};}
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
  let msg=100;
  const emit=async(type,fields)=>{
    const message={...proto[type].decode(new Uint8Array()),...fields,
      common:{...proto.CommonMessageData.decode(new Uint8Array()),msgId:String(++msg),createTime:String(Math.floor(Date.now()/1000))},
      user:{...proto.User.decode(new Uint8Array()),id:'123',displayId:'akahoridouma',nickname:'赤堀堂馬'}};
    if(fields.gift)message.gift={...proto.Gift.decode(new Uint8Array()),...fields.gift};
    const data=proto[type].decode(proto[type].encode(message).finish());
    await connection.processDecodedData({type,data});
  };
  await emit('WebcastLikeMessage',{count:100,total:'100'});
  await until(()=>requests.length===1,'first 100 likes');
  assert.deepEqual(requests.map(x=>[x.type,x.key,x.count,x.listenerName]),[['like','cod',1,'赤堀堂馬']]);
  await emit('WebcastLikeMessage',{count:100,total:'200'});
  await until(()=>requests.length===2,'next 100 likes');
  await emit('WebcastGiftMessage',{giftId:'5655',gift:{name:'バラ',diamondCount:1},repeatCount:1});
  await until(()=>requests.length===3,'rose');
  assert.equal(requests[2].key,'zombie');assert.equal(requests[2].listenerName,'赤堀堂馬');
  await emit('WebcastGiftMessage',{giftId:'5655',gift:{name:'バラ',diamondCount:1},repeatCount:1,repeatEnd:1});
  await wait(180);assert.equal(requests.length,3,'連打終了通知で余分に召喚しない');
  const save=async()=>{
    const before=logs.filter(x=>x.includes('Config reloaded')).length;
    fs.writeFileSync(configPath+'.tmp',JSON.stringify(config));fs.renameSync(configPath+'.tmp',configPath);
    await until(()=>logs.filter(x=>x.includes('Config reloaded')).length>before,'hot reload');
  };
  config.likeEvents[0].threshold=50;config.likeEvents[0].repeat=2;
  config.mappings[0].commandFile='skeleton.txt';await save();
  await emit('WebcastLikeMessage',{count:50,total:'250'});
  await emit('WebcastGiftMessage',{giftId:'5655',gift:{name:'バラ',diamondCount:1},repeatCount:1,repeatEnd:1});
  await until(()=>requests.length===5,'updated rules');
  assert.ok(requests.slice(3).some(x=>x.type==='like'&&x.key==='cod'&&x.count===2));
  assert.ok(requests.slice(3).some(x=>x.type==='gift'&&x.key==='skeleton'));
  config.likeEvents[0].enabled=false;config.mappings[0].repeat=3;await save();
  await emit('WebcastLikeMessage',{count:50,total:'300'});
  await emit('WebcastGiftMessage',{giftId:'5655',gift:{name:'バラ'},repeatCount:1,repeatEnd:1});
  await until(()=>requests.length===6,'second atomic save');await wait(180);
  assert.equal(requests.length,6);assert.equal(requests[5].count,3);assert.equal(connections,1);
  assert.ok(logs.some(x=>x.includes('name="バラ" from=赤堀堂馬')));
});
