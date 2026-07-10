import { Redirect } from 'expo-router';

import AppTabs from '@/components/app-tabs';
import { ScreenLoader } from '@/components/screen-states';
import { useAuth } from '@/features/auth';

export default function TabsLayout() {
  const auth = useAuth();

  if (auth.isBootstrapping) {
    return <ScreenLoader />;
  }

  if (!auth.user) {
    return <Redirect href="/" />;
  }

  return <AppTabs />;
}
