const test=require('node:test'),assert=require('node:assert/strict');
const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');
const semver=require('semver');
const feed='<feed><entry><title>v1.0.43</title><link href="https://github.com/testakahori/My-game-pack/releases/tag/v1.0.43"/><content>Stable release</content></entry></feed>';
function provider(allowPrerelease){
 const paths=[];
 const executor={request:async o=>{paths.push(o.path);if(o.path.endsWith('.atom'))return feed;if(o.path.endsWith('/latest'))return '{"tag_name":"v1.0.43"}';if(o.path.endsWith('/latest.yml'))return 'version: 1.0.43\nfiles:\n  - url: setup.exe\n    sha512: fixture\n';throw Error('Unexpected path '+o.path);}};
 return {paths,api:new GitHubProvider({owner:'testakahori',repo:'My-game-pack'},{allowPrerelease,currentVersion:'1.0.44-local.20261003'},{executor,platform:'win32'})};
}
test('local版の旧経路で公開版なしエラーを再現し、正式版経路でlatest.ymlを取得する',async()=>{
 const old=provider(true);await assert.rejects(old.api.getLatestVersion(),/No published versions/);
 const fixed=provider(false), info=await fixed.api.getLatestVersion();
 assert.equal(info.version,'1.0.43');assert.ok(fixed.paths.at(-1).endsWith('/v1.0.43/latest.yml'));
 assert.equal(semver.gt(info.version,'1.0.44-local.20261003'),false);
});
