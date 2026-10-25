// そうてんもんさんの MOD の、Forge なしで動く確かめ（届いたものの tools/selftest から取り込んだ。2026-10-24 最後のレビュー 軽い9）。
// LedgerSmokeTest：埋め立ての MOD の requestId の二重実行の防止（RequestLedger）。ObsDedupeSmokeTest：OBSMOD の遭遇の重複の抑え（EncounterDeduplicator）。
// CI の mod-build で動かす（javac が要る）。
const fs = require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')) : name;
const suites=[
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
// アプリが受け付ける送り先は、OBSMOD でもそのまま使われる（既定の送り先に置き換わらない）こと、警告が出ないことを確かめる。
{
  const obs = require('../electron/obs_send.cjs');
  const cases = [
    { enabled: true, endpoint: '' },
    { enabled: false, endpoint: 'http://192.168.0.5:3000/event' },
    { enabled: true, endpoint: 'HTTPS://obs.example:8443/event' },
    { enabled: true, endpoint: 'http://[::1]:3000/event' },
    { enabled: true, endpoint: 'http://localhost:3000/event?a=1&b=2#top' },
    { enabled: true, endpoint: 'http://127.0.0.1:3000/%E3%82%A2' },
  ];
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'soutenmon-contract-'));
  try {
    const files = cases.map((c, i) => obs.writeObsSend(path.join(temp, `server${i}`), { enabled: c.enabled, endpoint: obs.normalizeEndpoint(c.endpoint) }));
    cp.execFileSync(bin('javac'),['-encoding','UTF-8','--release','17','-d',temp,'ObsMod/src/main/java/jp/streamtorearn/obsmodule/config/ObsSendSettings.java','ObsMod/src/contractTest/java/ObsSendParity.java'],{cwd:root,windowsHide:true,stdio:'inherit'});
    const out = cp.execFileSync(bin('java'),['-Xmx64m','-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-cp',temp,'ObsSendParity',...files],{cwd:root,windowsHide:true,encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
    const warnings = out.filter(line => line.startsWith('WARN '));
    const results = out.filter(line => line.startsWith('>')).map(line => line.slice(1));
    const expected = cases.map(c => `${c.enabled}|${obs.normalizeEndpoint(c.endpoint) || obs.DEFAULT_ENDPOINT}`);
    if (warnings.length || JSON.stringify(results) !== JSON.stringify(expected)) {
      throw new Error(`ObsSendParity: the app and OBSMOD read obs-send.properties differently\n${warnings.join('\n')}\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(results)}`);
    }
    console.log(`ObsSendParity: ${cases.length} obs-send.properties written by the app read the same in OBSMOD`);
  } finally { if(path.dirname(temp)===fs.realpathSync(os.tmpdir())&&path.basename(temp).startsWith('soutenmon-contract-'))fs.rmSync(temp,{recursive:true,force:true}); }
}
