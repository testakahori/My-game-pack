const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createRequire}=require('node:module');
const {parseWeightedList,chooseWeighted}=require('../../bridge/weighted_choice.cjs');
const source=path.resolve(__dirname,'../../bridge/index.js');
const bridgeRequire=createRequire(source);
const {TikTokLiveConnection}=bridgeRequire('tiktok-live-connector');
const proto=bridgeRequire('tiktok-live-connector');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label) {
  for(let i=0;i<150;i++) { if(check()) return; await wait(20); }
  assert.fail('Timed out: '+label);
}

test('RANDOMの重みが数値でなくても抽選は壊れない', () => {
  const choices=parseWeightedList('zombie.txt=abc, cod.txt=-5, heal.txt');
  assert.deepEqual(choices.map(c=>c.weight),[1,1,1]);
  assert.ok(choices.includes(chooseWeighted(choices,()=>0.99)));
  assert.equal(chooseWeighted([]),null);
});

test('1件のイベントで例外が出てもBridgeは落ちず、次のイベントを処理する', async t=>{
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'bridge-crash-guards-')));
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
  for(const file of ['zombie','cod'])fs.writeFileSync(path.join(dir,'commands',file+'.txt'),'# TITLE: '+file+'\nsay test\n');
  fs.writeFileSync(path.join(dir,'commands','random.txt'),'# TITLE: random\n# RANDOM: zombie.txt=abc, cod.txt=-5\nsay random\n');
  fs.writeFileSync(path.join(dir,'commands','upper.txt'),'# TITLE: upper\n# GAME_MOD: Umetate\nsay upper\n');
  fs.writeFileSync(path.join(dir,'tts-settings.json'),JSON.stringify({enabled:false}));
  const config={tiktokUsername:'fixture',
    mappings:[{giftId:'1',name:'ランダム',commandFile:'random.txt',repeat:1},{giftId:'2',name:'バラ',commandFile:'zombie.txt',repeat:1}],
    likeEvents:[{enabled:true,threshold:10,commandFile:'upper.txt'},{enabled:true,threshold:10,commandFile:'cod.txt'}],
    options:{commandsDir:'commands',commandTransport:'bridge_mod',bridgeModHost:'127.0.0.1',bridgeModPort:server.address().port,likeBatchWindowMs:100}};
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
  let msg=100;
  const emit=async(type,fields)=>{
    const message={...proto[type].decode(new Uint8Array()),...fields,
      common:{...proto.CommonMessageData.decode(new Uint8Array()),msgId:String(++msg),createTime:String(Math.floor(Date.now()/1000))},
      user:{...proto.User.decode(new Uint8Array()),id:'123',displayId:'viewer',nickname:'視聴者'}};
    if(fields.gift)message.gift={...proto.Gift.decode(new Uint8Array()),type:1,...fields.gift};
    await connection.processDecodedData({type,data:proto[type].decode(proto[type].encode(message).finish())});
  };

  // RANDOM の重みが壊れていても、どれかが選ばれて届く。
  await emit('WebcastGiftMessage',{giftId:'1',gift:{name:'ランダム'},repeatCount:1,repeatEnd:1});
  await until(()=>requests.length===1,'randomized gift');
  assert.ok(['zombie','cod'].includes(requests[0].key));

  // GAME_MOD の大文字は無効な ID。そのルールだけ記録して飛ばし、同じ閾値の別ルールは届く。
  await emit('WebcastLikeMessage',{count:10,total:'10'});
  await until(()=>requests.some(x=>x.type==='like'&&x.key==='cod'),'other like rule still fires');
  assert.ok(!requests.some(x=>x.key==='upper'));
  assert.ok(logs.some(x=>x.includes('送れなかったイベント')&&x.includes('upper.txt')));

  // ハンドラー内で例外が出るイベント（壊れたデータ）を受けても、次のギフトは処理される。
  connection.emit('gift',{get giftId(){throw new Error('broken event');}});
  await until(()=>logs.some(x=>x.includes('gift イベントの処理でエラー')&&x.includes('broken event')),'handler error is logged');
  await emit('WebcastGiftMessage',{giftId:'2',gift:{name:'バラ'},repeatCount:1,repeatEnd:1});
  await until(()=>requests.some(x=>x.key==='zombie'&&x.type==='gift'&&x!==requests[0]),'next gift after an exception');

  // 設定フォルダー監視のエラーと、取りこぼした Promise の失敗でもプロセスは終了しない。
  watchers[0].emit('error',new Error('EPERM watch'));
  assert.ok(logs.some(x=>x.includes('設定ファイルの監視でエラー')&&x.includes('EPERM watch')));
  assert.equal(fakeProcess.listenerCount('unhandledRejection'),1);
  fakeProcess.emit('unhandledRejection',new Error('stray rejection'));
  assert.ok(logs.some(x=>x.includes('処理されなかったエラー')&&x.includes('stray rejection')));
});
