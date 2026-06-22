import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  ShareIntentProvider,
  useShareIntentContext,
} from "expo-share-intent";

import type { SubmitResponse } from "./api";
import AddScreen from "./screens/AddScreen";
import ConfirmationScreen from "./screens/ConfirmationScreen";
import LoginScreen from "./screens/LoginScreen";
import { clearToken, getToken } from "./storage";
import { colors } from "./theme";

/** Pull the first http(s) URL out of arbitrary shared text. */
function extractUrl(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const match = /https?:\/\/[^\s]+/.exec(text);
  return match ? match[0] : undefined;
}

function Root() {
  const [booting, setBooting] = useState(true);
  const [token, setTokenState] = useState<string | null>(null);
  const [screen, setScreen] = useState<"add" | "confirm">("add");
  const [result, setResult] = useState<SubmitResponse | null>(null);

  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();

  // Restore the saved bearer token on cold start.
  useEffect(() => {
    let active = true;
    void getToken().then((t) => {
      if (active) {
        setTokenState(t);
        setBooting(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // A URL shared from another app pre-fills the add form.
  const sharedUrl = useMemo(
    () =>
      hasShareIntent && shareIntent
        ? (shareIntent.webUrl ?? extractUrl(shareIntent.text))
        : undefined,
    [hasShareIntent, shareIntent],
  );
  const sharedTitle =
    hasShareIntent && shareIntent ? shareIntent.meta?.title : undefined;

  const handleLogin = (t: string) => {
    setTokenState(t);
    setScreen("add");
  };

  const handleLogout = () => {
    void clearToken().then(() => {
      setTokenState(null);
      setScreen("add");
      setResult(null);
    });
  };

  const handleSuccess = (r: SubmitResponse) => {
    setResult(r);
    setScreen("confirm");
  };

  let content: ReactNode;
  if (booting) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  } else if (token === null) {
    content = <LoginScreen onLogin={handleLogin} />;
  } else if (screen === "confirm" && result !== null) {
    content = (
      <ConfirmationScreen
        result={result}
        onAddAnother={() => {
          setResult(null);
          setScreen("add");
        }}
        onLogout={handleLogout}
      />
    );
  } else {
    content = (
      // Re-key on the shared URL so a fresh share remounts the form pre-filled.
      <AddScreen
        key={sharedUrl ?? "manual"}
        token={token}
        initialUrl={sharedUrl}
        initialTitle={sharedTitle}
        onSuccess={handleSuccess}
        onLogout={handleLogout}
        onConsumeShare={hasShareIntent ? resetShareIntent : undefined}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      {content}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ShareIntentProvider
        options={{ resetOnBackground: true, debug: __DEV__ }}
      >
        <Root />
      </ShareIntentProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
