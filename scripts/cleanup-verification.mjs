import { existsSync } from "node:fs";
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const { register } = await import("tsx/esm/api");
register();
const { get, list, remove, put } = await import("../lib/store.ts");
const fixtures = (await list("participant")).filter(
  (p) => p.team === "Verification fixture" && p.name.startsWith("Verification Participant "),
);
for (const person of fixtures) {
  for (const attempt of (await list("attempt")).filter((a) => a.participantId === person.id)) {
    await remove("submission", attempt.id);
    await remove("attempt", attempt.id);
  }
  await remove("participant", person.id);
}
for (const team of (await list("team")).filter((t) => t.name === "Verification fixture"))
  await remove("team", team.id);
const contest = await get("contest", "contest-main");
if (contest && (await list("attempt")).length === 0)
  await put("contest", contest.id, { ...contest, status: "DRAFT" });
console.log("Temporary verification participants removed. Contest left in DRAFT.");
