/**
 * Newest first by the original event time (phone timestamp),
 * then server receive time, then id.
 *
 * Using receivedAt first made flushed/old notifications jump to the top
 * whenever they were re-synced.
 */
export function sortNewestFirst(items) {
  return [...items].sort((a, b) => {
    const aTime = Number(a?.timestamp ?? a?.receivedAt ?? 0);
    const bTime = Number(b?.timestamp ?? b?.receivedAt ?? 0);
    if (bTime !== aTime) return bTime - aTime;

    const aRecv = Number(a?.receivedAt ?? 0);
    const bRecv = Number(b?.receivedAt ?? 0);
    if (bRecv !== aRecv) return bRecv - aRecv;

    return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
  });
}
