/**
 * Xcode 16+: Pods/fmt fails with consteval / FMT_STRING errors in format-inl.h.
 * Defining FMT_USE_CONSTEVAL=0 fixes the build (see fmt + Apple Clang discussions).
 */
const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const MARKER = '# [crea:fmt-xcode16]'

const RUBY_FIX = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'
      target.build_configurations.each do |cfg|
        cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
        cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_USE_CONSTEVAL=0'
      end
    end
`

function withFmtPodfileFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile')
      let body = fs.readFileSync(podfilePath, 'utf8')
      if (body.includes(MARKER)) return cfg
      body = body.replace(/post_install do \|installer\|\s*\n/, `post_install do |installer|\n${RUBY_FIX}\n`)
      fs.writeFileSync(podfilePath, body)
      return cfg
    },
  ])
}

module.exports = withFmtPodfileFix
