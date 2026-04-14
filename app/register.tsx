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
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'

export default function RegisterScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {
    if (!email || !password) return
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (error) {
      Alert.alert('Error', error.message)
      return
    }
    if (data.session) {
      router.replace('/')
      return
    }
    Alert.alert(
      'Almost there',
      'If email confirmation is enabled, open the link in your inbox, then log in.'
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
  footer: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', marginTop: 32 },
  link: { color: '#FFDC00' },
})
