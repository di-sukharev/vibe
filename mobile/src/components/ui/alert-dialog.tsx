import type { ComponentProps, ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { Button, type ButtonProps } from './button';
import { OverlayClose, OverlayContent, OverlayDescription, OverlayFooter, OverlayHeader, OverlayNoop, OverlayRoot, OverlayTitle, OverlayTrigger } from './overlay';

export const AlertDialog = OverlayRoot;
export const AlertDialogTrigger = OverlayTrigger;
export const AlertDialogCancel = OverlayClose;
export function AlertDialogContent(props: ComponentProps<typeof OverlayContent>) {
  return <OverlayContent accessibilityRole="alert" {...props} />;
}
export const AlertDialogDescription = OverlayDescription;
export const AlertDialogFooter = OverlayFooter;
export const AlertDialogHeader = OverlayHeader;
export const AlertDialogOverlay = OverlayNoop;
export const AlertDialogPortal = OverlayNoop;
export const AlertDialogTitle = OverlayTitle;

export function AlertDialogAction(props: ButtonProps) {
  return <Button {...props} variant={props.variant ?? 'default'} />;
}

export function AlertDialogMedia({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={style}>{children}</View>;
}
