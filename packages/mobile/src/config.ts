/**
 * Single source of truth for the API origin.
 *
 * `EXPO_PUBLIC_*` vars are inlined at build time by Expo. EAS sets this per
 * profile (see eas.json); the default points at production so a bare
 * `expo export` / store build is correct without extra config.
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? "https://agentloop.vertexcover.io";
