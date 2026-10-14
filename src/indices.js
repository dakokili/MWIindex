import {
  SKILLS,
  GROUPS,
  DEFAULT_OPTIONS,
  compileModel,
  bestProfit,
  mean,
} from "./model.js";
export const DAY = 86400;
// All buckets use Asia/Shanghai (fixed UTC+8); Monday starts a week.
export function dayKey(time) {
  return new Date((time + 28800) * 1000).toISOString().slice(0, 10);
}
export function periodKey(day, period) {
  if (period === "month") return day.slice(0, 7) + "-01";
  if (period === "week") {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}
export function candle(day, points, members = []) {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  if (!sorted.length) return null;
  const values = sorted.map((p) => p.value);
  return {
    day,
    open: values[0],
    high: Math.max(...values),
    low: Math.min(...values),
    close: values.at(-1),
    mean: mean(values),
    samples: values.length,
    first: sorted[0].time,
    last: sorted.at(-1).time,
    members,
  };
}
export function aggregate(bars, period) {
  if (period === "day") return bars;
  const groups = new Map();
  for (const b of bars) {
    const key = periodKey(b.day, period);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  return [...groups].map(([day, bs]) => ({
    day,
    open: bs[0].open,
    close: bs.at(-1).close,
    high: Math.max(...bs.map((b) => b.high)),
    low: Math.min(...bs.map((b) => b.low)),
    mean: mean(bs.map((b) => b.mean)),
    samples: bs.reduce((s, b) => s + b.samples, 0),
    days: bs.length,
    first: bs[0].first,
    last: bs.at(-1).last,
    members: bs.at(-1).members,
  }));
}
function ranks(rows, value) {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  const result = new Map();
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && value(sorted[j + 1]) === value(sorted[i]))
      j++;
    const score =
      sorted.length === 1 ? 1 : 1 - (i + j) / 2 / (sorted.length - 1);
    for (let k = i; k <= j; k++) result.set(sorted[k], score);
    i = j;
  }
  return result;
}
export function selectMembers(models, snapshots, options = DEFAULT_OPTIONS) {
  const rows = [];
  for (const model of models) {
    const quotes = snapshots.map((s) => s.prices[model.main]);
    const volumes = quotes
      .map((q) => q?.volume)
      .filter((v) => Number.isFinite(v) && v >= 0);
    const volume = volumes.reduce((sum, v) => sum + v, 0);
    if (!volumes.length || volume < DEFAULT_OPTIONS.minVolume) continue;
    const results = snapshots.map((s) => bestProfit(model, s));
    const valid = results.filter(Boolean);
    if (!valid.length) continue;
    rows.push({
      id: model.action.id,
      main: model.main,
      skill: model.action.skill,
      profit: mean(valid.map((r) => r.profit)),
      volume,
      results,
    });
  }
  const p = ranks(rows, (r) => r.profit),
    v = ranks(rows, (r) => (r.volume === null ? 0 : r.volume));
  return rows
    .map((r) => ({
      ...r,
      score: 0.5 * p.get(r) + 0.5 * v.get(r),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.profit - a.profit || a.id.localeCompare(b.id),
    )
    .slice(0, options.top);
}
export async function buildIndices(
  data,
  snapshots,
  options = DEFAULT_OPTIONS,
  onProgress = () => {},
  yieldTask = () => Promise.resolve(),
) {
  const model = compileModel(data, options),
    series = Object.fromEntries(
      [...Object.keys(SKILLS), ...Object.keys(GROUPS)].map((k) => [k, []]),
    );
  const byDay = new Map();
  for (const s of [...new Map(snapshots.map((s) => [s.time, s])).values()].sort(
    (a, b) => a.time - b.time,
  )) {
    const day = dayKey(s.time);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(s);
  }
  let done = 0;
  for (const [day, ss] of byDay) {
    const points = {};
    for (const skill of Object.keys(SKILLS)) {
      const members = selectMembers(
        model.filter((m) => m.action.skill === skill),
        ss,
        options,
      );
      points[skill] = ss.map((s, i) => ({
        time: s.time,
        value:
          members.length && members.every((m) => m.results[i])
            ? mean(members.map((m) => m.results[i].profit))
            : null,
      }));
      const details = members.map(({ results, ...m }) => ({
        ...m,
        diet: results.filter(Boolean).at(-1)?.teaIds || [],
        rareIncome: mean(results.filter(Boolean).map((r) => r.rareIncome)),
      }));
      const c = candle(
        day,
        points[skill].filter((p) => p.value !== null),
        details,
      );
      if (c) series[skill].push(c);
    }
    for (const [key, group] of Object.entries(GROUPS)) {
      const ps = ss.map((s, i) => ({
        time: s.time,
        value: group.skills.every((k) => points[k][i].value !== null)
          ? mean(group.skills.map((k) => points[k][i].value))
          : null,
      }));
      const c = candle(
        day,
        ps.filter((p) => p.value !== null),
      );
      if (c) series[key].push(c);
    }
    if (++done % 4 === 0) {
      onProgress(done, byDay.size);
      await yieldTask();
    }
  }
  return {
    series,
    options,
    source: data.source,
    first: snapshots.length ? Math.min(...snapshots.map((s) => s.time)) : null,
    last: snapshots.length ? Math.max(...snapshots.map((s) => s.time)) : null,
  };
}
