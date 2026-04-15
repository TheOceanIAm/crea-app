import { Redirect } from 'expo-router'
import { DevDemoProjectWorkspace } from '@/components/demo/DevDemoProjectWorkspace'
import { isDevDemoWorkspaceRouteEnabled } from '@/lib/devDemoWorkspace'

/**
 * Mock project workspace (no Supabase). CEO opens from dashboard when demo is enabled
 * (__DEV__ or EXPO_PUBLIC_ENABLE_DEMO_WORKSPACE at build time).
 */
export default function DevDemoProjectScreen() {
  if (!isDevDemoWorkspaceRouteEnabled()) {
    return <Redirect href="/(tabs)/dashboard" />
  }
  return <DevDemoProjectWorkspace />
}
