const path = require('node:path');
const fs = require('node:fs');

// Keep Chromium storage, preferences and file history in the existing profile.
function legacyUserDataPath(appData, packaged, exists = fs.existsSync) {
  const names = packaged ? ['SharpForge', 'sharpforge'] : ['sharpforge', 'SharpForge'];
  return names.map(name => path.join(appData, name)).find(exists) || path.join(appData, names[0]);
}
function applyBranding(app) {
  const profile = legacyUserDataPath(app.getPath('appData'), app.isPackaged);
  fs.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setName('Cairn IDE');
}
module.exports = { applyBranding, legacyUserDataPath };
