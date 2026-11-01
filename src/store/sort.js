/**
 * Newest first. Prefer server receive time, then payload timestamp, then id.
 */
export function sortNewestFirst(items) {
  return [...items].sort((a, b) => {
    const aTime = Number(a?.receivedAt ?? a?.timestamp ?? 0);
    const bTime = Number(b?.receivedAt ?? b?.timestamp ?? 0);
    if (bTime !== aTime) return bTime - aTime;
    return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
  });
}
