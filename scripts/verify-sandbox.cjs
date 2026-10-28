const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-verify-"));
fs.chmodSync(dir, 0o755);
const args = [
  "run",
  "--rm",
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--pids-limit",
  "32",
  "--cpus",
  "0.5",
  "--memory",
  "128m",
  "--memory-swap",
  "128m",
  "--user",
  "65534:65534",
  "--ulimit",
  "fsize=1048576:1048576",
  "--tmpfs",
  "/work:rw,exec,nosuid,size=16m,mode=1777",
  "--mount",
  `type=bind,src=${dir},dst=/input,readonly`,
  ...(process.env.SANDBOX_BASE_IMAGE
    ? [
        "--mount",
        `type=bind,src=${path.resolve("judge/runner.py")},dst=/runner.py,readonly`,
        "--entrypoint",
        "python3",
        process.env.SANDBOX_BASE_IMAGE,
        "/runner.py",
      ]
    : ["blind-coding-sandbox"]),
];
function run(source) {
  fs.writeFileSync(path.join(dir, "source.c"), source, { mode: 0o644 });
  fs.writeFileSync(path.join(dir, "tests.json"), JSON.stringify([{ input: "5\n" }]), {
    mode: 0o644,
  });
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
try {
  let r = run(
    '#include <stdio.h>\nint main(){int n;scanf("%d",&n);printf("%d",n*(n+1)/2);return 0;}',
  );
  assert.equal(r.compiled, true, JSON.stringify(r));
  assert.equal(r.results[0].output, "15");
  r = run("int main(){while(1){}return 0;}");
  assert.equal(r.results[0].error, "Time limit exceeded");
  r = run(
    '#include <stdio.h>\n#include <unistd.h>\n#include <sys/socket.h>\n#include <arpa/inet.h>\nint main(){int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_port=htons(80);inet_pton(AF_INET,"1.1.1.1",&a.sin_addr);printf("%d %d",getuid(),connect(s,(void*)&a,sizeof(a))<0);return 0;}',
  );
  assert.equal(r.results[0].output, "65534 1");
  r = run("int main( {");
  assert.equal(r.compiled, false);
  console.log(
    "PASS: real GCC compilation/output, infinite-loop timeout, non-root execution, unavailable external network, compilation failure.",
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
