/**
 * Bearer-token persistence — the mobile analogue of the extension's
 * `chrome.storage.local`. We use expo-secure-store (iOS Keychain / Android
 * Keystore) so the `ext|`-namespaced HMAC token is never kept in plaintext
 * AsyncStorage. On a 401 the caller clears it and returns to the login screen.
 */
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "agentloop_dispatch_token";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
