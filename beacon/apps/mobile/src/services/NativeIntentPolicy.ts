const SIMPLE_PATHS = new Set([
  "/",
  "/nearby",
  "/network",
  "/history",
  "/settings",
  "/setup",
]);
const MAX_NATIVE_LINK_LENGTH = 256;
/** Beacon has no external query-based flows. Never send encoded/query input to Router's decoder. */
export function safeNativePath(path: string): string {
  if (typeof path !== "string" || path.length > MAX_NATIVE_LINK_LENGTH)
    return "/";
  // Check before parsing or decoding; even malformed percent sequences must remain inert.
  if (
    /[\s%?#\\]/.test(path) ||
    [...path].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return "/";
  let route = path.replace(/^beacon:\/\//i, "");
  if (route === "") return "/";
  if (!route.startsWith("/")) route = "/" + route;
  if (route.length > 1 && route.endsWith("/")) route = route.slice(0, -1);
  // Existing request links now land on Help, where SOS actions live inline.
  return SIMPLE_PATHS.has(route)
    ? route
    : "/";
}
