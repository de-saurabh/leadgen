import { createAuthClient } from 'better-auth/client';
import { adminClient, organizationClient } from 'better-auth/client/plugins';

// Same origin as the dashboard: Vite proxies /api in dev, the API serves the build in prod.
export const authClient = createAuthClient({
  plugins: [adminClient(), organizationClient()],
});
