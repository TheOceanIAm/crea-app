import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'crea.goodNewsOfDay.shownLocalDate'

export function todayLocalDateKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function shouldShowGoodNewsModalToday(): Promise<boolean> {
  try {
    const shown = await AsyncStorage.getItem(STORAGE_KEY)
    return shown !== todayLocalDateKey()
  } catch {
    return true
  }
}

export async function markGoodNewsModalShownToday(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, todayLocalDateKey())
  } catch {
    /* ignore */
  }
}
