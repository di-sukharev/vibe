import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import { StyleSheet, View, type PressableProps, type ViewProps } from 'react-native';

import { Button } from './button';
import { useControllableState } from './controllable-state';
import { cloneWithPress, OverlayFrame, renderTextChild, Typography } from './primitives';
import { useUiTheme } from './theme';

type OverlayContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function OverlayRoot({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  return <OverlayContext.Provider value={{ open: isOpen, setOpen }}>{children}</OverlayContext.Provider>;
}

export function OverlayTrigger({ children, fallback = 'Open' }: PressableProps & { children?: ReactNode; fallback?: string }) {
  const context = useContext(OverlayContext);
  const open = () => context?.setOpen(true);

  if (children) {
    return <>{cloneWithPress(children, open)}</>;
  }

  return <Button onPress={open}>{fallback}</Button>;
}

export function OverlayClose({ children, fallback = 'Close' }: PressableProps & { children?: ReactNode; fallback?: string }) {
  const context = useContext(OverlayContext);
  const close = () => context?.setOpen(false);

  if (children) {
    return <>{cloneWithPress(children, close)}</>;
  }

  return (
    <Button variant="outline" onPress={close}>
      {fallback}
    </Button>
  );
}

export function OverlayContent({
  children,
  position = 'center',
  scrollable,
  style,
  ...props
}: ViewProps & {
  children?: ReactNode;
  position?: 'center' | 'bottom' | 'top';
  scrollable?: boolean;
}) {
  const context = useContext(OverlayContext);
  const theme = useUiTheme();

  return (
    <OverlayFrame
      visible={Boolean(context?.open)}
      position={position}
      scrollable={scrollable}
      onRequestClose={() => context?.setOpen(false)}>
      <View {...props} style={[styles.content, { gap: theme.spacing.lg }, style]}>
        {renderTextChild(children)}
      </View>
    </OverlayFrame>
  );
}

export function OverlayHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.header, style]}>
      {renderTextChild(children)}
    </View>
  );
}

export function OverlayFooter({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.footer, style]}>
      {renderTextChild(children)}
    </View>
  );
}

export function OverlayTitle({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="h5" weight="700" style={style}>
      {children}
    </Typography>
  );
}

export function OverlayDescription({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      {children}
    </Typography>
  );
}

export function OverlayNoop({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  header: {
    gap: 6,
  },
});
