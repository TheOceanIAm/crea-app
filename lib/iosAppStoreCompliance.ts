import { Linking, Platform } from 'react-native'

/** Apple Guideline 3.1.1: subscription purchase UI must not be in the iOS app — use the website. */
export const IOS_SUBSCRIPTION_AND_SIGNUP_ON_WEB_ONLY = Platform.OS === 'ios'

/** Marketing site (exact URL requested for App Review copy). */
export const CREA_WEBSITE_URL = 'https://creaservices.de'

export async function openCreaWebsiteInBrowser(): Promise<boolean> {
  try {
    await Linking.openURL(CREA_WEBSITE_URL)
    return true
  } catch {
    return false
  }
}
