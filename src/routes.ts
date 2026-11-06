export const base = import.meta.env.BASE_URL;
export function appPath(path: string) {
  return base + path.replace(/^\//, "");
}
const saved = new URLSearchParams(location.search).get("route");
if (
  saved &&
  /^(join\/[a-zA-Z0-9_-]+|screen\/[a-zA-Z0-9_-]+|admin|help)\/?$/.test(saved)
)
  history.replaceState(null, "", appPath(saved) + location.hash);
export const defaultCode = import.meta.env.VITE_EVENT_CODE || "DEMO";
export const routeParts = location.pathname.slice(base.length - 1).split("/");
