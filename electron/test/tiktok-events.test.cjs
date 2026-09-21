const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const bridgeRequire = createRequire(path.resolve(__dirname, '../../bridge/package.json'));
const proto = bridgeRequire('tiktok-live-connector');
const { normalizeTikTokEvent, getStableSender, getSenderIdentity, isPreConnectionEvent, createLikeCounter } = require('../../bridge/tiktok_events.cjs');
const { likeRuleProgress } = require('../../bridge/event_rules.cjs');
function decoded(type, values) {
  const message={...proto[type].decode(new Uint8Array()),...values};
  for(const [key,nested] of [['common','CommonMessageData'],['user','User'],['toUser','User'],['gift','Gift']]) {
    if(values[key])message[key]={...proto[nested].decode(new Uint8Array()),...values[key]};
  }
  return proto[type].decode(proto[type].encode(message).finish());
}
test('現行protobufコメント: contentを本文へ変換し、旧comment・数字の0・空本文も保持する', () => {
  const raw = decoded('WebcastChatMessage', { content:'こんばんは！', user:{ nickname:'赤堀堂馬' } });
  const event = normalizeTikTokEvent(raw, 'chat');
  assert.equal(event.comment, 'こんばんは！'); assert.equal(getStableSender(event), '赤堀堂馬');
  assert.equal(normalizeTikTokEvent({ comment:'以前の形式' }, 'chat').comment, '以前の形式');
  assert.equal(normalizeTikTokEvent(decoded('WebcastChatMessage', { content:'0' }), 'chat').comment, '0');
  assert.equal(normalizeTikTokEvent(decoded('WebcastChatMessage', {}), 'chat').comment, '');
  assert.equal(raw.comment, undefined);
});
test('現行protobuf: 贈り主・ギフト名・コイン・メッセージIDをネストから取得', () => {
  const raw = decoded('WebcastGiftMessage', { common: { msgId:'8676543210987654321', createTime:'1800000000' },
    user:{ nickname:'赤堀堂馬', displayId:'akahoridouma', id:'1234567890123456789' },
    toUser:{ nickname:'配信者' }, giftId:'5655', gift:{ name:'バラ', diamondCount:1 }, repeatCount:1 });
  const event = normalizeTikTokEvent(raw, 'gift');
  assert.equal(getStableSender(event),'赤堀堂馬');
  assert.equal(getSenderIdentity(event),'1234567890123456789');
  assert.equal(event.giftName,'バラ'); assert.equal(event.diamondCount,1);
  assert.equal(event.msgId,'8676543210987654321'); assert.equal(event.createTime,1800000000);
  assert.equal(raw.nickname, undefined, '入力を変更しない');
});
test('旧形式互換と空の名前のフォールバック、同名ユーザーの識別', () => {
  assert.equal(getStableSender({nickname:'以前の表示名',uniqueId:'id'}),'以前の表示名');
  assert.equal(getStableSender({user:{nickname:'',displayId:'handle',id:'123'}}),'handle');
  assert.equal(getStableSender({user:{id:'456'}}),'456');
  assert.equal(getStableSender({toUser:{nickname:'配信者'}}),'unknown');
  assert.notEqual(getSenderIdentity({user:{nickname:'同名',id:'1'}}),getSenderIdentity({user:{nickname:'同名',id:'2'}}));
  assert.deepEqual(normalizeTikTokEvent({likeCount:10,totalLikeCount:100},'like').totalLikeCount,100);
});
test('現行protobuf: 100いいねの最初のパケットで1回、次の100でさらに1回', () => {
  const counter=createLikeCounter(), rule={threshold:100};
  let triggers=0;
  for(let i=1;i<=20;i++) {
    const data=decoded('WebcastLikeMessage',{common:{msgId:String(i)},count:10,total:String(i*10)});
    const p=counter.next(data);
    triggers+=likeRuleProgress(rule,p.total,Math.floor(p.previousTotal/100)).triggersToRun;
  }
  assert.equal(triggers,2);
  counter.reset();
  const p=counter.next(decoded('WebcastLikeMessage',{count:100,total:'100'}));
  assert.equal(likeRuleProgress(rule,p.total,Math.floor(p.previousTotal/100)).triggersToRun,1);
});
test('途中接続・再接続では過去分を実行せず、同じ累計・重複・逆順も二重計上しない', () => {
  const counter=createLikeCounter();
  const first=counter.next({total:'10100',count:10,common:{msgId:'1'}});
  assert.deepEqual(first,{previousTotal:10090,total:10100,received:10});
  assert.equal(likeRuleProgress({threshold:100},first.total,Math.floor(first.previousTotal/100)).triggersToRun,1);
  assert.equal(counter.next({total:'10200',count:100,common:{msgId:'1'}}),null);
  assert.equal(counter.next({total:'10100',count:10,common:{msgId:'2'}}).received,0);
  assert.equal(counter.next({total:'10000',count:10,common:{msgId:'3'}}),null);
  counter.reset();
  assert.deepEqual(counter.next({total:'20100',count:10}),{previousTotal:20090,total:20100,received:10});
  counter.reset();
  assert.deepEqual(counter.next({totalLikeCount:50000}),{previousTotal:50000,total:50000,received:0});
});
test('累計がない場合は届いた増分を加算、不正値は数えない', () => {
  const counter=createLikeCounter();
  assert.equal(counter.next({count:50}).total,50);
  assert.deepEqual(counter.next({likeCount:50}),{previousTotal:50,total:100,received:50});
  assert.equal(counter.next({count:-1,total:'NaN'}),null);
  assert.equal(counter.next({likeCount:Infinity}),null);
});
test('接続秒の新着イベントは通し、接続前のネストした時刻は除外', () => {
  assert.equal(isPreConnectionEvent({common:{createTime:'1800000000'}},1800000000999),false);
  assert.equal(isPreConnectionEvent({common:{createTime:'1799999999'}},1800000000999),true);
  assert.equal(isPreConnectionEvent({createTime:0},1800000000999),false);
});
test('視聴者数も現在のroomUser.totalから取得', () => {
  assert.equal(normalizeTikTokEvent(decoded('WebcastRoomUserSeqMessage',{total:'42'}),'roomUser').viewerCount,42);
});
