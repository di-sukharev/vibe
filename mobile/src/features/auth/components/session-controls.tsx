import { SectionCard } from '@/components/dashboard/SectionCard';
import { Button } from '@/components/ui/button';
import { TEST_IDS } from '@/constants/testIds';

type SessionControlsProps = {
  isLoggingOut: boolean;
  onLogout: () => void;
};

export function SessionControls({
  isLoggingOut,
  onLogout,
}: SessionControlsProps) {
  return (
    <SectionCard
      description="Signing out revokes this session and removes local credentials from this device."
      title="Current session">
      <Button
        disabled={isLoggingOut}
        loading={isLoggingOut}
        testID={TEST_IDS.auth.logoutButton}
        variant="outline"
        onPress={onLogout}>
        Logout
      </Button>
    </SectionCard>
  );
}
