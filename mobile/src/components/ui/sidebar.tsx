import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import {
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { Button, type ButtonProps } from './button';
import { Input, type InputProps } from './input';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetTrigger } from './sheet';
import { Skeleton } from './skeleton';
import { Surface, UiPressable, Typography } from './primitives';
import { useControllableState } from './controllable-state';
import { useUiTheme } from './theme';

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children, open, defaultOpen = false, onOpenChange }: { children?: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [isOpen, setOpen] = useControllableState({ value: open, defaultValue: defaultOpen, onChange: onOpenChange });
  return <SidebarContext.Provider value={{ open: isOpen, setOpen }}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    return { open: false, setOpen: () => undefined, toggleSidebar: () => undefined };
  }
  return { ...context, toggleSidebar: () => context.setOpen(!context.open) };
}

export function Sidebar({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface {...props} tone="muted" rounded="xxl" style={[styles.sidebar, { gap: theme.spacing.lg }, style]}>
      {children}
    </Surface>
  );
}

export function SidebarTrigger(props: ButtonProps) {
  const sidebar = useSidebar();
  return <Button {...props} variant="outline" onPress={() => sidebar.toggleSidebar()}>{props.children ?? 'Menu'}</Button>;
}

export function SidebarRail({
  children,
  style,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const sidebar = useSidebar();
  return (
    <UiPressable {...props} style={style} onPress={() => sidebar.toggleSidebar()}>
      {children}
    </UiPressable>
  );
}

export function SidebarInset({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.inset, style]}>{children}</View>;
}

export function SidebarHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.section, style]}>{children}</View>;
}

export function SidebarContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.content, style]}>{children}</View>;
}

export function SidebarFooter({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.section, style]}>{children}</View>;
}

export function SidebarGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.group, style]}>{children}</View>;
}

export function SidebarGroupAction(props: ButtonProps) {
  return <Button {...props} size={props.size ?? 'icon-sm'} variant={props.variant ?? 'ghost'} />;
}

export function SidebarGroupContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.groupContent, style]}>{children}</View>;
}

export function SidebarGroupLabel({ children, style, ...props }: TypographyProps) {
  return <Typography {...props} variant="caption" weight="700" muted style={style}>{children}</Typography>;
}

export function SidebarInput(props: InputProps) {
  return <Input {...props} />;
}

export function SidebarMenu({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.menu, style]}>{children}</View>;
}

export function SidebarMenuItem({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={style}>{children}</View>;
}

export function SidebarMenuButton({ children, isActive, style, ...props }: ButtonProps & { isActive?: boolean }) {
  return <Button {...props} variant={isActive ? 'secondary' : 'ghost'} style={[styles.menuButton, style]}>{children}</Button>;
}

export function SidebarMenuAction(props: ButtonProps) {
  return <Button {...props} size="icon-sm" variant="ghost" />;
}

export function SidebarMenuBadge({ children, style, ...props }: TypographyProps) {
  return <Typography {...props} variant="caption" muted style={style}>{children}</Typography>;
}

export function SidebarMenuSkeleton(props: ViewProps) {
  return <Skeleton {...props} style={[{ height: 36 }, props.style]} />;
}

export function SidebarMenuSub({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.sub, style]}>{children}</View>;
}

export function SidebarMenuSubItem({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={style}>{children}</View>;
}

export function SidebarMenuSubButton(props: ButtonProps) {
  return <Button {...props} variant="ghost" size="sm" />;
}

export const SidebarSeparator = Separator;

export function SidebarSheet({ children }: { children?: ReactNode }) {
  const sidebar = useSidebar();
  return (
    <Sheet open={sidebar.open} onOpenChange={sidebar.setOpen}>
      <SheetTrigger fallback="Menu" />
      <SheetContent>{children}</SheetContent>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 8,
  },
  group: {
    gap: 8,
  },
  groupContent: {
    gap: 4,
  },
  inset: {
    flex: 1,
  },
  menu: {
    gap: 4,
  },
  menuButton: {
    justifyContent: 'flex-start',
  },
  section: {
    gap: 8,
  },
  sidebar: {
    minWidth: 260,
    padding: 16,
  },
  sub: {
    borderLeftWidth: 1,
    gap: 2,
    marginLeft: 14,
    paddingLeft: 10,
  },
});
