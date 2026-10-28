import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPlugin } from "../scripts/install-vencord.mjs";

test("installs and updates only the managed plugin, preserving neighboring plugins", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ep-vencord-"));
  try {
    fs.mkdirSync(path.join(root,"src","userplugins","Other"),{recursive:true});
    fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:"vencord"}));
    fs.writeFileSync(path.join(root,"src","userplugins","Other","index.ts"),"keep");
    installPlugin(root);
    const target=path.join(root,"src","userplugins","EnhancedPresenceUniversal");
    assert.ok(fs.existsSync(path.join(target,"index.ts")));
    installPlugin(root);
    assert.equal(fs.readFileSync(path.join(root,"src","userplugins","Other","index.ts"),"utf8"),"keep");
    assert.ok(fs.readdirSync(path.join(root,".enhanced-presence-backups")).length);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("refuses to overwrite an unmanaged plugin", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ep-vencord-"));
  try {
    const target=path.join(root,"src","userplugins","EnhancedPresenceUniversal");fs.mkdirSync(target,{recursive:true});
    fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:"vencord"}));
    fs.writeFileSync(path.join(target,"index.ts"),"keep");
    assert.throws(()=>installPlugin(root),/not managed/);
    assert.equal(fs.readFileSync(path.join(target,"index.ts"),"utf8"),"keep");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
