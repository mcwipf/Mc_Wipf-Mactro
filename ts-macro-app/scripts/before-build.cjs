/**
 * before-build.cjs
 *
 * Temporarily hides uiohook-napi's binding.gyp so @electron/rebuild doesn't
 * try to compile it from source. uiohook-napi ships NAPI prebuilts in
 * prebuilds/win32-x64/ that node-gyp-build loads at runtime without needing
 * a rebuild. The file is restored in after-pack.cjs.
 */

const path = require("path");
const { renameSync, readFileSync, writeFileSync, existsSync } = require("fs");

const PKG_DIR = path.join(__dirname, "..", "node_modules", "uiohook-napi");
const GYP_FILE = path.join(PKG_DIR, "binding.gyp");
const GYP_BAK = path.join(PKG_DIR, "binding.gyp.disabled");
const PKG_FILE = path.join(PKG_DIR, "package.json");

module.exports = async function beforeBuild() {
  // Hide binding.gyp so @electron/rebuild skips this module.
  if (existsSync(GYP_FILE)) {
    renameSync(GYP_FILE, GYP_BAK);
  }

  // Also clear the gypfile flag in package.json as a belt-and-suspenders measure.
  if (existsSync(PKG_FILE)) {
    const pkg = JSON.parse(readFileSync(PKG_FILE, "utf8"));
    if (pkg.gypfile) {
      pkg._gypfile_saved = pkg.gypfile;
      delete pkg.gypfile;
      writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2));
    }
  }

  // Ensure restoration even if the build fails partway through.
  process.on("exit", restoreUiohookNapi);
};

function restoreUiohookNapi() {
  try {
    if (existsSync(GYP_BAK)) renameSync(GYP_BAK, GYP_FILE);
    if (existsSync(PKG_FILE)) {
      const pkg = JSON.parse(readFileSync(PKG_FILE, "utf8"));
      if (pkg._gypfile_saved !== undefined) {
        pkg.gypfile = pkg._gypfile_saved;
        delete pkg._gypfile_saved;
        writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2));
      }
    }
  } catch (_) {
    // Best-effort restoration; don't crash the build process.
  }
}
