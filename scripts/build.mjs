import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const header = `// ==UserScript==
// @name         MWI 银河生产利润指数
// @namespace    https://github.com/dakokili/MWIindex
// @version      ${pkg.version}
// @description  三采、三制造、饮食与八个技能的税后利润指数，真实历史成交量，日周月K线。
// @author       MWIindex contributors
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      raw.githubusercontent.com
// @noframes
// @license      MIT
// ==/UserScript==
/* Includes Milkonomy-derived formulas and data, copyright (c) 2025 luyuhao.
${await readFile("vendor/Milkonomy-LICENSE", "utf8")}
*/`;
await build({
  entryPoints: ["src/main.js"],
  outfile: "mwi-profit-indices.user.js",
  bundle: true,
  format: "iife",
  target: ["chrome100", "firefox100"],
  loader: { ".css": "text" },
  banner: { js: header },
  legalComments: "inline",
});
console.log("Built mwi-profit-indices.user.js");
