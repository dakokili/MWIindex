import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const file = "mwi-profit-indices.user.js";
const code = await readFile(file, "utf8");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const header = code.match(
  /^\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==/,
);
assert.ok(header, "Missing userscript metadata header");
const field = (text, key) =>
  text.match(new RegExp(`^// @${key}\\s+(.+)$`, "m"))?.[1];
assert.equal(
  field(header[1], "version"),
  pkg.version,
  "Build must use package.json version",
);
assert.equal(field(header[1], "name"), "MWI 银河生产利润指数");
assert.equal(
  field(header[1], "namespace"),
  "https://github.com/dakokili/MWIindex",
);
assert.equal(field(header[1], "license"), "MIT");
for (const key of ["description", "match", "supportURL", "homepageURL"])
  assert.ok(field(header[1], key), `Missing @${key}`);
assert.ok(
  Buffer.byteLength(code) < 2 * 1024 * 1024,
  "Greasy Fork limits scripts to 2 MB",
);
// Let Greasy Fork supply the update channel for installations from its site.
for (const key of ["updateURL", "downloadURL", "installURL"])
  assert.equal(field(header[1], key), undefined, `Do not override @${key}`);

const base = process.env.RELEASE_BASE_SHA;
if (base && !/^0+$/.test(base)) {
  assert.match(base, /^[a-f0-9]{40}$/i, "Invalid release base commit");
  const previous = execFileSync("git", ["show", `${base}:${file}`], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (code !== previous) {
    const oldVersion = field(previous, "version");
    assert.match(
      pkg.version,
      /^\d+\.\d+\.\d+$/,
      "Use a stable x.y.z release version",
    );
    assert.match(
      oldVersion,
      /^\d+\.\d+\.\d+$/,
      "Review migration from nonstandard release version",
    );
    const next = pkg.version.split(".").map(Number),
      old = oldVersion.split(".").map(Number);
    const changed = next.findIndex((n, i) => n !== old[i]);
    assert.ok(
      changed >= 0 && next[changed] > old[changed],
      "Changed userscript requires a higher version",
    );
  }
}
console.log(
  `Release check passed: v${pkg.version}, ${Buffer.byteLength(code)} bytes`,
);
