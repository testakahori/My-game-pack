const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const { bridgeFetch } = require('../../BridgeMod/test/bridge-http.cjs');
const mineflayer=require('mineflayer'),{Rcon}=require('rcon-client');
const root=process.env.GIFT_QA_SERVER;
if(!root||JSON.parse(fs.readFileSync(path.join(root,'gift-qa-marker.json'))).purpose!=='disposable-gift-effects-test')throw Error('Disposable server required');
const props=fs.readFileSync(path.join(root,'server.properties'),'utf8');
for(const value of ['server-ip=127.0.0.1','server-port=25587','rcon.port=25588'])if(!props.includes(value))throw Error('QA ports required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const status=async()=> (await bridgeFetch('http://127.0.0.1:25578/bridge/status')).json();
async function wait(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Timed out');}
async function post(key,requestId,count=1){const r=await bridgeFetch('http://127.0.0.1:25578/bridge/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,requestId,type:'gift',count,listenerName:'テスト視聴者',announce:true})});assert.equal(r.status,202);await r.text();}
let bot,rcon;const result={checks:[]};const pass=m=>{result.checks.push(m);console.log('PASS '+m);};
(async()=>{
 rcon=await Rcon.connect({host:'127.0.0.1',port:25588,password:props.match(/^rcon.password=(.*)$/m)[1].trim(),timeout:15000});
 const cmd=text=>rcon.send(text);
 await wait(async()=>!(await status()).player.online);
 await post('get_tree','retry-1');await post('get_tree','retry-1');await post('get_tree','gift-2',2);
 await wait(async()=>{const g=(await status()).games.saikutumod;return g.gift===2&&g.duplicates===1;});
 assert.equal((await status()).games.saikutumod.started,0);
 pass('同じ要求番号の再送はゲームMODの待ち列へ1件だけ登録、別番号は別件');
 bot=mineflayer.createBot({host:'127.0.0.1',port:25587,username:'MiningTester',auth:'offline',version:'1.20.1',viewDistance:'tiny'});
 let titles=0;bot._client.on('set_title_text',()=>titles++);
 await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('kicked',reject);});
 await cmd('gamemode creative MiningTester');
 await wait(async()=> (await status()).games.saikutumod.completed===2);
 assert.match(await cmd('clear MiningTester minecraft:oak_wood 0'),/30/);
 assert.equal(titles,2);
 await post('get_tree','retry-1');await sleep(350);
 assert.equal((await status()).games.saikutumod.completed,2);
 await post('get_tree','gift-3');await wait(async()=> (await status()).games.saikutumod.completed===3);
 assert.match(await cmd('clear MiningTester minecraft:oak_wood 0'),/40/);
 pass('実開始時だけ表示し、完了後の再送も二重実行しない。同名の別ギフトは実行');
 const file=path.join(root,'bridge/commands/minecraft/qa_received.txt');
 fs.writeFileSync(file,'scoreboard players add #common qa_received 1');
 await cmd('scoreboard objectives add qa_received dummy');
 await post('qa_received','common-repeat');await post('qa_received','common-repeat');
 await wait(async()=>/has 2 /.test(await cmd('scoreboard players get #common qa_received')));
 pass('共通の即時イベントは同じ番号の要求でも届いた2件を実行');
 for(const [key,item,amount] of [['get_ender_pearl','ender_pearl',2],['get_iron_pickaxe','iron_pickaxe',1],['get_water_backet','water_bucket',1]]){
   await cmd('bridge '+key+' 1');await wait(async()=>new RegExp('(?:Found|found) '+amount+' ').test(await cmd('clear MiningTester minecraft:'+item+' 0')));
 }
 await cmd('bridge pikkerubossyuu 1');await wait(async()=>/No items/.test(await cmd('clear MiningTester minecraft:iron_pickaxe 0')));
 pass('/bridgeから採掘アイテム付与と没収を実行');
 bot.physicsEnabled=false;await cmd('tp MiningTester 500.5 64 0.5');await sleep(2000);
 await cmd('fill 497 55 -3 503 63 3 stone');await cmd('bridge otosiana 1');
 await wait(async()=>/passed/.test(await cmd('execute if block 500 61 0 air')));
 await cmd('fill 478 40 -22 522 63 22 stone');await cmd('bridge fissure 1');
 await wait(async()=>/passed/.test(await cmd('execute if block 500 52 0 air')));
 await cmd('bridge maguma_jigoku 1');await wait(async()=>/passed/.test(await cmd('execute if block 500 66 0 lava')));
 // Limit the TNT test to its four-entity branch; the full pile is deliberately destructive.
 await cmd('setblock 500 94 0 stone');await cmd('bridge tntdaibakuhatu 1');
 await wait(async()=>/TNT/.test(await cmd('execute as @e[type=minecraft:tnt] run data get entity @s Fuse')));
 await cmd('kill @e[type=minecraft:tnt]');
 await cmd('bridge skytrap 1');await wait(async()=> (await status()).player.y>100);
 await cmd('bridge randomtp 1');await wait(async()=> Math.hypot((await status()).player.x-500.5,(await status()).player.z-.5)>20);
 pass('/bridgeから落とし穴・大地割れ・マグマ地獄・TNT・天空トラップ・ランダム移動を実行');
 const s=await status();assert.equal(s.failed,0,s.lastError);assert.equal(s.games.saikutumod.failed,0);assert.equal(s.games.saikutumod.effectsFailed,0);
 result.status=s;result.ok=true;
})().catch(e=>{result.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{bot?.quit();rcon?.end();fs.writeFileSync(path.join(root,'mining-routing-results.json'),JSON.stringify(result,null,2));});
