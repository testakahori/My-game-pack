// そうてんもんさんの MOD の、Forge なしで動く確かめ（届いたものの tools/selftest から取り込んだ。2026-10-24 最後のレビュー 軽い9）。
// LedgerSmokeTest：埋め立ての MOD の requestId の二重実行の防止（RequestLedger）。ObsDedupeSmokeTest：OBSMOD の遭遇の重複の抑え（EncounterDeduplicator）。
// CI の mod-build で動かす（javac が要る）。
const fs = require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')) : name;
const suites=[
  { name:'LabLayoutTest', files:['UmetateMod/src/main/java/jp/streamtorearn/stackinggame/lab/LabLayout.java','UmetateMod/src/contractTest/java/LabLayoutTest.java'] },
  { name:'LedgerSmokeTest', files:['UmetateMod/src/main/java/jp/streamtorearn/stackinggame/event/RequestLedger.java','UmetateMod/src/main/java/jp/streamtorearn/stackinggame/event/EventRequest.java','UmetateMod/src/contractTest/java/LedgerSmokeTest.java'] },
  { name:'ObsDedupeSmokeTest', files:['ObsMod/src/main/java/jp/streamtorearn/obsmodule/encounter/EncounterDeduplicator.java','ObsMod/src/contractTest/java/ObsDedupeSmokeTest.java'] },
  // OBS ツールへ送るかの設定と、オフのときに送らないこと（2026-10-25。ObsBridgeMod と slf4j は stubs の写しを使う）。
  { name:'ObsSendSettingsTest', files:['ObsMod/src/main/java/jp/streamtorearn/obsmodule/config/ObsSendSettings.java','ObsMod/src/main/java/jp/streamtorearn/obsmodule/http/ObsControllerClient.java',
    'ObsMod/src/contractTest/stubs/jp/streamtorearn/obsmodule/ObsBridgeMod.java','ObsMod/src/contractTest/stubs/org/slf4j/Logger.java','ObsMod/src/contractTest/java/ObsSendSettingsTest.java'] },
];
for (const suite of suites) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'soutenmon-contract-'));
  try {
    cp.execFileSync(bin('javac'),['-encoding','UTF-8','--release','17','-d',temp,...suite.files],{cwd:root,windowsHide:true,stdio:'inherit'});
    cp.execFileSync(bin('java'),['-Xmx64m','-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-cp',temp,suite.name],{cwd:root,windowsHide:true,stdio:'inherit'});
  } finally { if(path.dirname(temp)===fs.realpathSync(os.tmpdir())&&path.basename(temp).startsWith('soutenmon-contract-'))fs.rmSync(temp,{recursive:true,force:true}); }
}


