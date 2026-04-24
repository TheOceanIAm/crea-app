import { Redirect } from 'expo-router'
import { DevDemoProjectWorkspace } from '@/components/demo/DevDemoProjectWorkspace'
import { getDevDemoLinkedProjectId, isDevDemoWorkspaceRouteEnabled } from '@/lib/devDemoWorkspace'

/**
 * Dev workspace entry from the dashboard when demo is enabled (__DEV__ or
 * EXPO_PUBLIC_ENABLE_DEMO_WORKSPACE). By default: mock UI (no Supabase).
 * Set EXPO_PUBLIC_DEMO_PROJECT_ID to a real `projects.id` to open the live workspace instead.
 */
export default function DevDemoProjectScreen() {
  if (!isDevDemoWorkspaceRouteEnabled()) {
    return <Redirect href="/(tabs)/dashboard" />
  }
  const realId = getDevDemoLinkedProjectId()
  if (realId) {
    return <Redirect href={`/project/${realId}`} />
  }
  return <DevDemoProjectWorkspace />
}
