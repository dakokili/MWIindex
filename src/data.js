import { compileModel, DEFAULT_OPTIONS } from "./model.js";
import { DAY } from "./indices.js";
export const HISTORY_BASE =
  "https://raw.githubusercontent.com/Iceking233/mwi-market-data/main/docs/history/official/";
export const CURRENT_URL =
  "https://raw.githubusercontent.com/Iceking233/mwi-market-data/main/docs/market/api.json";
export const MANIFEST_URL = HISTORY_BASE + "manifest.json";
export function requiredItems(data, options = DEFAULT_OPTIONS) {
  return [
    ...new Set(
      compileModel(data, options).flatMap((m) => [
        m.main,
        ...m.variants.flatMap((v) =>
          [...v.inputs, ...v.outputs].map((x) => x.id),
        ),
      ]),
    ),
  ].filter((id) => id !== "/items/coin");
}
const numberOrNull = (x) =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
export function normalizeCurrent(payload, needed) {
  if (
    !Number.isFinite(payload?.timestamp) ||
    payload.timestamp <= 0 ||
    !payload.marketData
  )
    throw new Error("市场快照格式不符");
  const prices = {};
  for (const id of needed) {
    const q = payload.marketData[id]?.["0"];
    if (q)
      prices[id] = {
        ask: numberOrNull(q.a),
        bid: numberOrNull(q.b),
        average: numberOrNull(q.p),
        volume: numberOrNull(q.v),
      };
  }
  return { time: payload.timestamp, prices };
}
export function validateManifest(manifest) {
  if (
    manifest?.version !== 1 ||
    !manifest.items ||
    !Number.isFinite(manifest.latestSnapshot?.timestamp)
  )
    throw new Error("历史目录格式不符");
  return manifest;
}
export function shardUrl(path) {
  // Only reviewed public JSON endpoints; reject remote URL/path injection.
  if (!/^items\/items_[a-zA-Z0-9_]+__0\.json$/.test(path))
    throw new Error("历史分片路径不合法");
  return HISTORY_BASE + path;
}
export function normalizeShards(shards, manifest, days = 60) {
  validateManifest(manifest);
  const snapshots = new Map();
  for (const shard of shards) {
    if (
      !Array.isArray(shard?.rows) ||
      Number(shard.variant) !== 0 ||
      !manifest.items[shard.itemHrid]
    )
      throw new Error("历史分片格式不符");
    const entry = manifest.items[shard.itemHrid].variants?.["0"];
    // Compaction runs against snapshot timestamp; old median rows are deliberately excluded.
    const retention = Math.min(
      days,
      entry?.hourlyRetentionDays ?? shard.hourlyRetentionDays ?? 60,
    );
    const cutoff = manifest.latestSnapshot.timestamp - retention * DAY;
    const seen = new Set();
    for (const r of shard.rows) {
      if (
        !Number.isFinite(r.time) ||
        r.time < cutoff ||
        r.time > manifest.latestSnapshot.timestamp ||
        seen.has(r.time)
      )
        continue;
      seen.add(r.time);
      if (!snapshots.has(r.time))
        snapshots.set(r.time, { time: r.time, prices: {} });
      snapshots.get(r.time).prices[shard.itemHrid] = {
        ask: numberOrNull(r.a),
        bid: numberOrNull(r.b),
        average: numberOrNull(r.p),
        volume: numberOrNull(r.v),
      };
    }
  }
  return [...snapshots.values()].sort((a, b) => a.time - b.time);
}
export function mergeSnapshots(...lists) {
  const map = new Map();
  for (const s of lists.flat()) {
    if (!Number.isFinite(s.time) || !s.prices) continue;
    map.set(s.time, {
      time: s.time,
      prices: { ...map.get(s.time)?.prices, ...s.prices },
    });
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}
export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i], i);
      }
    }),
  );
  return out;
}
