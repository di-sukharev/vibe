import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { SiteHeader } from './SiteHeader';

type ScreenShellProps = {
  actions?: ReactNode;
  backButton?: boolean | 'auto';
  backButtonTestID?: string;
  backFallbackHref?: Href;
  centered?: boolean;
  children: ReactNode;
  description?: ReactNode;
  descriptionTestID?: string;
  eyebrow?: ReactNode;
  headerTestID?: string;
  keyboardAware?: boolean;
  scroll?: boolean;
  testID?: string;
  title: ReactNode;
  titleTestID?: string;
};

export function ScreenShell({
  actions,
  backButton,
  backButtonTestID,
  backFallbackHref,
  centered,
  children,
  description,
  descriptionTestID,
  eyebrow,
  headerTestID,
  keyboardAware,
  scroll = true,
  testID,
  title,
  titleTestID,
}: ScreenShellProps) {
  return (
    <Screen
      backButton={backButton}
      backButtonTestID={backButtonTestID}
      backFallbackHref={backFallbackHref}
      centered={centered}
      contentStyle={styles.content}
      keyboardAvoiding={keyboardAware}
      scroll={scroll}
      scrollViewProps={{
        keyboardDismissMode: keyboardAware ? 'on-drag' : undefined,
        keyboardShouldPersistTaps: keyboardAware ? 'handled' : undefined,
        showsVerticalScrollIndicator: false,
      }}
      testID={testID}>
      <SiteHeader
        actions={actions}
        description={description}
        descriptionTestID={descriptionTestID}
        eyebrow={eyebrow}
        rootTestID={headerTestID}
        title={title}
        titleTestID={titleTestID}
      />
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    maxWidth: 1120,
    width: '100%',
  },
});
