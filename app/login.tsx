import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  Linking,
} from 'react-native'
import { router } from 'expo-router'
import Purchases from 'react-native-purchases'
import { supabase } from '@/lib/supabase'
import { isRetryableSupabaseError, sleep, userFacingErrorMessage } from '@/lib/userFacingError'
import {
  IOS_SIGNUP_ON_WEB_ONLY,
  getCreaWebRegisterUrl,
} from '@/lib/iosAppStoreCompliance'
import { ResponsiveScreen } from '@/components/ResponsiveScreen'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) return
    setLoading(true)
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'] | null = null
    let error: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['error'] | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await supabase.auth.signInWithPassword({ email, password })
      data = result.data
      error = result.error
      if (!error) break
      if (!isRetryableSupabaseError(error) || attempt === 1) break
      await sleep(900)
    }
    setLoading(false)
    if (error) {
      Alert.alert('Could not sign in', userFacingErrorMessage(error))
      return
    }
    if (data.user?.id && (await Purchases.isConfigured())) {
      try {
        await Purchases.logIn(data.user.id)
      } catch (e) {
        console.warn('[RevenueCat] logIn after login failed', e)
      }
    }
    router.replace('/')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ResponsiveScreen variant="compact">
      <View style={styles.inner}>
        <Text style={styles.logo}>CREA</Text>
        <Text style={styles.subtitle}>The platform for creative talent</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
            textContentType="emailAddress"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#0a0a0a" />
              : <Text style={styles.buttonText}>Log in</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.forgotRow} onPress={() => router.push('/forgot-password')} hitSlop={12}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          {Platform.OS === 'ios' ? (
            <TouchableOpacity
              style={styles.subscribeRow}
              onPress={() => router.push('/paywall')}
              hitSlop={12}
            >
              <Text style={styles.subscribeLink}>Subscribe without an account</Text>
            </TouchableOpacity>
          ) : null}

          {__DEV__ ? (
            <TouchableOpacity
              style={styles.previewRow}
              onPress={() => router.push('/platform-flow-preview')}
              hitSlop={12}
            >
              <Text style={styles.previewLink}>Flow-Prototyp ansehen</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.footer}>
          {Platform.OS === 'ios' || !IOS_SIGNUP_ON_WEB_ONLY ? (
            <>
              No account yet?{' '}
              <Text style={styles.link} onPress={() => router.push('/register')}>
                Sign up
              </Text>
            </>
          ) : (
            <>
              New to CREA?{' '}
              <Text
                style={styles.link}
                onPress={() => Linking.openURL(getCreaWebRegisterUrl()).catch(() => {})}
              >
                Create account on creaservices.de
              </Text>
            </>
          )}
        </Text>
      </View>
      </ResponsiveScreen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: {
    fontSize: 52,
    color: '#FFDC00',
    fontWeight: '900',
    letterSpacing: 6,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    marginBottom: 48,
  },
  form: { gap: 12 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 15,
  },
  button: {
    backgroundColor: '#FFDC00',
    borderRadius: 100,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  forgotRow: { alignSelf: 'center', marginTop: 16, paddingVertical: 8 },
  forgotText: { color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '600' },
  subscribeRow: { alignSelf: 'center', marginTop: 8, paddingVertical: 8 },
  subscribeLink: { color: '#FFDC00', fontSize: 14, fontWeight: '700' },
  previewRow: { alignSelf: 'center', marginTop: 4, paddingVertical: 8 },
  previewLink: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '600' },
  footer: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', marginTop: 32 },
  link: { color: '#FFDC00' },
})
