import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, login } from "../api";
import { setToken } from "../storage";
import { colors, radius, spacing } from "../theme";

interface Props {
  onLogin: (token: string) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { token } = await login(email.trim(), password);
      await setToken(token);
      onLogin(token);
    } catch (err: unknown) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === 401) {
        setError("Incorrect email or password.");
      } else if (status === 403) {
        // Super-admins have no implicit tenant — they pick one in the web app.
        setError(
          "Choose a tenant in the web app before using the dispatch app.",
        );
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const clearError = () => {
    if (error) setError(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <View style={styles.masthead}>
          <Text style={styles.eyebrow}>AGENTLOOP DISPATCH</Text>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Add stories to your newsletter</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              clearError();
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            placeholder="you@vertexcover.io"
            placeholderTextColor={colors.muted}
            editable={!submitting}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              clearError();
            }}
            secureTextEntry
            textContentType="password"
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
            editable={!submitting}
            onSubmitEditing={() => void handleSubmit()}
          />
        </View>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (pressed || submitting) && styles.buttonPressed,
          ]}
          onPress={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: "center",
    gap: spacing.md,
  },
  masthead: { marginBottom: spacing.md, gap: spacing.xs },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "700",
  },
  title: { color: colors.text, fontSize: 32, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 15 },
  field: { gap: spacing.xs },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 14 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.accentText, fontSize: 16, fontWeight: "700" },
});
