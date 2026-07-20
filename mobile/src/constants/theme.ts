import '@/global.css';

import { Platform } from 'react-native';

import {
  legacyColorTokens,
  legacySpacingTokens,
} from '@/components/ui/theme-tokens';

export const Colors = legacyColorTokens;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Spacing = legacySpacingTokens;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
