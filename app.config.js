// Expo config for CREA. Mapbox maps use Mapbox GL JS in a WebView (no native Mapbox SDK plugin).
// @ts-check
/** @type {{ expo: any }} */
const appJson = require('./app.json')

const basePlugins = (appJson.expo.plugins || []).filter((p) => p !== '@rnmapbox/maps')

module.exports = {
  expo: {
    ...appJson.expo,
    // Bare workflow: runtimeVersion must be a string (policies are unsupported for EAS Update).
    // Keep in lockstep with app version so OTA targets the matching store build.
    // Override with EAS_RUNTIME_VERSION when publishing JS to an older live store binary.
    runtimeVersion: process.env.EAS_RUNTIME_VERSION || String(appJson.expo.version),
    newArchEnabled: true,
    plugins: basePlugins,
  },
}
