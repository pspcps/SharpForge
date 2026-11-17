const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { legacyUserDataPath } = require('../desktop/branding.cjs');
test('rename preserves the existing user-data profile across packaged and development installs', () => {
  const root = '/profiles';
  assert.equal(legacyUserDataPath(root,true,p => p === path.join(root,'sharpforge')),path.join(root,'sharpforge'));
  assert.equal(legacyUserDataPath(root,true,() => true),path.join(root,'SharpForge'));
  assert.equal(legacyUserDataPath(root,false,() => false),path.join(root,'sharpforge'));
});
test('all app icon entry points use the approved asset and build metadata matches the name', () => {
  const root = path.join(__dirname,'..');
  const source = fs.readFileSync(path.join(root,'resources/icon.png'));
  assert.ok(source.length > 1000);
  assert.deepEqual(fs.readFileSync(path.join(root,'public/icon.png')),source);
  assert.deepEqual(fs.readFileSync(path.join(root,'public/favicon.png')),source);
  const config = fs.readFileSync(path.join(root,'electron-builder.yml'),'utf8');
  assert.match(config,/productName: Cairn IDE/); assert.match(config,/appId: org.sharpforge.ide/);
});
