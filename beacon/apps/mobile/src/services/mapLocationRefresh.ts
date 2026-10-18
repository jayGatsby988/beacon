/** Keep the visible map current without enabling location sharing or background GPS. */
export function keepMapLocationFresh({
  refresh,
  onInitialFix,
  isForeground,
  onForeground,
}: {
  refresh: () => Promise<void>;
  onInitialFix: () => void;
  isForeground: () => boolean;
  onForeground: (refresh: () => void) => () => void;
}): () => void {
  let stopped = false;
  let pending = false;
  let initial = true;
  const update = async () => {
    if (stopped || pending || !isForeground()) return;
    pending = true;
    try {
      await refresh();
      // Only the initial fix moves the camera. Later fixes preserve map gestures.
      if (!stopped && isForeground() && initial) {
        initial = false;
        onInitialFix();
      }
    } catch {
      // Permission/GPS state is represented by the service and explicit Locate action.
    } finally {
      pending = false;
    }
  };
  void update();
  const timer = setInterval(() => void update(), 30_000);
  const unsubscribe = onForeground(() => void update());
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
  };
}
