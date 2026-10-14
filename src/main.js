import data from "../data/milkonomy.json";
import css from "./style.css";
import { SKILLS, GROUPS, DEFAULT_OPTIONS } from "./model.js";
import { buildIndices, aggregate, dayKey, DAY } from "./indices.js";
import { storage, loadHistory } from "./transport.js";
import { renderChart, money } from "./chart.js";

const VERSION = "1.0.0";
function node(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(text, fn, attrs = {}) {
  const e = node("button", { type: "button", ...attrs }, text);
  e.addEventListener("click", fn);
  return e;
}
function safeOptions() {
  try {
    const o = GM_getValue("options", {});
    return {
      ...DEFAULT_OPTIONS,
      ...Object.fromEntries(
        Object.keys(DEFAULT_OPTIONS)
          .filter((k) => typeof o[k] === typeof DEFAULT_OPTIONS[k])
          .map((k) => [k, o[k]]),
      ),
    };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}
export function mount() {
  if (document.getElementById("mwi-profit-index-host")) return;
  const host = node("div", { id: "mwi-profit-index-host" });
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(node("style", {}, css));
  const cache = storage();
  let result = null,
    source = null,
    busy = false,
    period = "day",
    view = "overview",
    range = 60,
    options = safeOptions();
  const panel = node("section", {
    class: "panel",
    hidden: "",
    role: "dialog",
    "aria-label": "MWI 利润指数",
  });
  const launch = button("◈ 利润指数", toggle, {
    class: "launch",
    "aria-expanded": "false",
    "aria-controls": "mwi-indices-panel",
  });
  panel.id = "mwi-indices-panel";
  shadow.append(launch, panel);
  const header = node("header");
  const title = node("div");
  title.append(
    node("p", { class: "eyebrow" }, "MILKY WAY IDLE · MARKET INDICES"),
    node("h1", {}, "银河生产 · 利润指数"),
    node(
      "p",
      { class: "muted" },
      "默认配装 · 最佳饮食 · 税后期望收益 / 金币每日",
    ),
  );
  header.append(
    title,
    button("×", toggle, { class: "close", "aria-label": "收起利润指数" }),
  );
  panel.append(header);
  const toolbar = node("div", { class: "toolbar" }),
    segments = node("div", { class: "segmented", "aria-label": "K线周期" });
  for (const [key, label] of [
    ["day", "日线"],
    ["week", "周线"],
    ["month", "月线"],
  ])
    segments.append(
      button(
        label,
        () => {
          period = key;
          syncButtons();
          render();
        },
        { "data-period": key, "aria-pressed": String(period === key) },
      ),
    );
  const rangeSelect = node("select", { "aria-label": "显示时间范围" });
  for (const n of [30, 60, 180, 400])
    rangeSelect.append(node("option", { value: n }, `${n} 天`));
  rangeSelect.value = String(range);
  rangeSelect.addEventListener("change", () => {
    range = +rangeSelect.value;
    render();
  });
  const refresh = button("刷新行情", () => refreshData(true));
  const exportBtn = button("导出 JSON", () => {
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: VERSION,
            ...result,
            dataSource: source?.manifestTime,
            warnings: source?.warnings,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = node("a", { href: url, download: "mwi-profit-indices.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  toolbar.append(segments, rangeSelect, refresh, exportBtn);
  panel.append(toolbar);
  const tabs = node("div", { class: "tabs" });
  for (const [k, label] of [
    ["overview", "综合指数"],
    ...Object.entries(SKILLS),
  ])
    tabs.append(
      button(
        label,
        () => {
          view = k;
          syncButtons();
          render();
        },
        { "data-view": k, "aria-pressed": String(k === view) },
      ),
    );
  panel.append(tabs);
  const settings = node("details", { class: "settings" });
  settings.append(node("summary", {}, "选品规则与计算口径"));
  settings.append(
    node(
      "p",
      { class: "muted" },
      "每个技能最多 5 种；综合评分 = 利润排名 50% + 已观测成交量排名 25% + 双边报价质量排名 25%。综合指数对所属技能等权。每天独立选品，再用同一篮子计算当天开高低收。",
    ),
  );
  settings.append(
    node(
      "p",
      { class: "muted" },
      "产物、精华、开箱收益按买一；原料和饮食按卖一（有金币商店价时取更低值）。100 级角色、80 级工具 +10、房屋 4 级，默认特殊装备 +10。税后含随机收入期望，逐样本选最赚钱的合法三槽饮品组合。",
    ),
  );
  const fields = node("div", { class: "fields" }),
    inputs = {};
  for (const [key, label, min, max, step] of [
    ["minLevel", "最低行动等级", 1, 100, 1],
    ["minVolume", "每日已观测成交量 ≥", 0, 1e9, 100],
    ["maxSpread", "最大相对价差", 0.01, 1, 0.01],
    ["minCoverage", "双边报价覆盖率 ≥", 0.1, 1, 0.05],
    ["tax", "卖出税率", 0, 0.5, 0.01],
  ]) {
    const l = node("label", {}, label),
      i = node("input", {
        type: "number",
        required: "",
        min,
        max,
        step,
        "aria-label": label,
      });
    i.value = String(options[key]);
    inputs[key] = i;
    l.append(i);
    fields.append(l);
  }
  settings.append(fields);
  const volumeLabel = node("label");
  const volumeCheck = node("input", { type: "checkbox" });
  volumeCheck.checked = options.requireVolume;
  volumeLabel.append(
    volumeCheck,
    document.createTextNode("必须有真实成交量（关闭后允许仅报价样本）"),
  );
  settings.append(volumeLabel);
  const apply = button("应用并重新计算", async () => {
    for (const [key, i] of Object.entries(inputs)) {
      if (!i.checkValidity() || !Number.isFinite(+i.value)) {
        i.reportValidity();
        return;
      }
      options[key] = +i.value;
    }
    options.requireVolume = volumeCheck.checked;
    GM_setValue("options", options);
    await refreshData(false);
  });
  settings.append(document.createTextNode(" "), apply);
  settings.append(
    node(
      "p",
      { class: "muted" },
      `规则快照：${data.source.gameVersion} / Milkonomy ${data.source.commit.slice(0, 8)}。旧行情统一按此规则回算；并非当时角色实际收益。金币开箱估值税口径沿用 Milkonomy。`,
    ),
  );
  panel.append(settings);
  const status = node(
    "p",
    { class: "status", role: "status", "aria-live": "polite" },
    "展开后加载公开行情；首次约 160 个小分片，随后使用本地缓存。",
  );
  const warnings = node("div"),
    info = node("p", { class: "source-info muted" }),
    cards = node("div", { class: "cards" });
  panel.append(status, warnings, info, cards);
  const footer = node("footer");
  footer.append(
    document.createTextNode(
      "红涨绿跌 · 点击K线查看当日/期末成分 · 北京时间分日，周一开周。成交量仅含已抓取小时，不外推完整日量。日均为观测样本均值。最近 60 天读取日内历史，更早的每日中位数不用于K线；本地可逐步积累 400 天。 ",
    ),
  );
  footer.append(
    node(
      "a",
      {
        href: "https://github.com/Iceking233/mwi-market-data",
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "历史数据源",
    ),
    document.createTextNode(" · "),
    node(
      "a",
      {
        href: "https://www.milkonomy.top/",
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "Milkonomy",
    ),
  );
  panel.append(footer);
  function syncButtons() {
    for (const b of shadow.querySelectorAll("[data-period]"))
      b.setAttribute("aria-pressed", String(b.dataset.period === period));
    for (const b of shadow.querySelectorAll("[data-view]"))
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
  function toggle() {
    panel.hidden = !panel.hidden;
    launch.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      panel.querySelector(".close").focus();
      if (!result && !busy) refreshData(false);
    } else launch.focus();
  }
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!panel.hidden) toggle();
    }
  });
  function detailsTable(container, members) {
    container.replaceChildren();
    const wrap = node("div", { class: "table-scroll" }),
      table = node("table");
    const tr = node("tr");
    for (const t of [
      "成分商品",
      "日均利润",
      "已观测量",
      "平均价差",
      "额外收入/日",
      "期末最佳饮食",
    ])
      tr.append(node("th", {}, t));
    const head = node("thead");
    head.append(tr);
    table.append(head);
    const body = node("tbody");
    for (const m of members) {
      const row = node("tr");
      for (const [j, t] of [
        data.items[m.main]?.zh || m.main,
        money(m.profit),
        m.volume === null
          ? "无成交量"
          : Math.round(m.volume).toLocaleString("zh-CN"),
        (m.spread * 100).toFixed(1) + "%",
        money(m.rareIncome),
        m.diet.map((id) => data.items[id]?.zh || id).join("、") || "不喝饮品",
      ].entries())
        row.append(node("td", j === 5 ? { class: "diet" } : {}, t));
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    container.append(wrap);
  }
  function render() {
    cards.replaceChildren();
    if (!result) return;
    const allDates = Object.values(result.series)
      .flat()
      .map((b) => b.last);
    if (!allDates.length) {
      cards.append(
        node(
          "p",
          { class: "empty" },
          "行情已加载，但没有符合筛选规则且原料、产物及额外掉落报价完整的品种。请调整筛选或检查数据源。",
        ),
      );
      return;
    }
    const latest = Math.max(...allDates),
      cutoff = dayKey(latest - (range - 1) * DAY);
    info.textContent = `行情日期 ${dayKey(result.first)} — ${dayKey(result.last)} · 有效指数截至 ${dayKey(latest)} · ${source?.snapshots.length || 0} 个行情时点 · 历史缺口不补价`;
    for (const key of view === "overview" ? Object.keys(GROUPS) : [view]) {
      const bars = aggregate(
          result.series[key].filter((b) => b.day >= cutoff),
          period,
        ),
        last = bars.at(-1),
        card = node("article", { class: "card" });
      const ch = node("div", { class: "card-head" });
      ch.append(
        node("h2", {}, GROUPS[key]?.name || SKILLS[key]),
        node(
          "span",
          { class: "value" },
          last ? money(last.mean) + " / 日" : "—",
        ),
      );
      card.append(ch);
      const stats = node("p", { class: "stats" }),
        chart = node("div", { class: "chart" }),
        detail = node("details"),
        summary = node("summary", {}, "成分与最佳饮食"),
        table = node("div");
      detail.append(summary, table);
      function select(b) {
        ch.querySelector(".value").textContent = money(b.mean) + " / 日";
        stats.textContent = `${b.day} · 开 ${money(b.open)}  高 ${money(b.high)}  低 ${money(b.low)}  收 ${money(b.close)} · 日均 ${money(b.mean)} · ${b.samples} 个样本${dayKey(b.last) === dayKey(Date.now() / 1000) ? "（含今日未完成数据）" : ""}${b.days ? " / " + b.days + " 日" : ""}${b.samples === 1 ? "（单样本，无法观测日内波动）" : ""}`;
        const endDay = dayKey(b.last);
        const members = GROUPS[key]
          ? GROUPS[key].skills.flatMap(
              (s) =>
                result.series[s].find((x) => x.day === endDay)?.members || [],
            )
          : b.members;
        summary.textContent = `${endDay} 成分与最佳饮食（${members.length} 种）`;
        detailsTable(table, members);
      }
      card.append(stats, chart, detail);
      renderChart(chart, bars, select, period);
      if (last) select(last);
      if (last && result.last - last.last > DAY)
        card.append(
          node(
            "p",
            { class: "warning" },
            "此指数最新有效数据早于最新行情；后续样本未通过完整性或流动性筛选。",
          ),
        );
      cards.append(card);
    }
  }
  async function refreshData(force) {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    apply.disabled = true;
    status.className = "status";
    warnings.replaceChildren();
    try {
      source = await loadHistory(data, options, {
        cache,
        force,
        progress: (t) => (status.textContent = t),
      });
      status.textContent = "正在计算最佳饮食和每日成分…";
      result = await buildIndices(
        data,
        source.snapshots,
        options,
        (n, total) => (status.textContent = `计算指数 ${n}/${total} 天`),
        () => new Promise((r) => setTimeout(r, 0)),
      );
      status.textContent = source.warnings.length
        ? "行情已载入；部分请求使用缓存或存在数据提示。"
        : "行情与指数已更新。";
      if (source.warnings.length) {
        const box = node("details", { class: "warning" });
        box.append(
          node(
            "summary",
            {},
            `${source.warnings.length} 条数据提示（点击展开）`,
          ),
        );
        for (const w of source.warnings) box.append(node("p", {}, w));
        warnings.append(box);
      }
      render();
    } catch (e) {
      status.className = "status error";
      status.textContent = `加载失败：${e.message} 点击“刷新行情”重试。`;
    } finally {
      busy = false;
      refresh.disabled = false;
      apply.disabled = false;
    }
  }
}
if (typeof document !== "undefined") {
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}
