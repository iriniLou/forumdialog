// Only against your dedicated disposable test event; never run against the forum.
import { createClient } from "@supabase/supabase-js";
import { performance } from "node:perf_hooks";
const {
  LOAD_URL,
  LOAD_ANON_KEY,
  LOAD_EVENT_CODE,
  LOAD_POLL_ID,
  CONFIRM_TEST_EVENT,
} = process.env;
if (
  CONFIRM_TEST_EVENT !== "yes" ||
  ![LOAD_URL, LOAD_ANON_KEY, LOAD_EVENT_CODE, LOAD_POLL_ID].every(Boolean)
)
  throw Error(
    "Set LOAD_URL, LOAD_ANON_KEY, LOAD_EVENT_CODE, LOAD_POLL_ID and CONFIRM_TEST_EVENT=yes for a disposable test event",
  );
const clients = [],
  errors = [];
for (let i = 0; i < 350; i++) {
  const c = createClient(LOAD_URL, LOAD_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInAnonymously();
  if (error)
    throw Error(`Auth setup failed at identity ${i}: ${error.message}`);
  clients.push(c);
}
const start = performance.now(),
  times = [];
await Promise.all(
  clients.map((c, i) =>
    new Promise((r) => setTimeout(r, (i * 25000) / 350)).then(async () => {
      const t = performance.now();
      const { error } = await c.rpc("submit_response", {
        p_code: LOAD_EVENT_CODE,
        p_poll: LOAD_POLL_ID,
        p_choices: [],
        p_text: "Тест нагрузки — вымышленная реплика",
      });
      if (error) errors.push(error.message);
      else times.push(performance.now() - t);
    }),
  ),
);
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      sent: 350,
      accepted: times.length,
      errors,
      elapsed_ms: performance.now() - start,
      p95_ms: times[Math.floor(times.length * 0.95)],
    },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
// Delete the disposable event and its 350 test Auth identities via Dashboard afterward.
