import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// Verify the signed payload with its own runtime; external Discord activation is isolated.
const payload=process.argv[2], assets=join(payload,'Contents/Resources');
const {installBundle,uninstallBundle,validatePayload}=await import(pathToFileURL(join(assets,'scripts/bundle-setup.mjs')));
const {buildLoader}=await import(pathToFileURL(join(assets,'scripts/vencord-deploy.mjs')));
const root=mkdtempSync(join(tmpdir(),'ep-artifact-roundtrip-')), home=join(root,'home'), resources=join(root,'Discord.app/Contents/Resources');
try {
 const release=validatePayload(payload,{arch:process.arch,nodeVersion:process.versions.node});
 mkdirSync(resources,{recursive:true}); mkdirSync(join(home,'.claude'),{recursive:true}); mkdirSync(join(home,'.codex'),{recursive:true});
 writeFileSync(join(resources,'app.asar'),Buffer.concat([buildLoader('/discord/original.js'),Buffer.alloc(2048)]));
 writeFileSync(join(root,'Discord.app/Contents/Info.plist'),'<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.hnc.Discord</string></dict></plist>');
 const other={hooks:{Stop:[{hooks:[{type:'command',command:'echo keep'}]}]}};
 writeFileSync(join(home,'.claude/settings.json'),JSON.stringify(other)); writeFileSync(join(home,'.codex/hooks.json'),JSON.stringify(other));
 const options={payloadRoot:payload,home,resources,applicationId:'123456789012345678',noStart:true,environment:{...process.env,PATH:''},runInstaller(args,env){execFileSync(join(assets,'runtime/node'),args,{env,stdio:'inherit'});},activate(file,args,env){assert.equal(env.VENCORD_DEV_INSTALL,'1');assert.deepEqual(args,['-install','-location',join(root,'Discord.app')]);}};
 await installBundle({...options,withHooks:true});
 const support=join(home,'Library/Application Support/EnhancedPresence'),app=join(home,'Applications/EnhancedPresence Helper.app');
 const configPath=join(support,'config.local.json'), config=JSON.parse(readFileSync(configPath));
 assert.equal(config.enabled,false); config.enabled=true; config.idleSeconds=600;
 writeFileSync(configPath,JSON.stringify(config)); writeFileSync(join(support,'usage.local.json'),'{"preserved":true}',{mode:0o600});
 await installBundle({...options,withHooks:false});
 assert.equal(JSON.parse(readFileSync(join(support,'bundle-receipt.json'))).withHooks,true);
 assert.equal(JSON.parse(readFileSync(configPath)).idleSeconds,600);
 assert.equal(JSON.parse(readFileSync(configPath)).enabled,true);
 for(const label of ['app.enhancedpresence.engine','app.enhancedpresence.vencord-repair']) {
  const plist=readFileSync(join(home,'Library/LaunchAgents',label+'.plist'),'utf8');
  assert.ok(plist.includes(join(app,'Contents/Resources/runtime/node'))); assert.ok(!plist.includes(payload));
 }
 assert.ok(existsSync(join(resources,'_app.asar')));
 await uninstallBundle({home,noStart:true}); assert.equal(existsSync(app),false);
 assert.equal(JSON.parse(readFileSync(join(support,'usage.local.json'))).preserved,true);
 assert.equal(JSON.parse(readFileSync(join(home,'Library/Application Support/Vencord/settings/settings.json'))).plugins.EnhancedPresenceUniversal.enabled,false);
 for(const file of ['.claude/settings.json','.codex/hooks.json']) {
  assert.ok(!readFileSync(join(home,file),'utf8').includes('agent-hook.sh'));
  assert.ok(readFileSync(join(home,file),'utf8').includes('echo keep'));
 }
 console.log(JSON.stringify({architecture:release.arch,version:release.version,bundledNode:process.versions.node,roundtrip:true,noDevelopmentTools:true}));
} finally {rmSync(root,{recursive:true,force:true});}
