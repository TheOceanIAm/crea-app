import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'crea_billing_notice_v1'

export async function getBillingNotice(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw?.trim() || null
  } catch {
    return null
  }
}

export async function setBillingNotice(message: string): Promise<void> {
  const trimmed = message.trim()
  if (!trimmed) return
  try {
    await AsyncStorage.setItem(KEY, trimmed)
  } catch {
    /* ignore */
  }
}

export async function clearBillingNotice(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
