// Isolated fixture test. Use load-test-suite.mjs to provision and clean up safely.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Rate, Counter, Trend } from "k6/metrics";
const codes = new SharedArray("participants", () => JSON.parse(open(__ENV.CODES_FILE)));
const users = Number(__ENV.USERS || 500);
const base = __ENV.BASE_URL;
const burstAt = Number(__ENV.BURST_AT);
const source =
  "/*" +
  " memory test ".repeat(335) +
  '*/\n#include <stdio.h>\nint main(void){int n; scanf("%d", &n); printf("%d\\n", n*(n+1)/2); return 0;}';
const finalSource = source + "\n/* final marker */";
const outcomes = new Rate("contest_success");
const accepted = new Counter("accepted_submissions");
const saves = new Counter("successful_draft_saves");
const delayed = new Counter("late_draft_intervals");
const duration = new Trend("api_latency", true);
export const options = {
  scenarios: {
    contest: { executor: "per-vu-iterations", vus: users, iterations: 1, maxDuration: "4m" },
  },
  thresholds: {
    contest_success: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    api_latency: ["p(95)<1500"],
    "api_latency{endpoint:auth/login}": ["p(95)<1500"],
    "api_latency{endpoint:attempt/start}": ["p(95)<1500"],
    "api_latency{endpoint:attempt/state}": ["p(95)<1500"],
    "api_latency{endpoint:attempt/draft}": ["p(95)<1500"],
    "api_latency{endpoint:submission}": ["p(95)<1500"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};
function send(method, path, body, cookie, expected = path === "attempt/source" ? 403 : 200) {
  const response = http.request(
    method,
    base + "/api/" + path,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      tags: { endpoint: path },
      timeout: "30s",
      responseCallback: http.expectedStatuses(expected),
    },
  );
  duration.add(response.timings.duration, { endpoint: path });
  if (response.status !== expected && __VU <= 3) {
    let error = response.error || "";
    try {
      error = response.json().error || error;
    } catch {}
    console.error(
      JSON.stringify({
        endpoint: path,
        status: response.status,
        error: String(error).slice(0, 200),
      }),
    );
  }

  return response;
}
function verify(response, name, predicate = (r) => r.status === 200) {
  const good = check(response, { [name]: predicate });
  outcomes.add(good);
  return good;
}
export default function () {
  // Stagger initial arrivals across ten seconds, as in a supervised room start.
  sleep(((__VU - 1) / users) * 10);
  const login = send("POST", "auth/login", codes[__VU - 1]);
  if (!verify(login, "participant login")) return;
  const token = login.cookies.bc_session?.[0]?.value;
  if (!token) {
    outcomes.add(false);
    return;
  }
  // Explicit cookie is needed only for the local HTTP production test (Secure cookies).
  const cookie = "bc_session=" + token;
  if (!verify(send("POST", "attempt/start", {}, cookie), "existing attempt resumes")) return;
  verify(
    send("GET", "attempt/source", undefined, cookie),
    "original source denied during coding",
    (r) => r.status === 403,
  );
  verify(send("GET", "attempt/draft", undefined, cookie), "draft restores");
  let revision = 0,
    nextState = Date.now(),
    nextSave = Date.now();
  while (Date.now() < burstAt) {
    const now = Date.now();
    if (now >= nextState) {
      verify(send("GET", "attempt/state", undefined, cookie), "state poll");
      nextState = Date.now() + 5000;
    }
    if (Date.now() >= nextSave) {
      if (Date.now() - nextSave > 1000) delayed.add(1);
      const r = send("PUT", "attempt/draft", { source, revision: ++revision }, cookie);
      if (verify(r, "draft saved")) saves.add(1);
      nextSave = Math.max(nextSave + 2000, Date.now());
    }
    sleep(0.1);
  }
  verify(send("GET", "attempt/draft", undefined, cookie), "latest acknowledged draft restores exactly", r => r.status===200 && r.json().draft===source && r.json().revision>=1);
  // All clients submit within a 30-second window, after the autosave load.
  sleep(Math.random() * 30);
  const common = {headers:{"Content-Type":"application/json",Origin:base,Cookie:cookie},timeout:"30s"};
  const race=http.batch([
    {method:"PUT",url:base+"/api/attempt/draft",body:JSON.stringify({source,revision:++revision}),params:{...common,tags:{endpoint:"attempt/draft"},responseCallback:http.expectedStatuses(200,409)}},
    {method:"POST",url:base+"/api/submission",body:JSON.stringify({source:finalSource}),params:{...common,tags:{endpoint:"submission"},responseCallback:http.expectedStatuses(200)}}
  ]);
  duration.add(race[0].timings.duration,{endpoint:"attempt/draft"});
  duration.add(race[1].timings.duration,{endpoint:"submission"});
  if(verify(race[1],"final submission accepted during concurrent autosave")) accepted.add(1);
  verify(race[0],"autosave cannot block or overwrite final submission",r=>r.status===200||r.status===409);
  verify(send("POST", "submission", {source:"duplicate"}, cookie, 409), "second final submission is rejected", r=>r.status===409);
  verify(send("GET", "attempt/state", undefined, cookie), "final submission state is visible", r=>r.status===200 && r.json().submission!==null);
  verify(
    send("GET", "leaderboard", undefined, cookie),
    "early submission cannot expose leaderboard",
    (r) => {
      if (r.status !== 200) return false;
      const data = r.json();
      return data.locked === true && Array.isArray(data.rows) && data.rows.length === 0;
    },
  );
}
export function handleSummary(data) {
  return { [__ENV.SUMMARY_FILE]: JSON.stringify(data, null, 2) };
}
