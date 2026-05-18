import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { getWebAuthConfirmRedirectUrl } from '@/lib/creaWeb'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const sendLink = async () => {
    const e = email.trim().toLowerCase()
    if (!e) {
      Alert.alert('Email', 'Enter the email you used to sign up.')
      return
    }
    setLoading(true)
    const redirectTo = getWebAuthConfirmRedirectUrl()
    if (!redirectTo) {
      setLoading(false)
      Alert.alert(
        'Configuration',
        'Set EXPO_PUBLIC_CREA_WEB_URL so the reset link can open in your browser.'
      )
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo })
    setLoading(false)
    if (error) {
      Alert.alert('Could not send', error.message)
      return
    }
    Alert.alert(
      'Check your inbox',
      'We sent a reset link. Open it in your browser (creaservices.de), then update your password there.',
      [{ text: 'OK', onPress: () => router.back() }]
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.logo}>CREA</Text>
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.sub}>
          Enter your account email. You’ll get a link that opens creaservices.de in the browser to finish signing in —
          then set a new password on the website (Account / settings), or log in from the app with that password.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={sendLink}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.buttonText}>Send reset link</Text>
          )}
        </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 24, alignSelf: 'flex-start' },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  logo: {
    fontSize: 40,
    color: '#FFDC00',
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: 8,
    textAlign: 'center',
  },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 12 },
  sub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 15,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#FFDC00',
    borderRadius: 100,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },
})
