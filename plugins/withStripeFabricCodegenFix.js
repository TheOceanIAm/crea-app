/**
 * @stripe/stripe-react-native + RN New Architecture (Fabric):
 *
 * Codegen registers Fabric host components for Connect onboarding and payment-method messaging.
 * RN writes RCTThirdPartyFabricComponentsProvider.{h,mm} with ConnectAccountOnboardingViewCls /
 * PaymentMethodMessagingElementViewCls, but @stripe/stripe-react-native@0.65.0 does not ship the
 * matching ios/NewArch implementations → linker errors.
 *
 * Two steps (both required):
 * 1) post_install: strip provider after pod install / initial codegen.
 * 2) React-RCTFabric shell phase: RN's "Generate Specs" runs on every Xcode build and regenerates
 *    the provider; strip again before that target compiles.
 *
 * Remove this plugin + Podfile block when Stripe ships the missing NewArch views.
 */
const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const PHASE_MARKER = "    stripe_strip_phase = '[crea] Strip Stripe Fabric provider refs'"

const RUBY_FIX = `
    # [crea:stripe-fabric-codegen]
    # @stripe/stripe-react-native: Fabric provider lists views without shipped iOS NewArch impl (see plugins/withStripeFabricCodegenFix.js).
    %w[.h .mm].each do |ext|
      provider_path = File.join(__dir__, '..', 'node_modules', 'react-native', 'React', 'Fabric', "RCTThirdPartyFabricComponentsProvider\#{ext}")
      next unless File.exist?(provider_path)
      body = File.read(provider_path)
      stripped = body.gsub(/^\\s*.*ConnectAccountOnboardingViewCls.*\\n/, '').gsub(/^\\s*.*PaymentMethodMessagingElementViewCls.*\\n/, '')
      File.write(provider_path, stripped) if stripped != body
    end

    # RN runs "Generate Specs" on every Xcode build and rewrites the provider; strip again before React-RCTFabric compiles.
    ${PHASE_MARKER}
    installer.pods_project.targets.each do |t|
      next unless t.name == 'React-RCTFabric'
      t.build_configurations.each do |cfg|
        cfg.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      end
      next if t.build_phases.any? { |p| p.respond_to?(:name) && p.name == stripe_strip_phase }
      phase = t.new_shell_script_build_phase(stripe_strip_phase)
      phase.shell_script = <<~'SCRIPT'
        set -e
        ROOT="\${PODS_ROOT}/../../node_modules/react-native/React/Fabric"
        for f in "$ROOT/RCTThirdPartyFabricComponentsProvider.h" "$ROOT/RCTThirdPartyFabricComponentsProvider.mm"; do
          [ -f "$f" ] || continue
          /usr/bin/sed -i '' '/ConnectAccountOnboardingViewCls/d' "$f"
          /usr/bin/sed -i '' '/PaymentMethodMessagingElementViewCls/d' "$f"
        done
      SCRIPT
      phase.run_only_for_deployment_postprocessing = '0'
      phase.always_out_of_date = '1' if phase.respond_to?(:always_out_of_date=)
      t.build_phases.delete(phase)
      t.build_phases.insert(0, phase)
    end
`

function withStripeFabricCodegenFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile')
      let body = fs.readFileSync(podfilePath, 'utf8')
      if (body.includes(PHASE_MARKER)) return cfg
      body = body.replace(/\n  end\nend\s*$/, `\n${RUBY_FIX}\n  end\nend`)
      fs.writeFileSync(podfilePath, body)
      return cfg
    },
  ])
}

module.exports = withStripeFabricCodegenFix
