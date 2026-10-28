// k6 run -e BASE_URL=https://staging.example -e CODES_FILE=/tmp/codes.json scripts/load-test.js
// codes.json: array of UNIQUE participant codes provisioned in a staging contest.
// Run the complete 20-minute lifecycle, then a synchronized submission burst.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
const codes = new SharedArray("codes", () => JSON.parse(open(__ENV.CODES_FILE)));
const users = Number(__ENV.USERS || 500);
if (codes.length < users) throw new Error("Supply one unique participant code per virtual user.");
export const options = {
  scenarios: {
    contest: { executor: "per-vu-iterations", vus: users, iterations: 1, maxDuration: "23m" },
  },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1500"] },
};
const base = __ENV.BASE_URL;
export default function () {
  const headers = { "Content-Type": "application/json", Origin: base };
  const post = (path, body) => http.post(base + "/api/" + path, JSON.stringify(body), { headers });
  check(post("auth/login", { code: codes[__VU - 1] }), { login: (r) => r.status === 200 });
  let r = post("attempt/start", {});
  check(r, { "attempt starts": (r) => r.status === 200 });
  const state = r.json();
  if (!state.attempt) return;
  check(http.get(base + "/api/attempt/source"), {
    "study source available": (r) => r.status === 200,
  });
  const skew = state.serverNow - Date.now();
  while (Date.now() + skew < state.attempt.viewingEndsAt) {
    sleep(5);
    http.get(base + "/api/attempt/state");
  }
  let revision = 1;
  while (Date.now() + skew < state.attempt.codingEndsAt - 30000) {
    http.put(
      base + "/api/attempt/draft",
      JSON.stringify({ source: "int main(void){return 0;}", revision: revision++ }),
      { headers },
    );
    sleep(2);
  }
  sleep(Math.random() * 20);
  check(post("submission", { source: "int main(void){return 0;}" }), {
    "submission accepted": (r) => r.status === 200,
  });
}
