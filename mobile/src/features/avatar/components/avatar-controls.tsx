import { StyleSheet, View } from 'react-native';

import { SectionCard } from '@/components/dashboard/SectionCard';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useUiTheme } from '@/components/ui/theme';
import { TEST_IDS } from '@/constants/testIds';
import { useAvatar } from '../provider';

/**
 * The controls only. The photo itself is shown by the account card above, so there is exactly
 * one avatar on the screen and no chance of two surfaces disagreeing mid-upload.
 */
export function AvatarControls() {
  const avatar = useAvatar();
  const theme = useUiTheme();
  const isBusy = avatar.isUploading || avatar.isRemoving;
  const hasAvatar = Boolean(avatar.avatar);

  return (
    <SectionCard
      description="Pick a JPEG, PNG, or HEIC photo. It is resized and re-encoded before it is uploaded, so any photo from this device fits."
      title="Profile photo">
      <View style={[styles.controls, { gap: theme.spacing.md }]}>
        <View style={[styles.actions, { gap: theme.spacing.sm }]}>
          <Button
            accessibilityLabel={hasAvatar ? 'Replace profile photo' : 'Upload profile photo'}
            disabled={isBusy}
            loading={avatar.isUploading}
            testID={TEST_IDS.profile.avatarUploadButton}
            variant="outline"
            onPress={() => {
              void avatar.uploadAvatar();
            }}>
            {hasAvatar ? 'Replace photo' : 'Upload photo'}
          </Button>

          {/* Hidden until the answer is known, so it never offers to remove nothing. */}
          {hasAvatar ? (
            <Button
              accessibilityLabel="Remove profile photo"
              disabled={isBusy}
              loading={avatar.isRemoving}
              testID={TEST_IDS.profile.avatarRemoveButton}
              variant="ghost"
              onPress={() => {
                void avatar.removeAvatar();
              }}>
              Remove
            </Button>
          ) : null}
        </View>

        {avatar.error ? (
          <Alert testID={TEST_IDS.profile.avatarError} variant="destructive">
            <AlertTitle>
              {avatar.error.write === 'remove' ? 'Photo was not removed' : 'Photo was not saved'}
            </AlertTitle>
            <AlertDescription>{avatar.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {avatar.notice && !avatar.error ? (
          <Alert testID={TEST_IDS.profile.avatarNotice}>
            <AlertTitle>{avatar.notice}</AlertTitle>
          </Alert>
        ) : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  controls: {
    flexDirection: 'column',
  },
});
