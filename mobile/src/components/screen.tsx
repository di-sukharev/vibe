import { useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useUiTheme } from '@/components/ui/theme';
import { TEST_IDS } from '@/constants/testIds';

type ScreenBackButton = boolean | 'auto';

type ScreenProps = {
  children: ReactNode;
  backButton?: ScreenBackButton;
  backButtonTestID?: string;
  backFallbackHref?: Href;
  centered?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  keyboardAvoiding?: boolean;
  padded?: boolean;
  scroll?: boolean;
  scrollViewProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle' | 'style'>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Screen({
  backButton = false,
  backButtonTestID = TEST_IDS.screen.backButton,
  backFallbackHref,
  centered,
  children,
  contentStyle,
  edges,
  keyboardAvoiding,
  padded = true,
  scroll,
  scrollViewProps,
  style,
  testID,
}: ScreenProps) {
  const router = useRouter();
  const theme = useUiTheme();
  const canGoBack = getCanGoBack(router);
  const showBackButton =
    backButton === true || (backButton === 'auto' && (canGoBack || Boolean(backFallbackHref)));

  const handleBack = () => {
    if (canGoBack) {
      router.back();
      return;
    }

    if (backFallbackHref) {
      router.replace(backFallbackHref);
    }
  };

  const body = (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      {showBackButton && (
        <View
          style={[
            styles.header,
            {
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.sm,
            },
          ]}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleBack}
            style={[
              styles.backButton,
              {
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.border,
              },
            ]}
            testID={backButtonTestID}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
              tintColor={theme.colors.foreground}
            />
          </Pressable>
        </View>
      )}

      {scroll ? (
        <ScrollView
          {...scrollViewProps}
          contentContainerStyle={[
            styles.scrollContent,
            { gap: theme.spacing.xl },
            padded && { padding: theme.spacing.xl },
            centered && styles.centeredContent,
            contentStyle,
          ]}
          style={styles.scrollView}
          testID={testID}>
          {children}
        </ScrollView>
      ) : (
        <View
          style={[
            styles.content,
            { gap: theme.spacing.xl },
            padded && { padding: theme.spacing.xl },
            centered && styles.centeredContent,
            contentStyle,
          ]}
          testID={testID}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }, style]}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </View>
  );
}

function getCanGoBack(router: ReturnType<typeof useRouter>) {
  try {
    return router.canGoBack();
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  centeredContent: {
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  header: {
    alignItems: 'flex-start',
    minHeight: 56,
  },
  keyboardView: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollView: {
    flex: 1,
  },
});
