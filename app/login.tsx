import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) return
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) { Alert.alert('Error', error.message); return }
    router.replace('/')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
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
        </View>

        <Text style={styles.footer}>
          No account yet?{' '}
          <Text style={styles.link} onPress={() => router.push('/register')}>
            Sign up
          </Text>
        </Text>
      </View>
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
  footer: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', marginTop: 32 },
  link: { color: '#FFDC00' },
})
