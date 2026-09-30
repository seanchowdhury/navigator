import { useCallback, useSyncExternalStore } from "react";

/** Wide enough for the floating float plan card; below this it's a bottom sheet. */
export const DESKTOP_QUERY = "(min-width: 768px)";

/** Whether `query` currently matches, updating when it changes (e.g. on rotation). */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
