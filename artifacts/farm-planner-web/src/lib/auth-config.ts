export const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === "true";

/**
 * Trims a pasted Clerk publishable key and restores a lost leading "p"
 * ("k_test_..." to "pk_test_..."). Without this, Clerk treats the key as
 * missing, derives a production key from the host and the app hangs
 * loading Clerk from a proxy path that does not exist.
 */
export function normalizePublishableKey(key: string | undefined): string | undefined {
  const trimmed = key?.trim();
  if (!trimmed) return undefined;
  return /^k_(test|live)_/.test(trimmed) ? `p${trimmed}` : trimmed;
}
