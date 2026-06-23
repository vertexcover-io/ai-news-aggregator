import { Pressable, StyleSheet, Text, View } from "react-native";

import type { SubmitResponse } from "../api";
import { colors, radius, spacing } from "../theme";

interface Props {
  result: SubmitResponse;
  onAddAnother: () => void;
  onLogout: () => void;
}

export default function ConfirmationScreen({
  result,
  onAddAnother,
  onLogout,
}: Props) {
  const { alreadyExisted } = result;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.mark}>
          <Text style={styles.markText}>✓</Text>
        </View>
        <Text style={styles.title}>
          {alreadyExisted ? "Already in the queue" : "Added to the next issue"}
        </Text>
        <Text style={styles.note}>
          {alreadyExisted
            ? "This story is already queued — no duplicate added."
            : "It'll be considered for tomorrow's newsletter."}
        </Text>
        <Text style={styles.url} numberOfLines={2}>
          {result.url}
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onAddAnother}
      >
        <Text style={styles.buttonText}>Add another</Text>
      </Pressable>

      <Pressable style={styles.ghostButton} onPress={onLogout}>
        <Text style={styles.ghostButtonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: "center",
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  markText: { color: colors.accentText, fontSize: 32, fontWeight: "800" },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  note: {
    color: colors.muted,
    fontSize: 15,
    textAlign: "center",
  },
  url: {
    color: colors.accent,
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.accentText, fontSize: 16, fontWeight: "700" },
  ghostButton: { paddingVertical: spacing.md, alignItems: "center" },
  ghostButtonText: { color: colors.muted, fontSize: 15, fontWeight: "600" },
});
