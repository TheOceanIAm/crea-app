const major = Number(process.version.slice(1).split(".")[0]);
if (major >= 24) {
  console.error(
    `[crea-app] Node ${process.version} wird von Expo 52 nicht unterstützt (Fehler z. B. ERR_INVALID_PACKAGE_CONFIG).\n` +
      "Bitte Node 20 LTS nutzen, z. B.:\n" +
      "  source ~/.nvm/nvm.sh && nvm use\n" +
      "Oder im Projektordner: npm start (Simulator + Metro) / npm run dev nur Metro (lädt nvm und .nvmrc, falls nvm installiert ist)."
  );
  process.exit(1);
}
if (major < 18) {
  console.error(`[crea-app] Node ${process.version} ist zu alt; bitte Node 18+ (empfohlen: 20 LTS).`);
  process.exit(1);
}
