import { View } from 'react-native';

import { Typography } from '@/components/ui/typography';
import { useAuth } from '../provider';

export function AuthSessionErrorNotice() {
  const auth = useAuth();

  if (!auth.user || !auth.sessionError) return null;

  return (
    <View accessible accessibilityLiveRegion="polite">
      <Typography color="destructive" variant="body" weight="700">
        {auth.sessionError}
      </Typography>
    </View>
  );
}
