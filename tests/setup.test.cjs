const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
test('setup rejects unsupported hosts before installation and verifies packaged output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'sharpforge-setup-'));
  try {
    fs.copyFileSync(path.join(__dirname,'..','setup.sh'),path.join(root,'setup.sh'));
    fs.writeFileSync(path.join(root,'package-lock.json'),'{}');
    const bin=path.join(root,'commands');fs.mkdirSync(bin);
    function command(name,body){const file=path.join(bin,name);fs.writeFileSync(file,'#!/bin/bash\n'+body,{mode:0o755});}
    command('uname','if [[ "$1" == -s ]]; then echo "$TEST_SYSTEM"; else echo "$TEST_ARCH"; fi');
    command('node','echo 24');command('xcode-select','exit 0');command('xcrun','exit 0');
    command('npm',`echo "$*" >> calls.log
if [[ "$1" == ci ]]; then mkdir -p node_modules/.bin; printf '#!/bin/bash\\nexit 0\\n' > node_modules/.bin/electron; chmod +x node_modules/.bin/electron; fi
if [[ "$*" == *electron-builder* && "$TEST_BUNDLE" == yes ]]; then mkdir -p "release/$TEST_DIR/Cairn IDE.app"; fi`);
    function run(extra) {return spawnSync('/bin/bash',['setup.sh'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,TEST_SYSTEM:'Darwin',TEST_ARCH:'arm64',TEST_DIR:'mac-arm64',TEST_BUNDLE:'yes',...extra}});}
    const unsupported=run({TEST_SYSTEM:'Linux'});assert.notEqual(unsupported.status,0);assert.equal(fs.existsSync(path.join(root,'calls.log')),false);
    const arm=run({});assert.equal(arm.status,0,arm.stderr);assert.match(arm.stdout,/release\/mac-arm64\/Cairn IDE.app/);
    const intel=run({TEST_ARCH:'x86_64',TEST_DIR:'mac'});assert.equal(intel.status,0,intel.stderr);assert.match(intel.stdout,/release\/mac\/Cairn IDE.app/);
    fs.rmSync(path.join(root,'release'),{recursive:true});const missing=run({TEST_BUNDLE:'no'});assert.notEqual(missing.status,0);assert.match(missing.stderr,/did not produce/);
    assert.match(fs.readFileSync(path.join(root,'calls.log'),'utf8'),/exec --offline -- electron-builder/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
