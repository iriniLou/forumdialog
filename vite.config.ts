import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (env.VITE_REQUIRE_BACKEND === "true") {
    if (
      !env.VITE_SUPABASE_URL ||
      !env.VITE_SUPABASE_ANON_KEY ||
      !env.VITE_EVENT_CODE ||
      !env.VITE_PUBLIC_ORIGIN
    )
      throw Error(
        "Production requires a shared database and a published event configuration",
      );
    const key = env.VITE_SUPABASE_ANON_KEY;
    if (key.startsWith("sb_secret_"))
      throw Error("A secret key cannot be placed in the public bundle");
    if (key.split(".").length === 3) {
      try {
        if (
          JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
            .role === "service_role"
        )
          throw Error("service_role");
      } catch (e) {
        if ((e as Error).message === "service_role")
          throw Error(
            "A service_role key cannot be placed in the public bundle",
          );
      }
    }
  }
  return { base: env.VITE_BASE_PATH || "/" };
});
