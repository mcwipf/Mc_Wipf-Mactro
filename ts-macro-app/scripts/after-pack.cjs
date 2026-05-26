const path = require("node:path");
const fs = require("node:fs");
const { rcedit } = require("rcedit");

// Restore uiohook-napi files that were hidden in before-build.cjs to prevent
// @electron/rebuild from trying to compile them (its prebuilts don't need it).
function restoreUiohookNapi(projectDir) {
  const pkgDir = path.join(projectDir, "node_modules", "uiohook-napi");
  const gypFile = path.join(pkgDir, "binding.gyp");
  const gypBak = path.join(pkgDir, "binding.gyp.disabled");
  const pkgFile = path.join(pkgDir, "package.json");
  try {
    if (fs.existsSync(gypBak)) fs.renameSync(gypBak, gypFile);
    if (fs.existsSync(pkgFile)) {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
      if (pkg._gypfile_saved !== undefined) {
        pkg.gypfile = pkg._gypfile_saved;
        delete pkg._gypfile_saved;
        fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
      }
    }
  } catch (_) {}
}

module.exports = async function afterPack(context) {
  const projectDir = context.appDir || context.packager?.projectDir || process.cwd();
  restoreUiohookNapi(projectDir);

  if (context.electronPlatformName !== "win32") {
    return;
  }

  const appInfo = context.packager?.appInfo;
  const productFilename = appInfo?.productFilename || appInfo?.productName || "App";
  const appOutDir = context.appOutDir || path.join(context.outDir || "", "win-unpacked");
  const exePath = path.join(appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(projectDir, "build", "macro.ico");

  if (!fs.existsSync(exePath)) {
    throw new Error(`afterPack: executable not found: ${exePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`afterPack: icon not found: ${iconPath}`);
  }

  await rcedit(exePath, {
    icon: iconPath,
    "product-version": appInfo?.version || "1.0.0",
    "file-version": appInfo?.version || "1.0.0"
  });

  // Keep app identity stable for taskbar grouping.
  await rcedit(exePath, {
    "version-string": {
      ProductName: appInfo?.productName || productFilename,
      FileDescription: appInfo?.productName || productFilename,
      InternalName: productFilename,
      OriginalFilename: `${productFilename}.exe`
    }
  });
};
