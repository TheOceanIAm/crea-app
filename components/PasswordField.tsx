import { useState } from 'react'
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { Eye, EyeOff } from 'lucide-react-native'

type PasswordFieldProps = Omit<TextInputProps, 'secureTextEntry'> & {
  containerStyle?: StyleProp<ViewStyle>
}

export function PasswordField({
  style,
  containerStyle,
  placeholderTextColor,
  autoCapitalize,
  autoCorrect,
  editable = true,
  ...rest
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)

  return (
    <View style={[styles.wrap, containerStyle]}>
      <TextInput
        {...rest}
        editable={editable}
        secureTextEntry={!visible}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={autoCorrect ?? false}
        placeholderTextColor={placeholderTextColor ?? 'rgba(255,255,255,0.3)'}
        style={[style as StyleProp<TextStyle>, styles.pad]}
      />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        disabled={!editable}
        style={styles.toggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        accessibilityState={{ checked: visible, disabled: !editable }}
      >
        {visible ? (
          <EyeOff size={18} color="rgba(255,255,255,0.45)" strokeWidth={1.8} />
        ) : (
          <Eye size={18} color="rgba(255,255,255,0.45)" strokeWidth={1.8} />
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  pad: { paddingRight: 48 },
  toggle: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
