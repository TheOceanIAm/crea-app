// @ts-check
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

config.transpilePackages = [
  ...(config.transpilePackages ?? []),
  'mapbox-gl',
  '@vis.gl/react-mapbox',
]

module.exports = config
