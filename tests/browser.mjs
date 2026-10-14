import { chromium } from "playwright-core";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import snapshots from "./fixtures/official-snapshots.json" with { type: "json" };
import data from "../data/milkonomy.json" with { type: "json" };
import { requiredItems } from "../src/data.js";
const items = requiredItems(data),
  latest = snapshots.at(-1).time;
const payloads = {};
const manifest = {
  version: 1,
  latestSnapshot: { timestamp: latest },
  items: {},
};
for (const id of items) {
  const path = `items/items_${id.split("/").at(-1)}__0.json`;
  const rows = snapshots
    .filter((s) => s.prices[id])
    .map((s) => ({
      time: s.time,
      a: s.prices[id].ask,
      b: s.prices[id].bid,
      p: s.prices[id].average,
      v: s.prices[id].volume,
    }));
  manifest.items[id] = {
    variants: {
      0: {
        path,
        rows: rows.length,
        latestTime: latest,
        hourlyRetentionDays: 60,
      },
    },
  };
  payloads[path] = { itemHrid: id, variant: 0, rows };
}
payloads["manifest.json"] = manifest;
payloads["api.json"] = {
  timestamp: latest,
  marketData: Object.fromEntries(
    Object.entries(snapshots.at(-1).prices).map(([id, q]) => [
      id,
      { 0: { a: q.ask, b: q.bid, v: q.volume, p: q.average } },
    ]),
  ),
};
const script = await readFile("mwi-profit-indices.user.js", "utf8");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1400, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.milkywayidle.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MWI Userscript Test</title><body style="background:#071019;color:#677b96;font-family:sans-serif"><h2>MWI 游戏页面 · 脚本集成测试</h2><p>使用真实公开行情测试样本；页面背景为测试容器。</p></body></html>',
    }),
  );
  await page.addInitScript(
    ({ payloads }) => {
      window.GM_getValue = (k, d) =>
        JSON.parse(localStorage.getItem("gm:" + k) || "null") ?? d;
      window.GM_setValue = (k, v) =>
        localStorage.setItem("gm:" + k, JSON.stringify(v));
      window.mockOffline = false;
      window.requests = 0;
      window.GM_xmlhttpRequest = (opts) => {
        window.requests++;
        setTimeout(() => {
          if (window.mockOffline) {
            opts.onerror();
            return;
          }
          const path = opts.url.includes("/items/")
            ? "items/" + opts.url.split("/").at(-1)
            : opts.url.split("/").at(-1);
          const d = payloads[path];
          opts.onload({
            status: d ? 200 : 404,
            responseText: JSON.stringify(d || {}),
          });
        }, 0);
      };
    },
    { payloads },
  );
  await page.goto("https://www.milkywayidle.com/game");
  await page.addScriptTag({ content: script });
  const launch = page.getByRole("button", { name: "◈ 利润指数" });
  assert.equal(await launch.count(), 1);
  assert.equal(await page.locator("section.panel").isVisible(), false);
  await launch.click();
  await page.getByText("行情与指数已更新。", { exact: true }).waitFor();
  assert.equal(await page.locator(".card").count(), 3);
  assert.equal(await page.locator(".chart svg").count(), 3);
  await page.getByRole("button", { name: "周线", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "周线", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "月线", exact: true }).click();
  assert.equal(await page.locator(".chart svg").count(), 3);
  await page.getByRole("button", { name: "采集", exact: true }).click();
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator(".card summary").click();
  assert.ok((await page.locator("tbody tr").count()) > 0);
  await page.getByRole("button", { name: "日线", exact: true }).click();
  await page.locator("svg g").first().focus();
  await page.keyboard.press("Enter");
  assert.match(await page.locator(".stats").innerText(), /开 .*高 .*低 .*收/);
  await page.getByRole("button", { name: "综合指数", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("section.panel").isVisible(), false);
  assert.equal(await launch.getAttribute("aria-expanded"), "false");
  await launch.click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator("section.panel").isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1400, height: 1100 });
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/indices-preview.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "mwi-profit-indices.json");
  // Fresh mount while offline must retain IndexedDB data and disclose degraded source status.
  await page.reload();
  await page.evaluate(() => (window.mockOffline = true));
  await page.addScriptTag({ content: script });
  await page.getByRole("button", { name: "◈ 利润指数" }).click();
  await page
    .getByText("行情已载入；部分请求使用缓存或存在数据提示。", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".chart svg").count(), 3);
  assert.ok((await page.locator(".warning").count()) > 0);
  // An unavailable provider in a fresh profile yields a retryable visible error, not fictional candles.
  const isolated = await browser.newContext();
  const empty = await isolated.newPage();
  await empty.route("**/*", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<body>Empty cache test</body>",
    }),
  );
  await empty.goto("https://www.milkywayidle.com/game");
  await empty.evaluate(() => {
    window.GM_getValue = (k, d) => d;
    window.GM_setValue = () => {};
    window.GM_xmlhttpRequest = (o) => setTimeout(() => o.onerror(), 0);
  });
  await empty.addScriptTag({ content: script });
  await empty.getByRole("button", { name: "◈ 利润指数" }).click();
  await empty.locator(".status.error").waitFor();
  assert.match(
    await empty.locator(".status.error").innerText(),
    /没有本地缓存/,
  );
  assert.equal(await empty.locator("svg").count(), 0);
  await isolated.close();
  assert.deepEqual(errors, []);
  console.log(
    "Browser PASS: mount, toggle, periods, constituents, keyboard, mobile, export, offline cache and retryable failure.",
  );
} finally {
  await browser.close();
}
