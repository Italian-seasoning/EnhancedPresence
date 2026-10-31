import { test } from "node:test";
import assert from "node:assert/strict";
import { PresenceEngine } from "../presence-engine/engine.mjs";
import { appIcon } from "../vencord-plugin/EnhancedPresenceUniversal/icons.mjs";

test("Adobe names remain private unless enabled and safe", async () => {
  const id = "com.adobe.Photoshop";
  const snapshot = { appId: id, pid: 4, idleSeconds: 0, inactive: false, documentName: "Sample.psd — Adobe Photoshop 2026" };
  const generic = new PresenceEngine();
  assert.doesNotMatch((await generic.update(snapshot)).details, /Sample/);
  const named = new PresenceEngine({ disclosure: { [id]: { showName: true, showContext: false } } });
  assert.match((await named.update(snapshot)).details, /Sample/);
  assert.doesNotMatch((await named.update({...snapshot, documentName: "/private/path.psd"})).details, /private/);
});
test("After Effects and Paper have artwork", () => {
  for (const id of ["com.adobe.AfterEffects", "com.todesktop.2601167vjw8xe"]) assert.ok(appIcon(id));
});

test("all curated apps have public artwork", async () => {
  const { profiles } = await import("../vencord-plugin/EnhancedPresenceUniversal/profiles.mjs");
  assert.ok(appIcon("com.apple.Notes"));
  const missing = Object.keys(profiles).filter(id => !appIcon(id));
  assert.deepEqual(missing, []);
});

test("Photoshop presence excludes zoom and layer details", async () => {
  const id = "com.adobe.Photoshop";
  const e = new PresenceEngine({ disclosure: { [id]: { showName: true, showContext: false } } });
  const a = await e.update({ appId: id, pid: 4, idleSeconds: 0, inactive: false, documentName: "Example.psd @ 25% (private layer, RGB/8) *" });
  assert.match(a.details, /Example/);
  assert.doesNotMatch(a.details, /private layer|25%/);
});

test("creative activity stays visible during brief app changes", async () => {
  const f = "com.apple.FinalCut", codex = "com.openai.codex", discord = "com.hnc.Discord";
  const e = new PresenceEngine({ switchDelaySeconds: 60 });
  const snap = (appId, runningApps = { [f]: [1], [codex]: [2] }) => ({ appId, pid: appId === f ? 1 : 2, idleSeconds: 0, inactive: false, runningApps });
  await e.update(snap(f, { [f]: [1] }), 100000);
  assert.equal((await e.update(snap(codex), 101000)).appId, f);
  assert.equal((await e.update(snap(discord), 102000)).appId, f);
  assert.equal(await e.update(snap(discord, {}), 163000), null);
  assert.equal(await e.update({...snap(discord), inactive:true}, 165000), null);
});

test("private apps clear immediately and withdrawing consent clears a retained name", async () => {
  const f = "com.apple.FinalCut", discord = "com.hnc.Discord";
  const e = new PresenceEngine({disclosure:{[f]:{showName:true,showContext:false}}});
  const snap = appId => ({appId,pid:1,idleSeconds:0,inactive:false,documentName:"Example",runningApps:{[f]:[1]}});
  assert.match((await e.update(snap(f),100000)).details,/Example/);
  e.config.disclosure[f].showName = false;
  assert.doesNotMatch((await e.update(snap(discord),101000)).details,/Example/);
  assert.equal(await e.update(snap("com.apple.Passwords"),102000), null);
});

