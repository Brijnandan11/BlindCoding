import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { cp } from "node:fs/promises";
// Use one environment-loading path for web, setup, and worker processes.
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const [command, ...args] = process.argv.slice(2);
const scripts = {
  database: "./setup-postgres.ts",
  judge: "../judge/worker.ts",
};
if (command in scripts) {
  const { register } = await import("tsx/esm/api");
  register();
  await import(new URL(scripts[command], import.meta.url).href);
} else {
  let entry = ["node_modules/next/dist/bin/next", command, ...args];
  const environment = { ...process.env };
  if (command === "start" && existsSync(".next/standalone/server.js")) {
    await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
    await cp("public", ".next/standalone/public", { recursive: true });
    const portIndex = args.findIndex((value) => value === "--port" || value === "-p");
    const hostnameIndex = args.findIndex((value) => value === "--hostname" || value === "-H");
    environment.PORT = portIndex >= 0 ? args[portIndex + 1] : environment.PORT || "3000";
    environment.HOSTNAME =
      hostnameIndex >= 0 ? args[hostnameIndex + 1] : environment.HOSTNAME || "0.0.0.0";
    entry = [".next/standalone/server.js"];
  }
  const child = spawn(process.execPath, entry, {
    stdio: "inherit",
    env: environment,
  });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
}