// アプリが書く obs-send.properties（electron/obs_send.cjs）を、OBSMOD と同じ読み方（ObsSendSettings）で読み、同じ「送るか・送り先」になるか（2026-10-25）。
// 1. アプリが書いたファイル（送り先が空なら既定）を OBSMOD が同じに読む。
// 2. アプリが受け付ける送り先は、OBSMOD でも警告なしにそのまま使われる（既定の送り先に置き換わらない）。通らない例も混ぜ、
//    アプリの確かめを通さずに生の送り先を書いて OBSMOD に読ませ、「アプリが通す ⇒ OBSMOD がそのまま使う」を全部の例で照らす
//    （JS の URL は寛容に直して読むが、Java の URI はそのまま読む。PR3 の最後のレビュー 重要1）。アプリのほうが厳しいのはかまわない。
{
  const obs = require('../electron/obs_send.cjs');
  const written = [{ enabled: true, endpoint: '' }, { enabled: false, endpoint: 'http://192.168.0.5:3000/event' }];
  const samples = [
    'http://127.0.0.1:3000/event', 'HTTPS://obs.example:8443/event', 'HtTp://127.0.0.1:3000/event', 'http://[::1]:3000/event', 'http://[::ffff:127.0.0.1]:3000/event',
    'http://localhost:3000/event?a=1&b=2#top', 'http://127.0.0.1:3000/%E3%82%A2', 'http://localhost.:3000/event', 'http://127.0.0.1:/event', 'http://obs-tool.local:3000/event',
    'http://0:3000/event', 'http://server1/event', 'http://123/event', 'http://a.b-c.d/event',
    'http:/192.168.0.5:3000/event', 'http:192.168.0.5:3000/event', 'http:///192.168.0.5:3000/event',
    'http://my_host:3000/event', 'http://a..b/event', 'http://a-.example/event', 'http://-a.example/event', 'http://foo.1abc/event',
    'http://./event', 'http://../event', 'http://*.example/event', 'http://a!b/event', 'http://a~b/event',
    'http://127.1:3000/event', 'http://0x7f.0.0.1/event', 'http://127.0.0.1.:3000/event', 'http://%31%32%37.0.0.1/event', 'http://ex%41mple.com/event',
    'http://@127.0.0.1:3000/event', 'http://:@127.0.0.1:3000/event', 'http://user:pw@127.0.0.1:3000/event',
    'http://127.0.0.1:3000/100%', 'http://127.0.0.1:3000/%zz', 'http://127.0.0.1:3000/a[0]', 'http://127.0.0.1:3000/#a#b',
    'http://256.1.1.1/event', 'http://127.0.0.1:65536/event', 'http://[fe80::1%25eth0]/event', 'ftp://192.168.0.5/event',
  ];
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'soutenmon-contract-'));
  try {
    const writtenFiles = written.map((c, i) => obs.writeObsSend(path.join(temp, `app${i}`), { enabled: c.enabled, endpoint: obs.normalizeEndpoint(c.endpoint) }));
    const sampleFiles = samples.map((endpoint, i) => { const file = path.join(temp, `raw${i}.properties`); fs.writeFileSync(file, `enabled=true\nendpoint=${endpoint}\n`, 'utf8'); return file; });
    cp.execFileSync(bin('javac'),['-encoding','UTF-8','--release','17','-d',temp,'ObsMod/src/main/java/jp/streamtorearn/obsmodule/config/ObsSendSettings.java','ObsMod/src/contractTest/java/ObsSendParity.java'],{cwd:root,windowsHide:true,stdio:'inherit'});
    const out = cp.execFileSync(bin('java'),['-Xmx64m','-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-cp',temp,'ObsSendParity',...writtenFiles,...sampleFiles],{cwd:root,windowsHide:true,encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
    // ファイルごとに、その前に出た警告と「送るか|送り先」をまとめる。
    const read = []; let warnings = [];
    for (const line of out) { if (line.startsWith('WARN ')) warnings.push(line); else if (line.startsWith('>')) { read.push({ result: line.slice(1), warnings }); warnings = []; } }
    const problems = [];
    written.forEach((c, i) => {
      const expected = `${c.enabled}|${obs.normalizeEndpoint(c.endpoint) || obs.DEFAULT_ENDPOINT}`;
      if (read[i].result !== expected || read[i].warnings.length) problems.push(`app-written ${JSON.stringify(c)}: expected ${expected}, OBSMOD read ${read[i].result} ${read[i].warnings.join(' ')}`);
    });
    let accepted = 0;
    samples.forEach((endpoint, i) => {
      let appAccepts = true;
      try { obs.normalizeEndpoint(endpoint); } catch { appAccepts = false; }
      const { result, warnings: warned } = read[written.length + i];
      const obsUsesAsIs = result === `true|${endpoint}` && !warned.length;
      if (appAccepts) accepted++;
      if (appAccepts && !obsUsesAsIs) problems.push(`${endpoint}: the app accepts it, but OBSMOD reads ${result} ${warned.join(' ')}`);
    });
    if (problems.length) throw new Error(`ObsSendParity: the app and OBSMOD read obs-send.properties differently\n${problems.join('\n')}`);
    console.log(`ObsSendParity: ${written.length} app-written files read the same in OBSMOD; ${accepted} of ${samples.length} endpoints accepted by the app are used as-is by OBSMOD`);
  } finally { if(path.dirname(temp)===fs.realpathSync(os.tmpdir())&&path.basename(temp).startsWith('soutenmon-contract-'))fs.rmSync(temp,{recursive:true,force:true}); }
}
