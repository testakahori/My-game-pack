const fs = require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'), temp=fs.mkdtempSync(path.join(os.tmpdir(),'game-contract-'));
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')) : name;
try {
  const files=['CommandRouting.java','api/GameEvents.java','api/RequestLedger.java'].map(f=>'BridgeMod/src/main/java/jp/douma/bridgemod/'+f);
  cp.execFileSync(bin('javac'),['-encoding','UTF-8','-d',temp,...files,'examples/game-integration/SessionReceiver.java','BridgeMod/src/contractTest/java/jp/douma/bridgemod/GameContractTest.java'],{cwd:root,windowsHide:true,stdio:'inherit'});
  const fixture=path.join(temp,'fixture'); fs.mkdirSync(fixture);
  cp.execFileSync(bin('java'),['-Xmx64m','-cp',temp,'jp.douma.bridgemod.GameContractTest',fixture],{cwd:root,windowsHide:true,stdio:'inherit'});
} finally { if(path.dirname(temp)===fs.realpathSync(os.tmpdir())&&path.basename(temp).startsWith('game-contract-'))fs.rmSync(temp,{recursive:true,force:true}); }
