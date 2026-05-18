const major = Number(process.version.slice(1).split(".")[0]);
if (major >= 24) {
  console.error(
    `[crea-app] Node ${process.version} is not supported by Expo 52 (e.g. ERR_INVALID_PACKAGE_CONFIG).\n` +
      "Use Node 20 LTS, for example:\n" +
      "  source ~/.nvm/nvm.sh && nvm use\n" +
      "Or from the project folder: npm start (simulator + Metro) / npm run dev for Metro only (loads nvm and .nvmrc when nvm is installed)."
  );
  process.exit(1);
}
if (major < 18) {
  console.error(`[crea-app] Node ${process.version} is too old; use Node 18+ (recommended: 20 LTS).`);
  process.exit(1);
}
