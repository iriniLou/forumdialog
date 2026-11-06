import { readdirSync, readFileSync } from "node:fs";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key)
  throw Error("Administrative key must be present for this safety check");
function scan(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const path = dir + "/" + f.name;
    if (f.isDirectory()) scan(path);
    else if (readFileSync(path).includes(Buffer.from(key)))
      throw Error(
        "Administrative key detected in a public artifact. Deployment stopped",
      );
  }
}
scan("dist");
console.log("PASS administrative key is absent from public artifacts");
