const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { Rcon } = require('rcon-client'), { Vec3 } = require('vec3');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const properties = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
if (properties['server-ip'] !== '127.0.0.1' || properties['server-port'] !== '25587' || properties['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bot, rcon, spawns = [], meteorStates = [], particles = 0, explosions = 0;
const result = { tests: [] };
async function status() { return (await fetch('http://127.0.0.1:25578/douma/status')).json(); }
async function wait(fn, ms=45000) { const end=Date.now()+ms; while(Date.now()<end) { if(await fn()) return; await sleep(100); } throw Error('Timed out'); }
const cmd = s => rcon.send(s);
const block = (x,y,z=0) => bot.blockAt(new Vec3(x,y,z))?.name;
async function gift(key,count=1) { const r = await fetch('http://127.0.0.1:25578/douma/event',{ method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'gift',key,count,announce:false}) }); assert.equal(r.status,202); }
async function idle() { await wait(async()=>{ const s=await status(); return !s.gift&&!s.other&&!s.effectsPending; }); }
async function prepare(cx,deep=false) {
  await idle(); bot.physicsEnabled=false; await cmd('gamemode creative GiftTester'); await cmd('kill @e[type=!minecraft:player]'); await cmd('effect clear GiftTester'); await cmd('tp GiftTester '+(cx+.5)+' 64 0.5'); await sleep(2500);
  await cmd('fill '+(cx-15)+' 64 -15 '+(cx+15)+' 96 15 air');
  await cmd('fill '+(cx-15)+' 97 -15 '+(cx+15)+' 129 15 air');
  await cmd('fill '+(cx-15)+' 63 -15 '+(cx+15)+' 63 15 stone');
  if(deep) for(const [lo,hi] of [[8,35],[36,62]]) await cmd('fill '+(cx-15)+' '+lo+' -15 '+(cx+15)+' '+hi+' 15 stone');
  await wait(()=>block(cx,63)==='stone'); await cmd('tp GiftTester '+(cx+.5)+' 64 0.5'); await sleep(300);bot.physicsEnabled=true; await wait(async()=>Math.abs(bot.entity.position.y-64)<0.1&&Math.abs((await status()).player.y-64)<0.1); await cmd('attribute GiftTester minecraft:generic.max_health base set 1024'); await cmd('effect give GiftTester instant_health 1 10 true'); await cmd('gamemode survival GiftTester'); await sleep(1000); spawns=[]; meteorStates=[]; particles=0; explosions=0;
}
async function test(name,fn) { if(process.argv.includes('--cataclysm-only')&&!name.startsWith('cataclysm'))return; if(process.argv.includes('--new-effects-only')&&!/meteor shower|flood carries|cataclysm/.test(name))return; console.log('TEST',name); const info=await fn(); result.tests.push({name,passed:true,info}); console.log('PASS',name,JSON.stringify(info)); }
(async()=>{
  await wait(async()=>{ try{return(await status()).ok;}catch{return false;} },120000);
  rcon=await Rcon.connect({host:'127.0.0.1',port:25588,password:properties['rcon.password'],timeout:10000});
  bot=mineflayer.createBot({host:'127.0.0.1',port:25587,username:'GiftTester',auth:'offline',version:'1.20.1',viewDistance:'far'});
  bot._client.on('spawn_entity',p=>{if(p.objectData>0)meteorStates.push({type:p.type,state:p.objectData});});
  bot._client.on('world_particles',()=>particles++);bot._client.on('explosion',()=>explosions++);
  bot.on('entitySpawn',e=>spawns.push({type:e.name,x:e.position.x,y:e.position.y,z:e.position.z}));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('kicked',reject);setTimeout(()=>reject(Error('Spawn timeout')),30000).unref();});
  for(const rule of ['doMobSpawning false','doWeatherCycle false','doDaylightCycle false','doFireTick false','sendCommandFeedback true','fallDamage false','keepInventory true']) await cmd('gamerule '+rule);
  await cmd('time set midnight');
  await test('anvil mountain traps and crushes with 100 blocks',async()=>{
    const x=-801;await prepare(x);const healthBefore=bot.health;await gift('anvildrop');await idle();await sleep(4000);
    let blocks=0;const heights=[];for(let dz=-2;dz<=2;dz++){const row=[];for(let dx=-2;dx<=2;dx++){let h=0;for(let y=64;y<88;y++)if(block(x+dx,y,dz)?.endsWith('anvil')){h++;blocks++;}row.push(h);}heights.push(row);}
    assert.equal(spawns.filter(e=>e.type==='falling_block').length,100);assert.equal(blocks,100);assert.equal(heights[2][2],8);assert.ok(heights[0].every(n=>n>=3)&&heights[4].every(n=>n>=3));assert.ok(heights.every(row=>row[0]>=3&&row[4]>=3));assert.ok(bot.health<healthBefore);
    for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5]){await bot.look(yaw,0,true);bot.setControlState('forward',true);bot.setControlState('jump',true);await sleep(750);bot.clearControlStates();assert.ok(Math.abs(bot.entity.position.x-(x+.5))<2&&Math.abs(bot.entity.position.z-.5)<2);}
    return {blocks,heights,healthBefore,healthAfter:bot.health};
  });
  await test('ice attack traps, damages, stops after escape and keeps ice',async()=>{
    const x=-1001; await prepare(x); const before=bot.health; await gift('iceage'); await sleep(4000);
    let ice=0; for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(let y=63;y<=66;y++)if(block(x+dx,y,dz)==='packed_ice')ice++;
    const trappedHealth=bot.health; assert.equal(ice,36); assert.ok(trappedHealth<=before-6,{before,trappedHealth});
    await bot.look(0,0,true); bot.setControlState('forward',true);bot.setControlState('jump',true);await sleep(1500);bot.clearControlStates();
    assert.ok(Math.abs(bot.entity.position.x-(x+.5))<1.5&&Math.abs(bot.entity.position.z-.5)<1.5);
    await cmd('tp GiftTester '+(x+10.5)+' 64 0.5'); await sleep(1000); const escapedHealth=bot.health; await sleep(2500);assert.ok(bot.health>=escapedHealth);assert.equal(block(x,64),'packed_ice');
    return {ice,before,trappedHealth,escapedHealth,afterEscape:bot.health,iceRemains:true};
  });
  await test('meteor shower has twenty thirty-block clusters, fragments, trails and craters',async()=>{
    const x=-2401;await prepare(x);await cmd('fill '+(x-32)+' 57 -32 '+(x+32)+' 63 32 stone');
    await cmd('effect give GiftTester resistance 1000 255 true');await cmd('effect give GiftTester fire_resistance 1000 0 true');
    const fallingType=bot.registry.entitiesByName.falling_block.id;
    let diagonal=false;const previous=new Map();const trajectory=[];const velocities=()=>{for(const entity of Object.values(bot.entities))if(entity.name==='falling_block'){const last=previous.get(entity.id);if(last){const delta=entity.position.minus(last);if(delta.y<-.5&&Math.hypot(delta.x,delta.z)>.2){diagonal=true;if(trajectory.length<5)trajectory.push({...delta});}}previous.set(entity.id,entity.position.clone());}};const motionTimer=setInterval(velocities,25);
    bot.physicsEnabled=false;await gift('meteorshower');await idle();await sleep(1000);bot.physicsEnabled=true;clearInterval(motionTimer);
    const falling=spawns.filter(e=>e.type==='falling_block').length;const materials={};for(const e of meteorStates)if(e.type===fallingType){const name=bot.registry.blocksByStateId[e.state]?.name;materials[name]=(materials[name]||0)+1;}
    let excavated=0;for(let dx=-30;dx<=30;dx++)for(let dz=-30;dz<=30;dz++)if(block(x+dx,61,dz)==='air')excavated++;
    console.log('METEORS',JSON.stringify({falling,materials,diagonal,trajectory,particles,explosions,excavated}));
    assert.equal(falling,880);for(const material of ['magma_block','bedrock','deepslate','gold_block','obsidian'])assert.equal(materials[material],176);
    assert.ok(diagonal);assert.ok(particles>300);assert.ok(explosions>=20);assert.ok(excavated>150);return {falling,materials,diagonal,trajectory,particles,explosions,excavated};
  });
  await test('cataclysm deep crater receives falling lava',async()=>{
    const x=-1201; await prepare(x,true); await cmd('effect give GiftTester resistance 1000 255 true');await cmd('effect give GiftTester fire_resistance 1000 0 true');
    let low=64;const sample=()=>{low=Math.min(low,bot.entity.position.y);};bot.on('physicsTick',sample);
    await gift('cataclysm');await sleep(4200); const below=block(x,20); console.log('CRATER',JSON.stringify({below,position:bot.entity.position}));
    assert.ok(['air','lava'].includes(below),'Expected deep excavated centre: '+below);
    await wait(()=>block(x,76)==='lava'&&block(x,25)==='lava',35000); const lavaDepth=block(x,25);await idle();bot.off('physicsTick',sample);
    const counts=spawns.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{}); assert.ok(low<=20,'Player should fall deeply: '+low); assert.equal(lavaDepth,'lava');assert.equal(counts.tnt,100);assert.equal(counts.zombified_piglin,50);assert.equal(counts.wither,1);assert.equal(counts.falling_block,880);
    return {lowestY:low,depth:64-low,lavaAtY25:lavaDepth,counts};
  });
  await test('flood carries thirty drowned from water above',async()=>{
    const x=-1401;await prepare(x);await cmd('effect give GiftTester resistance 1000 255 true');await gift('flood');await idle();await sleep(400);
    const drowned=spawns.filter(e=>e.type==='drowned');assert.equal(drowned.length,30);assert.ok(drowned.every(e=>e.y>=111&&e.y<=114));assert.equal(block(x,112),'water');
    const counts=spawns.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{});for(const [type,n] of Object.entries({cod:8,salmon:8,tropical_fish:10,pufferfish:4,squid:4,glow_squid:3,dolphin:3,turtle:3,axolotl:3,guardian:4,elder_guardian:1}))assert.equal(counts[type],n);
    return {counts,minimumSpawnY:Math.min(...drowned.map(e=>e.y)),waterSourceY:112};
  });
  await test('zombie wave has four allied types and no zoglin',async()=>{
    const x=-1601;await prepare(x);await cmd('effect give GiftTester resistance 1000 255 true');await gift('zombiewave');await idle();await sleep(500);
    const counts=spawns.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{});for(const type of ['zombie','husk','drowned','zombie_villager'])assert.equal(counts[type],50);assert.equal(counts.zoglin||0,0);return counts;
  });
  await test('volcano erupts fifty times above a broad lava floor',async()=>{
    const x=-1801;await prepare(x);await cmd('effect give GiftTester resistance 1000 255 true');await cmd('effect give GiftTester fire_resistance 1000 0 true');await gift('volcano');await idle();await sleep(300);
    const eruptions=spawns.filter(e=>e.type==='falling_block').length;assert.equal(eruptions,50);
    let lava=0;for(let dx=-10;dx<=10;dx++)for(let dz=-10;dz<=10;dz++)if(block(x+dx,63,dz)==='lava')lava++;
    assert.ok(lava>=400,'Broad lava floor: '+lava);assert.equal(block(x-10,63,-10),'lava');assert.equal(block(x+10,63,10),'lava');return {eruptions,lavaBlocks:lava,width:21};
  });
  await test('protected area prevents ice attack and volcanic lava',async()=>{
    const x=-2001;await prepare(x);const health=bot.health;const before=(await status()).protectedSkips;
    for(const key of ['iceage','volcano']){const response=await fetch('http://127.0.0.1:25578/douma/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'gift',key,count:1,announce:false,protectionEnabled:true,protectX1:x-20,protectX2:x+20,protectZ1:-20,protectZ2:20})});assert.equal(response.status,202);await idle();}
    await sleep(1500);assert.equal(block(x,63),'stone');assert.equal(block(x,64),'air');assert.ok(bot.health>=health);assert.equal((await status()).protectedSkips-before,2);return {damagePrevented:true,blocksUnchanged:true};
  });
  const s=await status();assert.equal(s.effectsFailed,0,s.effectsError);result.passed=true;
})().catch(e=>{result.passed=false;result.error=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{bot?.quit();if(rcon)await rcon.end();fs.writeFileSync(path.join(process.env.GIFT_QA_OUTPUT||root,'terrain-attacks-results.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));});
