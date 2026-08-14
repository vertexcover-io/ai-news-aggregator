import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, submit, type SubmitResponse } from "../api";
import { colors, radius, spacing } from "../theme";

interface Props {
  token: string;
  /** URL pre-filled from an OS share (Android intent / iOS share extension). */
  initialUrl?: string;
  initialTitle?: string;
  onSuccess: (result: SubmitResponse) => void;
  onLogout: () => void;
  /** Cleared after a shared URL is consumed so it doesn't re-fill on the next visit. */
  onConsumeShare?: () => void;
}

export default function AddScreen({
  token,
  initialUrl = "",
  initialTitle = "",
  onSuccess,
  onLogout,
  onConsumeShare,
}: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState(initialTitle);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    const trimmedUrl = url.trim();
    if (trimmedUrl.length === 0) {
      setError("Enter a URL to add.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await submit(
        trimmedUrl,
        title.trim().length > 0 ? title.trim() : undefined,
        token,
      );
      onConsumeShare?.();
      onSuccess(result);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        // Token expired/invalid — bounce to login (clears stored token there).
        onLogout();
        return;
      }
      if (err instanceof ApiError && err.status === 400) {
        setError("That doesn't look like a valid URL.");
      } else {
        setError("Couldn't add it. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.masthead}>
          <Text style={styles.eyebrow}>AGENTLOOP</Text>
          <Text style={styles.title}>Add a story</Text>
          <Text style={styles.subtitle}>Queue this link for tomorrow</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>URL</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={(t) => {
              setUrl(t);
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://example.com/article"
            placeholderTextColor={colors.muted}
            editable={!submitting}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Title (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={title}
            onChangeText={setTitle}
            placeholder="Page title"
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={2}
            editable={!submitting}
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
            <Text style={styles.buttonText}>Add to next issue</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.ghostButton}
          onPress={onLogout}
          disabled={submitting}
        >
          <Text style={styles.ghostButtonText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
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
  multiline: { minHeight: 64, textAlignVertical: "top" },
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
  ghostButton: { paddingVertical: spacing.md, alignItems: "center" },
  ghostButtonText: { color: colors.muted, fontSize: 15, fontWeight: "600" },
});
