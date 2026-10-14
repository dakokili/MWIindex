import {
  CURRENT_URL,
  MANIFEST_URL,
  requiredItems,
  validateManifest,
  shardUrl,
  normalizeShards,
  normalizeCurrent,
  mergeSnapshots,
  mapLimit,
} from "./data.js";
import { DAY } from "./indices.js";
const CACHE_VERSION = 1;
function request(url, attempt = 0) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url,
      anonymous: true,
      timeout: 25000,
      responseType: "text",
      onload: (r) => {
        if (r.status >= 200 && r.status < 300) {
          try {
            resolve(JSON.parse(r.responseText));
          } catch {
            reject(new Error("数据不是有效 JSON"));
          }
        } else reject(new Error(`HTTP ${r.status}`));
      },
      onerror: () => reject(new Error("网络连接失败")),
      ontimeout: () => reject(new Error("请求超时")),
    });
  }).catch(async (e) => {
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 600));
      return request(url, attempt + 1);
    }
    throw e;
  });
}
export function storage() {
  let opening;
  async function db() {
    if (!opening)
      opening = new Promise((resolve, reject) => {
        const r = indexedDB.open("mwi-profit-indices", CACHE_VERSION);
        r.onupgradeneeded = () => r.result.createObjectStore("cache");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    return opening;
  }
  return {
    async get(key) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const r = d.transaction("cache").objectStore("cache").get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async set(key, value) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const t = d.transaction("cache", "readwrite");
        t.objectStore("cache").put(value, key);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },
  };
}
export async function loadHistory(
  data,
  options,
  { cache, progress = () => {}, force = false, now = Date.now() } = {},
) {
  const warnings = [];
  const safeGet = async (key) => {
    try {
      return await cache?.get(key);
    } catch {
      return undefined;
    }
  };
  const safeSet = async (key, value) => {
    try {
      await cache?.set(key, value);
    } catch {
      warnings.push("本地缓存不可写；本次数据仍可显示");
    }
  };
  const previous = (await safeGet("snapshots")) || [];
  let manifest;
  try {
    manifest = validateManifest(await request(MANIFEST_URL));
    await safeSet("manifest", manifest);
  } catch (e) {
    manifest = await safeGet("manifest");
    warnings.push(`历史目录更新失败：${e.message}`);
    if (!manifest) {
      if (previous.length)
        return { snapshots: previous, warnings, offline: true };
      throw new Error("历史数据源不可用，且没有本地缓存。请稍后重试。");
    }
  }
  const needed = requiredItems(data, options);
  let done = 0;
  const shards = await mapLimit(needed, 4, async (id) => {
    const entry = manifest.items[id]?.variants?.["0"];
    if (!entry) {
      warnings.push(`历史缺少 ${data.items[id]?.zh || id}`);
      return null;
    }
    const key = "shard:" + id,
      cached = await safeGet(key);
    if (
      !force &&
      cached?.updated === entry.latestTime &&
      cached?.rows === entry.rows
    ) {
      progress(`读取行情 ${++done}/${needed.length}`);
      return cached.data;
    }
    try {
      const payload = await request(shardUrl(entry.path));
      if (
        payload.itemHrid !== id ||
        Number(payload.variant) !== 0 ||
        !Array.isArray(payload.rows)
      )
        throw new Error("返回物品不匹配");
      // Keep only raw rows in the per-item cache; accumulated raw snapshots are stored separately.
      const cutoff =
        manifest.latestSnapshot.timestamp -
        (entry.hourlyRetentionDays ?? 60) * DAY;
      const trimmed = {
        ...payload,
        rows: payload.rows.filter((r) => r.time >= cutoff),
      };
      await safeSet(key, {
        updated: entry.latestTime,
        rows: entry.rows,
        data: trimmed,
      });
      return trimmed;
    } catch (e) {
      warnings.push(`${data.items[id]?.zh || id} 下载失败：${e.message}`);
      return cached?.data || null;
    } finally {
      progress(`下载行情 ${++done}/${needed.length}`);
    }
  });
  let snapshots = normalizeShards(shards.filter(Boolean), manifest);
  try {
    snapshots = mergeSnapshots(snapshots, [
      normalizeCurrent(await request(CURRENT_URL), needed),
    ]);
  } catch (e) {
    warnings.push(`最新快照读取失败：${e.message}`);
  }
  snapshots = mergeSnapshots(previous, snapshots).filter(
    (s) =>
      s.time >=
      Math.max(manifest.latestSnapshot.timestamp, now / 1000) - 400 * DAY,
  );
  if (!snapshots.length)
    throw new Error(
      "没有可用的日内行情。上游只有每日中位数时不会生成虚假 K 线。",
    );
  await safeSet("snapshots", snapshots);
  const last = snapshots.at(-1).time;
  if (now / 1000 - last > 12 * 3600)
    warnings.push("最新行情超过 12 小时未更新，请注意数据日期");
  return {
    snapshots,
    warnings: [...new Set(warnings)],
    manifestTime: manifest.latestSnapshot.timestamp,
  };
}
