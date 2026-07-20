import {
  Tabs as RouterTabs,
} from 'expo-router';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/components/ui/typography';
import { useUiTheme } from '@/components/ui/theme';
import { TEST_IDS } from '@/constants/testIds';

export default function AppTabs() {
  const theme = useUiTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 56 + Math.max(insets.bottom, theme.spacing.sm);

  return (
    <RouterTabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background },
        tabBarActiveTintColor: theme.colors.foreground,
        tabBarActiveBackgroundColor: theme.colors.accent,
        tabBarButton: NativeTabButton,
        tabBarHideOnKeyboard: true,
        tabBarInactiveBackgroundColor: theme.colors.transparent,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarItemStyle: [
          styles.tabBarItem,
          {
            borderRadius: theme.radius.lg,
            marginHorizontal: theme.spacing.xs,
            paddingVertical: theme.spacing.xs,
          },
        ],
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: theme.colors.background,
            borderTopColor: theme.colors.border,
            height: tabBarHeight,
            paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
            paddingTop: theme.spacing.sm,
          },
        ],
      }}>
      <RouterTabs.Screen
        name="components"
        options={{
          title: 'Components',
          tabBarLabel: ({ color }) => (
            <Typography colorValue={color} variant="caption" weight="700">
              Components
            </Typography>
          ),
          tabBarButtonTestID: TEST_IDS.tabs.componentsTab,
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'square.grid.2x2.fill', android: 'view_module', web: 'view_module' }}
              size={size}
              tintColor={color}
            />
          ),
        }}
      />
      <RouterTabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: ({ color }) => (
            <Typography colorValue={color} variant="caption" weight="700">
              Profile
            </Typography>
          ),
          tabBarButtonTestID: TEST_IDS.tabs.profileTab,
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'person.crop.circle.fill', android: 'person', web: 'person' }}
              size={size}
              tintColor={color}
            />
          ),
        }}
      />
    </RouterTabs>
  );
}

function NativeTabButton({
  style,
  ...props
}: BottomTabBarButtonProps) {
  const theme = useUiTheme();

  return (
    <PlatformPressable
      {...props}
      pressOpacity={theme.opacity.pressed}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabBarItem: {
    overflow: 'hidden',
  },
});
