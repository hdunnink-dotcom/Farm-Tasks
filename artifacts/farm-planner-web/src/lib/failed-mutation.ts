/** Text for the "Changes needing attention" list: the server's reason when it gave one. */
export function failedMutationReason(mutation: { lastError?: string; serverMessage?: string }): string {
  if (mutation.lastError === 'Needs attention' && mutation.serverMessage) return mutation.serverMessage;
  return mutation.lastError ?? 'Needs attention';
}
