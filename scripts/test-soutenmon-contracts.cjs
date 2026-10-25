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
