// Invalidate synchronously on input changes, before effects: older responses
// cannot restore recommendations or slots for a newer selection.
export function createLatestRequest() {
  let revision = 0;
  let controller: AbortController | undefined;
  return {
    invalidate() { revision += 1; controller?.abort(); },
    start() {
      controller?.abort();
      controller = new AbortController();
      const current = ++revision;
      return { signal: controller.signal, isCurrent: () => current === revision };
    },
  };
}
