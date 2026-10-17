import test from "node:test";
import assert from "node:assert/strict";
import data from "../data/milkonomy.json" with { type: "json" };
import {
  requiredItems,
  MANIFEST_URL,
  CURRENT_URL,
  shardUrl,
} from "../src/data.js";
import {
  loadHistory,
  HISTORY_CHECK_INTERVAL,
  CURRENT_CHECK_INTERVAL,
} from "../src/transport.js";

const now = 1791864360000;
const items = requiredItems(data);
function setup(t) {
  const records = new Map(),
    requests = [],
    payloads = new Map();
  const manifest = {
    version: 1,
    latestSnapshot: { timestamp: now / 1000 },
    items: {},
  };
  for (const id of items) {
    const path = `items/items_${id.split("/").at(-1)}__0.json`;
    manifest.items[id] = {
      variants: {
        0: { path, latestTime: now / 1000, rows: 1, hourlyRetentionDays: 60 },
      },
    };
    payloads.set(shardUrl(path), {
      itemHrid: id,
      variant: 0,
      rows: [{ time: now / 1000, a: 10, b: 9, v: 100 }],
    });
  }
  payloads.set(MANIFEST_URL, manifest);
  payloads.set(CURRENT_URL, {
    timestamp: now / 1000,
    marketData: Object.fromEntries(
      items.map((id) => [id, { 0: { a: 12, b: 11, v: 200 } }]),
    ),
  });
  const previous = globalThis.GM_xmlhttpRequest;
  globalThis.GM_xmlhttpRequest = (o) => {
    requests.push(o.url);
    queueMicrotask(() =>
      o.onload({
        status: payloads.has(o.url) ? 200 : 503,
        responseText: JSON.stringify(payloads.get(o.url)),
      }),
    );
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.GM_xmlhttpRequest;
    else globalThis.GM_xmlhttpRequest = previous;
  });
  const cache = {
    get: async (key) => structuredClone(records.get(key)),
    set: async (key, value) => {
      records.set(key, structuredClone(value));
    },
  };
  const load = (opts = {}) =>
    loadHistory(data, undefined, { cache, now, ...opts });
  return { records, requests, payloads, manifest, cache, load };
}

test("cold load persists data; reopening within five minutes sends zero requests", async (t) => {
  const { load, requests, records } = setup(t);
  const initial = await load();
  assert.equal(requests.length, items.length + 2);
  assert.equal(records.get("manifest").checkedAt, now);
  requests.length = 0;
  const reopened = await load({ now: now + 1000 });
  assert.deepEqual(reopened.snapshots, initial.snapshots);
  assert.deepEqual(reopened.warnings, []);
  assert.deepEqual(requests, []);
});

test("latest quote expires independently without downloading any history", async (t) => {
  const { load, requests, payloads } = setup(t);
  await load();
  payloads.get(CURRENT_URL).timestamp += 300;
  requests.length = 0;
  const result = await load({ now: now + CURRENT_CHECK_INTERVAL });
  assert.deepEqual(requests, [CURRENT_URL]);
  assert.equal(result.snapshots.at(-1).time, now / 1000 + 300);
});

for (const force of [false, true]) {
  test(`${force ? "manual" : "expired history"} refresh fetches only changed shards and merges new rows`, async (t) => {
    const { load, requests, manifest, payloads } = setup(t);
    await load();
    const id = items[0],
      entry = manifest.items[id].variants[0];
    entry.latestTime += 3600;
    entry.rows++;
    manifest.latestSnapshot.timestamp += 3600;
    const url = shardUrl(entry.path);
    payloads
      .get(url)
      .rows.push({ time: entry.latestTime, a: 20, b: 19, v: 300 });
    requests.length = 0;
    const result = await load({
      force,
      now: now + (force ? 1000 : HISTORY_CHECK_INTERVAL),
    });
    assert.deepEqual(requests, [MANIFEST_URL, url, CURRENT_URL]);
    assert.equal(result.snapshots.at(-1).prices[id].ask, 20);
    assert.equal(result.snapshots[0].prices[id].ask, 12);
    requests.length = 0;
    await load({ force: true, now: now + HISTORY_CHECK_INTERVAL + 1000 });
    assert.deepEqual(requests, [MANIFEST_URL, CURRENT_URL]);
  });
}

test("legacy v1 cache is reused on upgrade without downloading unchanged history", async (t) => {
  const { load, requests, records } = setup(t);
  await load();
  delete records.get("manifest").checkedAt;
  records.delete("current");
  for (const id of items) {
    delete records.get("shard:" + id).path;
    delete records.get("shard:" + id).retention;
  }
  requests.length = 0;
  await load();
  assert.deepEqual(requests, [MANIFEST_URL, CURRENT_URL]);
});

test("missing and corrupt shards are repaired even while the manifest is fresh", async (t) => {
  const { load, requests, records, manifest } = setup(t);
  await load();
  records.delete("shard:" + items[0]);
  records.get("shard:" + items[1]).data = { rows: [] };
  requests.length = 0;
  const result = await load();
  assert.deepEqual(
    new Set(requests),
    new Set(
      items
        .slice(0, 2)
        .map((id) => shardUrl(manifest.items[id].variants[0].path)),
    ),
  );
  assert.deepEqual(result.warnings, []);
});

test("offline refresh retains history and never advances successful check times", async (t) => {
  const { load, requests, records, payloads } = setup(t);
  const initial = await load();
  payloads.clear();
  requests.length = 0;
  const result = await load({ force: true, now: now + HISTORY_CHECK_INTERVAL });
  assert.deepEqual(result.snapshots, initial.snapshots);
  assert.equal(result.warnings.length, 2);
  assert.equal(records.get("manifest").checkedAt, now);
  assert.equal(records.get("current").checkedAt, now);
  assert.deepEqual(requests, [
    MANIFEST_URL,
    MANIFEST_URL,
    CURRENT_URL,
    CURRENT_URL,
  ]);
});

test("failed shard remains eligible for retry after manifest was cached", async (t) => {
  const { load, requests, payloads, manifest } = setup(t);
  await load();
  const entry = manifest.items[items[0]].variants[0],
    url = shardUrl(entry.path),
    payload = payloads.get(url);
  entry.rows++;
  payloads.delete(url);
  const failed = await load({ force: true });
  assert.ok(failed.warnings.some((w) => w.includes("下载失败")));
  payloads.set(url, payload);
  requests.length = 0;
  await load();
  assert.deepEqual(requests, [url]);
});

test("unwritable storage still loads quotes and explains why caching is unavailable", async (t) => {
  const { load } = setup(t);
  const result = await load({
    cache: {
      get: async () => undefined,
      set: async () => {
        throw new Error("QuotaExceededError");
      },
    },
  });
  assert.ok(result.snapshots.length);
  assert.deepEqual(result.warnings, ["本地缓存不可写；本次数据仍可显示"]);
});

test("invalid cache entries and a backwards clock trigger revalidation", async (t) => {
  const { load, records, requests } = setup(t);
  await load();
  records.set("manifest", { version: 0, checkedAt: now });
  records.set("current", { checkedAt: now, data: {} });
  requests.length = 0;
  await load();
  assert.deepEqual(requests, [MANIFEST_URL, CURRENT_URL]);
  requests.length = 0;
  await load({ now: now - 1000 });
  assert.deepEqual(requests, [MANIFEST_URL, CURRENT_URL]);
});
