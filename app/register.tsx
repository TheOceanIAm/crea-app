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
  Linking,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import Purchases from 'react-native-purchases'
import { supabase } from '@/lib/supabase'
import { openPrivacy, openTerms } from '@/lib/creaLegal'
import { getWebAuthConfirmRedirectUrl } from '@/lib/creaWeb'
import {
  IOS_SIGNUP_ON_WEB_ONLY,
  getCreaWebRegisterUrl,
} from '@/lib/iosAppStoreCompliance'

function RegisterIosWebOnly() {
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>CREA</Text>
        <Text style={[styles.subtitle, { marginBottom: 32 }]}>
          Create your account on creaservices.de
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => Linking.openURL(getCreaWebRegisterUrl()).catch(() => {})}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>Continue to signup</Text>
        </TouchableOpacity>
        <Text style={styles.footer}>
          Already have an account?{' '}
          <Text style={styles.link} onPress={() => router.back()}>
            Log in
          </Text>
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}

function RegisterForm() {
  const { fromPurchase } = useLocalSearchParams<{ fromPurchase?: string; plan?: string }>()
  const showPurchaseBanner = fromPurchase === 'true'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) return
    setLoading(true)
    const emailRedirectTo = getWebAuthConfirmRedirectUrl()
    if (!emailRedirectTo) {
      setLoading(false)
      Alert.alert(
        'Configuration',
        'Set EXPO_PUBLIC_CREA_WEB_URL (e.g. https://www.creaservices.de) so the confirmation link opens in the browser.'
      )
      return
    }
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: { emailRedirectTo },
    })
    setLoading(false)
    if (error) {
      Alert.alert('Error', error.message)
      return
    }
    if (data.session) {
      const userId = data.session.user.id
      try {
        await Purchases.logIn(userId)
      } catch (e) {
        console.warn('[RevenueCat] logIn after register failed', e)
      }
      router.replace(showPurchaseBanner ? '/onboarding' : '/')
      return
    }
    Alert.alert(
      'Almost there',
      'Confirm your email via the link we sent — it opens creaservices.de to finish signup. Then open the CREA app and log in.'
    )
    router.replace('/login')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>CREA</Text>
        {showPurchaseBanner ? (
          <View style={styles.purchaseBanner}>
            <Text style={styles.purchaseBannerText}>
              Your subscription is active — create your account to get started.
            </Text>
          </View>
        ) : null}
        <Text style={styles.subtitle}>Create your account</Text>

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
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.buttonText}>Sign up</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.legalFooter}>
          By signing up you agree to our{' '}
          <Text style={styles.link} onPress={openTerms}>
            Terms
          </Text>{' '}
          and{' '}
          <Text style={styles.link} onPress={openPrivacy}>
            Privacy Policy
          </Text>
          .
        </Text>

        <Text style={styles.footer}>
          Already have an account?{' '}
          <Text style={styles.link} onPress={() => router.back()}>
            Log in
          </Text>
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}

export default function RegisterScreen() {
  if (IOS_SIGNUP_ON_WEB_ONLY) {
    return <RegisterIosWebOnly />
  }
  return <RegisterForm />
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
  purchaseBanner: {
    marginBottom: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    backgroundColor: 'rgba(255,220,0,0.08)',
    padding: 14,
  },
  purchaseBannerText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
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
  legalFooter: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 20,
    paddingHorizontal: 8,
  },
  footer: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', marginTop: 16 },
  link: { color: '#FFDC00' },
})
