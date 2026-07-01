/** Canonical CEO auth user ids — keep in sync with crea-services/lib/ceo.ts */
const CANONICAL_CEO_USER_ID = '168f1204-bb53-4aba-95b6-5f94ccb6f197'
const ALT_CEO_USER_ID = '9be43cb1-0842-491b-8574-fba23079f16c'

export function getAllCeoUserIds(): string[] {
  return [CANONICAL_CEO_USER_ID, ALT_CEO_USER_ID]
}

export function isCeoUserId(userId: string | undefined | null): boolean {
  if (!userId) return false
  return getAllCeoUserIds().includes(userId)
}
