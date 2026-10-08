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

test('BridgeはMODの認証トークンを付けて送り、サーバー再起動でトークンが変わっても読み直して届ける', async t=>{
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'bridge-mod-token-')));
  const tokenFile=path.join(dir,'server','config','bridgemod-token.txt');
  fs.mkdirSync(path.dirname(tokenFile),{recursive:true});fs.writeFileSync(tokenFile,'token-a\n');
  let modToken='token-a';
  const accepted=[], denied=[], logs=[], timers=new Set(), watchers=[], sockets=[];
  // BridgeAuth と同じく、トークンが違えば 403 を返す偽MOD。
  const server=http.createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      const event=JSON.parse(body);
      if(req.headers['x-bridge-token']!==modToken){denied.push(event.key);res.writeHead(403);res.end('{"ok":false,"error":"forbidden"}');return;}
      accepted.push(event.key);res.writeHead(202,{'Content-Type':'application/json'});res.end('{"ok":true}');
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
  fs.writeFileSync(path.join(dir,'commands','zombie.txt'),'# TITLE: zombie\nsay test\n');
  fs.writeFileSync(path.join(dir,'tts-settings.json'),JSON.stringify({enabled:false}));
  const port=server.address().port;
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({tiktokUsername:'fixture',
    mappings:[{giftId:'1',name:'バラ',commandFile:'zombie.txt',repeat:1}],
    options:{commandsDir:'commands',commandTransport:'bridge_mod',bridgeModHost:'127.0.0.1',bridgeModPort:port}}));
  let connection;
  class FixtureConnection extends TikTokLiveConnection {
    constructor(...args){super(...args);connection=this;}
    async connect(){return {roomId:'fixture-room'};}
    async disconnect(){}
  }
  // WebSocket は接続先 URL だけを記録する（状態通知の受信はこのテストの対象外）。
  class FixtureWebSocket { constructor(url){sockets.push(url);} addEventListener(){} close(){} }
  const fakeProcess=Object.assign(new EventEmitter(),{argv:['node',source],env:{BRIDGE_MOD_TOKEN_FILE:tokenFile},platform:process.platform,cwd:()=>dir,exit:code=>{throw Error('unexpected exit '+code);}});
  const testFs={...fs,watch:(...args)=>{const w=fs.watch(...args);watchers.push(w);return w;}};
  const context={module:{exports:{}},exports:{},__dirname:dir,__filename:source,process:fakeProcess,Buffer,URL,WebSocket:FixtureWebSocket,
    console:Object.fromEntries(['log','warn','error'].map(name=>[name,(...args)=>logs.push(args.join(' '))])),
    setTimeout:(fn,ms,...args)=>{const timer=setTimeout(fn,ms,...args);timers.add(timer);return timer;},clearTimeout,
    setInterval:(fn,ms,...args)=>{const timer=setInterval(fn,ms,...args);timers.add(timer);return timer;},clearInterval,
    require:id=>id==='tiktok-live-connector'?{TikTokLiveConnection:FixtureConnection}:id==='fs'?testFs:bridgeRequire(id)};
  vm.runInNewContext(fs.readFileSync(source,'utf8')+'\nmodule.exports.startFixture=main;',context,{filename:source});
  await context.module.exports.startFixture();
  await until(()=>logs.some(x=>x.includes('[TikTok] Connected.')),'connected');
  assert.equal(sockets[0],`ws://127.0.0.1:${port+1}/?token=token-a`);
  assert.ok(!logs.some(x=>x.includes('token-a')),'トークンをログに出さない');
  let msg=100;
  const gift=async()=>{
    const message={...proto.WebcastGiftMessage.decode(new Uint8Array()),giftId:'1',repeatCount:1,repeatEnd:1,
      common:{...proto.CommonMessageData.decode(new Uint8Array()),msgId:String(++msg),createTime:String(Math.floor(Date.now()/1000))},
      user:{...proto.User.decode(new Uint8Array()),id:'123',displayId:'viewer',nickname:'視聴者'},
      gift:{...proto.Gift.decode(new Uint8Array()),type:1,name:'バラ'}};
    await connection.processDecodedData({type:'WebcastGiftMessage',data:proto.WebcastGiftMessage.decode(proto.WebcastGiftMessage.encode(message).finish())});
  };
  await gift();
  await until(()=>accepted.length===1,'gift with the current token');
  // サーバーを再起動した直後：MOD は新しいトークン、ファイルはまだ古い。403 は捨てずに再送する。
  modToken='token-b';
  await gift();
  await until(()=>denied.length>=1,'old token is refused');
  // 再送待ちの間は、画面用の状態に「認証に失敗」とトークンファイルの場所を出す（オフラインと区別する）。
  const runtime=()=>JSON.parse(fs.readFileSync(path.join(dir,'runtime-status.json'),'utf8'));
  await until(()=>runtime().delivery?.authFailed?.tokenFile===tokenFile,'auth failure is shown');
  fs.writeFileSync(tokenFile,'token-b\n');
  await until(()=>accepted.length===2,'retried with the new token');
  await until(()=>runtime().delivery?.authFailed===null,'auth failure is cleared after delivery');
  assert.ok(logs.some(x=>x.includes('BridgeMODの認証に失敗しました')&&x.includes(tokenFile)),'403 の理由とトークンファイルの場所を出す');
  assert.ok(!logs.some(x=>x.includes('送れなかったイベント')),'403 は捨てない');
});
