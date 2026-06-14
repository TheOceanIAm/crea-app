import Purchases from 'react-native-purchases'

type LogLevel = (typeof Purchases.LOG_LEVEL)[keyof typeof Purchases.LOG_LEVEL]

/** RevenueCat backend blips — subscription state still works; avoid LogBox red screens in dev. */
function isTransientRevenueCatBackendMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('internal server error') ||
    m.includes('unknown backend error') ||
    m.includes('network error') ||
    m.includes('503') ||
    m.includes('502')
  )
}

/**
 * Must run before `Purchases.configure()` so the SDK does not install its default console.error handler.
 */
export function configureRevenueCatLogging(): void {
  Purchases.setLogHandler((logLevel: LogLevel, message: string) => {
    const line = `[RevenueCat] ${message}`
    if (logLevel === Purchases.LOG_LEVEL.ERROR && isTransientRevenueCatBackendMessage(message)) {
      console.warn(line)
      return
    }
    switch (logLevel) {
      case Purchases.LOG_LEVEL.DEBUG:
        console.debug(line)
        break
      case Purchases.LOG_LEVEL.INFO:
        console.info(line)
        break
      case Purchases.LOG_LEVEL.WARN:
        console.warn(line)
        break
      case Purchases.LOG_LEVEL.ERROR:
        console.error(line)
        break
      default:
        console.log(line)
    }
  })
}
