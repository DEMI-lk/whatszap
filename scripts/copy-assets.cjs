// Copies static renderer assets (html/css) into dist so the packaged app
// loads everything from a single output tree.
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const outDir = path.join(__dirname, '..', 'dist', 'renderer');
const iconSrc = path.join(__dirname, '..', 'assets', 'icon.png');
const iconOut = path.join(__dirname, '..', 'dist', 'assets');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(iconOut, { recursive: true });
for (const f of fs.readdirSync(srcDir)) {
  if (/\.(html|css)$/.test(f)) {
    fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
  }
}
if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, path.join(iconOut, 'icon.png'));
console.log('[copy-assets] renderer assets copied');
