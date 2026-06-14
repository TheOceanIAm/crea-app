const { withXcodeProject, IOSConfig } = require('@expo/config-plugins')

/** Keeps TARGETED_DEVICE_FAMILY in sync with app.json `ios.supportsTablet`. */
module.exports = function withSupportsTablet(config) {
  return withXcodeProject(config, (modConfig) => {
    const supportsTablet = modConfig.ios?.supportsTablet !== false
    IOSConfig.DeviceFamily.setDeviceFamily(modConfig.modResults, supportsTablet)
    return modConfig
  })
}
