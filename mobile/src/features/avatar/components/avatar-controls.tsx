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
      description="Pick any photo. It is resized and re-encoded as JPEG before it is uploaded, so anything from this device fits."
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

        {/*
          A failed read is not cosmetic: without the answer the card offers "Upload photo" to
          someone who already has one and hides Remove entirely. Saying so, with the one action
          that recovers, beats silently misrepresenting the account.
        */}
        {avatar.isUnavailable ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Alert testID={TEST_IDS.profile.avatarLoadError} variant="destructive">
              <AlertTitle>Profile photo could not be loaded</AlertTitle>
              <AlertDescription>
                Your current photo is unknown, so the actions above may not match it.
              </AlertDescription>
            </Alert>
            {/*
              Outside the Alert, matching ScreenState. Alert sets `accessible` on its container,
              which groups its children into one element for a screen reader - a button nested
              inside it cannot be focused, and this is the only recovery this feature has.
            */}
            <View style={styles.actions}>
              <Button
                accessibilityLabel="Retry loading the profile photo"
                testID={TEST_IDS.profile.avatarReloadButton}
                variant="outline"
                onPress={avatar.reload}>
                Try again
              </Button>
            </View>
          </View>
        ) : null}

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
