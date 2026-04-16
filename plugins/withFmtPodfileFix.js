/**
 * Xcode 16+ / Apple Clang: Pods/fmt 11 fails with consteval / FMT_STRING in format-inl.h.
 * -D alone is overwritten in base.h; we wrap the auto-detect block in #ifndef FMT_USE_CONSTEVAL and chmod base.h before patch.
 * Injected at the end of post_install (after react_native_post_install) so settings are not reset.
 */
const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const MARKER = '# [crea:fmt-xcode16]'

const RUBY_FIX = `
    ${MARKER}
    fmt_base = File.join(installer.sandbox.root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_base)
      t = File.read(fmt_base)
      unless t.include?('[crea:fmt-user-override]')
        t = t.sub(
          "// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.\n#if !defined(__cpp_lib_is_constant_evaluated)",
          "// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.\n// [crea:fmt-user-override]\n#ifndef FMT_USE_CONSTEVAL\n#if !defined(__cpp_lib_is_constant_evaluated)"
        )
        t = t.sub(
          "#elif FMT_GCC_VERSION >= 1002 || FMT_CLANG_VERSION >= 1101\n#  define FMT_USE_CONSTEVAL 1\n#else\n#  define FMT_USE_CONSTEVAL 0\n#endif\n#if FMT_USE_CONSTEVAL",
          "#elif FMT_GCC_VERSION >= 1002 || FMT_CLANG_VERSION >= 1101\n#  define FMT_USE_CONSTEVAL 1\n#else\n#  define FMT_USE_CONSTEVAL 0\n#endif\n#endif\n#if FMT_USE_CONSTEVAL"
        )
        unless t.include?('[crea:fmt-user-override]')
          raise 'Podfile: fmt base.h patch failed (unexpected fmt layout). Reinstall Pods or update React Native.'
        end
        File.chmod(0644, fmt_base)
        File.write(fmt_base, t)
      end
    end

    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'
      target.build_configurations.each do |cfg|
        cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
        cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_USE_CONSTEVAL=0' unless cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'].include?('FMT_USE_CONSTEVAL=0')
        cfg.build_settings['OTHER_CPLUSPLUSFLAGS'] ||= ['$(inherited)']
        cfg.build_settings['OTHER_CPLUSPLUSFLAGS'] << '-DFMT_USE_CONSTEVAL=0' unless cfg.build_settings['OTHER_CPLUSPLUSFLAGS'].include?('-DFMT_USE_CONSTEVAL=0')
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
      body = body.replace(/\n  end\nend\s*$/, `\n${RUBY_FIX}\n  end\nend`)
      fs.writeFileSync(podfilePath, body)
      return cfg
    },
  ])
}

module.exports = withFmtPodfileFix
