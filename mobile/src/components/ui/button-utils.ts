import type { ReactNode } from 'react';

export function buttonAccessibilityLabel(children: ReactNode) {
  return typeof children === 'string' || typeof children === 'number'
    ? String(children)
    : undefined;
}
