const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createStreamSessions, streamBuckets } = require('../stream_sessions.cjs');

test('配信記録: 二重開始を防ぎ、再起動後も開始を保持し、終了時刻を訂正できる', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stream-record-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'sessions.json'); let now=Date.parse('2026-09-19T10:00:00Z');
  const store=createStreamSessions(()=>file,()=>now);
  const first=store.start('初配信'); assert.equal(store.start('連打').id,first.id);
  const reopened=createStreamSessions(()=>file,()=>now); assert.equal(reopened.active().title,'初配信');
  now+=3600000; const end=reopened.end(first.id); assert.equal(Date.parse(end.endedAt)-Date.parse(end.startedAt),3600000);
  assert.equal(reopened.active(),null); assert.equal(reopened.end(first.id).endedAt,end.endedAt);
  const second=store.start('2回目'); now+=3600000;store.end(second.id);
  assert.throws(()=>store.end(first.id,new Date(now).toISOString()),/重なり/);
  assert.throws(()=>store.end(first.id,'bad'),/時刻/);
  assert.throws(()=>store.end(first.id,new Date(now+1).toISOString()),/時刻/);
  fs.writeFileSync(file,'{broken');assert.throws(()=>store.start('上書き禁止'));assert.equal(fs.readFileSync(file,'utf8'),'{broken');
});
test('明示記録: 無イベントでも時間を保持し、長い無反応区間を分割しない', () => {
  const start=Date.parse('2026-09-19T00:00:00Z'),end=start+4*3600000;
  const sessions=[{id:'first',startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString()}, {id:'empty',startedAt:new Date(end+100).toISOString(),endedAt:null}];
  const rows=[{t:start+1},{t:end-1}];
  const buckets=streamBuckets(rows,sessions,90*60000,end+1000);
  assert.equal(buckets.length,2);assert.equal(buckets[0].rows.length,2);assert.equal(buckets[0].lastT-buckets[0].startT,4*3600000);
  assert.equal(buckets[1].rows.length,0);assert.equal(buckets[1].active,true);
});
test('隣接する配信でイベントを二重計上せず、推定区間とも混ぜない', () => {
  const sessions=[{id:'a',startedAt:new Date(1000).toISOString(),endedAt:new Date(2000).toISOString()}, {id:'b',startedAt:new Date(2000).toISOString(),endedAt:new Date(3000).toISOString()}];
  const buckets=streamBuckets([500,1000,2000,3000].map(t=>({t})),sessions,900000,4000);
  assert.equal(buckets.length,4);assert.equal(buckets.find(b=>b.id==='a').rows.length,1);assert.equal(buckets.find(b=>b.id==='b').rows.length,1);
});
