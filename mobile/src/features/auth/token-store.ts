import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const refreshTokenKey = 'web_app_demo_refresh_token';

export async function getStoredRefreshToken() {
  if (Platform.OS === 'web') return null;

  return SecureStore.getItemAsync(refreshTokenKey);
}

export async function setStoredRefreshToken(refreshToken: string) {
  if (Platform.OS === 'web') return;

  await SecureStore.setItemAsync(refreshTokenKey, refreshToken);
}

export async function clearStoredRefreshToken() {
  if (Platform.OS === 'web') return;

  await SecureStore.deleteItemAsync(refreshTokenKey);
}
