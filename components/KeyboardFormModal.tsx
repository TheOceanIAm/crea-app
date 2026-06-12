import type { ReactNode } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ModalProps,
} from 'react-native'

type Props = {
  visible: boolean
  onClose: () => void
  children: ReactNode
  animationType?: ModalProps['animationType']
}

/**
 * Centered form modal: backdrop tap dismisses keyboard + closes;
 * scrollable body so action buttons stay reachable with keyboard open.
 */
export function KeyboardFormModal({
  visible,
  onClose,
  children,
  animationType = 'fade',
}: Props) {
  const dismiss = () => {
    Keyboard.dismiss()
    onClose()
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
          pointerEvents="box-none"
        >
          <View style={styles.card}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={styles.scrollContent}
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  sheetWrap: {
    width: '100%',
    maxHeight: '88%',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: '#141414',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 18,
    flexGrow: 0,
  },
})
