import {
  TabList,
  TabSlot,
  Tabs,
  TabTrigger,
  type TabListProps,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  NavigationRail,
  NavigationRailItem,
  NAVIGATION_RAIL_WIDTH,
  dashboardNavigationMode,
} from '@/components/dashboard';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';

export default function AppTabs() {
  const theme = useUiTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const navigationMode = dashboardNavigationMode(width);
  const usesRail = navigationMode === 'rail';
  const bottomPadding = Math.max(insets.bottom, theme.spacing.sm);
  const slotStyle = StyleSheet.flatten([
    styles.slot,
    usesRail
      ? styles.slotWithRail
      : { paddingBottom: 56 + bottomPadding },
  ]);
  const tabBarStyle = StyleSheet.flatten([
    styles.tabBar,
    {
      backgroundColor: theme.colors.background,
      borderTopColor: theme.colors.border,
      gap: theme.spacing.sm,
      paddingBottom: bottomPadding,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
    },
  ]);

  return (
    <Tabs style={styles.root}>
      <TabSlot style={slotStyle} />
      <TabList asChild>
        {usesRail ? (
          <RailTabList>
            <TabTrigger name="components" href="/components" asChild>
              <RailTabButton
                icon={{
                  ios: 'square.grid.2x2.fill',
                  android: 'view_module',
                  web: 'view_module',
                }}
                testID={TEST_IDS.tabs.componentsTab}>
                Components
              </RailTabButton>
            </TabTrigger>
            <TabTrigger name="profile" href="/profile" asChild>
              <RailTabButton
                icon={{
                  ios: 'person.crop.circle.fill',
                  android: 'person',
                  web: 'person',
                }}
                testID={TEST_IDS.tabs.profileTab}>
                Profile
              </RailTabButton>
            </TabTrigger>
          </RailTabList>
        ) : (
          <BottomTabList style={tabBarStyle}>
            <TabTrigger name="components" href="/components" asChild>
              <TabButton
                icon={{
                  ios: 'square.grid.2x2.fill',
                  android: 'view_module',
                  web: 'view_module',
                }}
                testID={TEST_IDS.tabs.componentsTab}>
                Components
              </TabButton>
            </TabTrigger>
            <TabTrigger name="profile" href="/profile" asChild>
              <TabButton
                icon={{
                  ios: 'person.crop.circle.fill',
                  android: 'person',
                  web: 'person',
                }}
                testID={TEST_IDS.tabs.profileTab}>
                Profile
              </TabButton>
            </TabTrigger>
          </BottomTabList>
        )}
      </TabList>
    </Tabs>
  );
}

function BottomTabList(props: TabListProps) {
  return <View {...props} />;
}

function RailTabList({ children }: TabListProps) {
  return <NavigationRail title="web_app_demo">{children}</NavigationRail>;
}

type TabButtonProps = TabTriggerSlotProps & {
  icon: SymbolViewProps['name'];
};

function TabButton({ children, icon, isFocused, ...props }: TabButtonProps) {
  const theme = useUiTheme();
  const color = isFocused ? theme.colors.foreground : theme.colors.mutedForeground;

  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.tabButton,
        { gap: theme.spacing.xs },
        pressed && styles.pressed,
      ]}>
      <SymbolView name={icon} size={22} tintColor={color} />
      <Typography colorValue={color} variant="caption" weight="700">
        {children}
      </Typography>
    </Pressable>
  );
}

function RailTabButton({ children, icon, isFocused, ...props }: TabButtonProps) {
  return (
    <NavigationRailItem
      {...props}
      icon={icon}
      isActive={isFocused}
      label={typeof children === 'string' ? children : 'Navigation item'}
    />
  );
}

const styles = {
  pressed: {
    opacity: 0.72,
  },
  root: {
    flex: 1,
    minHeight: '100vh' as unknown as ViewStyle['minHeight'],
  },
  slot: {
    minHeight: '100vh' as unknown as ViewStyle['minHeight'],
  },
  slotWithRail: {
    paddingLeft: NAVIGATION_RAIL_WIDTH,
  },
  tabBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    left: 0,
    position: 'fixed' as ViewStyle['position'],
    right: 0,
  },
  tabButton: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
} satisfies Record<string, ViewStyle>;
