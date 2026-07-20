import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { useAuth } from '../provider';

export function AuthSessionErrorNotice() {
  const auth = useAuth();

  if (!auth.user || !auth.sessionError) return null;

  return (
    <Alert accessibilityLiveRegion="polite" variant="destructive">
      <AlertTitle>Session action needs attention</AlertTitle>
      <AlertDescription>{auth.sessionError}</AlertDescription>
    </Alert>
  );
}
