import { Screen } from '@/components/screen';
import { ScreenState } from '@/components/dashboard';

export function ScreenLoader() {
  return (
    <Screen centered padded={false}>
      <ScreenState status="loading" />
    </Screen>
  );
}
