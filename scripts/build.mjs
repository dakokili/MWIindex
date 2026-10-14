import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const header = `// ==UserScript==
// @name         MWI 银河生产利润指数
// @namespace    https://github.com/dakokili/MWIindex
// @version      ${pkg.version}
// @description  三采、三制造、饮食与八个技能的税后利润指数，真实历史成交量，日周月K线。
// @author       MWIindex contributors
// @homepageURL  https://github.com/dakokili/MWIindex
// @supportURL   https://github.com/dakokili/MWIindex/issues
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @noframes
// @license      MIT
// ==/UserScript==
/* Includes Milkonomy-derived formulas and data, copyright (c) 2025 luyuhao.
Source: https://github.com/Polokikiki/Milkonomy
Snapshot: f0b9b315b70c0e2394be7ee1a57d2e9d86556d93
${await readFile("vendor/Milkonomy-LICENSE", "utf8")}
*/`;
await build({
  entryPoints: ["src/main.js"],
  outfile: "mwi-profit-indices.user.js",
  bundle: true,
  format: "iife",
  target: ["chrome100", "firefox100"],
  minify: false,
  loader: { ".css": "text" },
  banner: { js: header },
  legalComments: "inline",
});
console.log("Built mwi-profit-indices.user.js");
