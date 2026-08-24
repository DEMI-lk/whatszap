// Copies static renderer assets (html/css) + bundled images into dist so the
// packaged app loads everything from a single output tree.
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const outDir = path.join(__dirname, '..', 'dist', 'renderer');
const assetsSrc = path.join(__dirname, '..', 'assets');
const assetsOut = path.join(__dirname, '..', 'dist', 'assets');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(assetsOut, { recursive: true });
for (const f of fs.readdirSync(srcDir)) {
  if (/\.(html|css)$/.test(f)) {
    fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
  }
}
if (fs.existsSync(path.join(assetsSrc, 'icon.png'))) {
  fs.copyFileSync(path.join(assetsSrc, 'icon.png'), path.join(assetsOut, 'icon.png'));
}
const avatarsSrc = path.join(assetsSrc, 'avatars');
if (fs.existsSync(avatarsSrc)) {
  const avatarsOut = path.join(assetsOut, 'avatars');
  fs.mkdirSync(avatarsOut, { recursive: true });
  for (const f of fs.readdirSync(avatarsSrc)) {
    if (/\.png$/.test(f)) fs.copyFileSync(path.join(avatarsSrc, f), path.join(avatarsOut, f));
  }
}
console.log('[copy-assets] renderer assets copied');
