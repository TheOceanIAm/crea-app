// Dynamic Expo config: Mapbox native plugin only when MAPBOX_DOWNLOADS_TOKEN is set (EAS / local prebuild).
// @ts-check
/** @type {{ expo: any }} */
const appJson = require('./app.json')

const basePlugins = (appJson.expo.plugins || []).filter((p) => p !== '@rnmapbox/maps')
/** Secret `sk.*` from Mapbox Account → Tokens (downloads scope). Required for `expo prebuild` / EAS native builds. */
const mapboxDownloadToken = (process.env.MAPBOX_DOWNLOADS_TOKEN || '').trim()
basePlugins.push([
  '@rnmapbox/maps',
  {
    RNMapboxMapsImpl: 'mapbox',
    RNMapboxMapsVersion: '11.20.1',
    RNMAPBOX_MAPS_DOWNLOAD_TOKEN: mapboxDownloadToken,
  },
])

module.exports = {
  expo: {
    ...appJson.expo,
    newArchEnabled: true,
    plugins: basePlugins,
  },
}