test("activity resumes from the app launch time and resets for a new process", async () => {
  const e = new PresenceEngine({ switchDelaySeconds: 0 });
  const snapshot = (appId, pid, launchTimestamp) => ({appId,pid,launchTimestamp,idleSeconds:0,inactive:false});
  const f = "com.apple.FinalCut", c = "com.openai.codex";
  assert.equal((await e.update(snapshot(f,1,10),100000)).startTimestamp,10);
  await e.update(snapshot(c,2,20),101000);
  assert.equal((await e.update(snapshot(f,1,10),102000)).startTimestamp,10);
  assert.equal((await e.update(snapshot(f,3,103),103000)).startTimestamp,103);
});
test("invalid launch times do not create invalid Discord timestamps", async () => {
  for (const value of [0, -5, 10000, 1.5, "30", null]) {
    const e = new PresenceEngine();
    const a = await e.update({appId:"com.apple.FinalCut",pid:1,launchTimestamp:value,idleSeconds:0,inactive:false},100000);
    assert.equal(a.startTimestamp,100);
  }
});
test("Codex uses the actual Codex icon", () => assert.match(appIcon("com.openai.codex"), /codex-icon-dark\.png$/));

test("Adobe name switch can be turned off independently", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { updateApp } = await import("../vencord-plugin/EnhancedPresenceUniversal/controls.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"ep-options-"));
  try {
    fs.writeFileSync(path.join(root,"config.local.json"), "{}", {mode:0o600});
    const id = "com.adobe.Photoshop";
    assert.equal(updateApp(root,{id,visibility:"allowed",showName:true}).apps.find(x=>x.id===id).showName,true);
    const app = updateApp(root,{id,visibility:"allowed",showName:false}).apps.find(x=>x.id===id);
    assert.equal(app.supportsName,true); assert.equal(app.showName,false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("creative phrases are short, vary by launch, and stay stable during a session", async () => {
  const original = Math.random; let r = 0;
  Math.random = () => r;
  try {
    const id="com.adobe.Photoshop", snap=(pid)=>({appId:id,pid,launchTimestamp:10+pid,idleSeconds:0,inactive:false,documentName:"Private.psd"});
    const e=new PresenceEngine({switchDelaySeconds:0}); const first=await e.update(snap(1),100000);
    r=0.99; const repeated=await e.update(snap(1),101000);
    const next=await e.update(snap(2),102000);
    assert.equal(first.details,repeated.details); assert.notEqual(first.details,next.details);
    assert.ok(first.details.length<=40 && next.details.length<=40);
    assert.doesNotMatch(first.details,/Private/);
  } finally { Math.random=original; }
});
test("custom app activity text is preserved", async () => {
  const id="com.adobe.Photoshop", e=new PresenceEngine({profiles:{[id]:{name:"Photoshop",details:"My own status"}}});
  const a=await e.update({appId:id,pid:1,idleSeconds:0,inactive:false},100000);
  assert.equal(a.details,"My own status");
});

test("Discord keeps an allowed running app until it closes or the Mac becomes inactive", async () => {
  const id="com.openai.codex", discord="com.hnc.Discord", e=new PresenceEngine({switchDelaySeconds:60});
  const active={appId:id,pid:42,launchTimestamp:10,idleSeconds:0,inactive:false,runningApps:{[id]:[42]}};
  const chatting={appId:discord,pid:9,idleSeconds:0,inactive:false,runningApps:{[id]:[42]}};
  await e.update(active,100000);
  assert.equal((await e.update(chatting,101000)).appId,id);
  assert.equal((await e.update(chatting,501000)).appId,id);
  assert.equal(await e.update({...chatting,runningApps:{}},502000),null);
  await e.update(active,503000);
  assert.equal(await e.update({...chatting,inactive:true},504000),null);
});

test("two minutes is the default delay for switching eligible apps", async () => {
  const e=new PresenceEngine();
  assert.equal(e.config.switchDelaySeconds,120);
  const codex="com.openai.codex", f="com.apple.FinalCut";
  const snap=(appId,pid)=>({appId,pid,idleSeconds:0,inactive:false,runningApps:{[codex]:[1],[f]:[2]}});
  await e.update({...snap(codex,1),runningApps:{[codex]:[1]}},100000);
  assert.equal((await e.update(snap(f,2),101000)).appId,codex);
  assert.equal((await e.update(snap(f,2),220999)).appId,codex);
  assert.equal((await e.update(snap(f,2),221000)).appId,f);
});
