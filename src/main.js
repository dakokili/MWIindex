import data from "../data/milkonomy.json";
import css from "./style.css";
import { SKILLS, GROUPS, DEFAULT_OPTIONS } from "./model.js";
import { buildIndices, aggregate, dayKey, DAY } from "./indices.js";
import { storage, loadHistory } from "./transport.js";
import { renderChart, money } from "./chart.js";
import { selectionChange, signedPercent } from "./performance.js";

import { readPlayer } from "./player.js";
import { version as VERSION } from "../package.json";
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
    detailsOpen = false,
    options = { ...DEFAULT_OPTIONS };
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
  const subtitle = node(
    "p",
    { class: "muted" },
    "默认配装 · 最佳饮食 · 税后期望收益 / M每日（百万金币）",
  );
  title.append(
    node("p", { class: "eyebrow" }, "MILKY WAY IDLE · MARKET INDICES"),
    node("h1", {}, "银河生产 · 利润指数"),
    subtitle,
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
  const updateEquipment = button("更新装备数据", () =>
    refreshData(false, true, true),
  );
  updateEquipment.disabled = true;
  updateEquipment.title = "玩家模式下重新读取等级、装备、饮食和房屋等数据";
  const modeBtn = button("切换模式：默认配装", () =>
    refreshData(false, !options.profile, true),
  );
  const exportBtn = button("导出 JSON", () => {
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: VERSION,
            valueUnit: "coins/day",
            displayUnit: "M/day",
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
  toolbar.append(
    segments,
    rangeSelect,
    modeBtn,
    refresh,
    updateEquipment,
    exportBtn,
  );
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
      "固定最低行动等级 20、每日已观测成交量至少 10,000，不设价差或覆盖率门槛。每个行业最多 3 种，按日均利润选品；仅冲泡按利润排名 50% + 成交量排名 50% 选品。综合指数从所属行业入选品种中按日均利润取前 5 种，品种等权，不足时按实际数量。每天独立选品，再用同一篮子计算当天开高低收。",
    ),
  );
  settings.append(
    node(
      "p",
      { class: "muted" },
      "产物、精华、开箱收益按买一；原料和饮食按卖一（有金币商店价时取更低值）。卖出税率固定 4%。默认模式：100 级、80 级工具 +10、房屋 4 级、特殊装备 +10，逐样本选最佳饮食。玩家模式：使用当前角色等级、装备/房屋等增益及所选饮食，只纳入该技能基础等级可生产的品种，假定饮食持续补充。换装后点击“更新装备数据”。两种模式均含随机收入期望。",
    ),
  );
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
      "报价红涨绿跌（按前收比较）· 单击K线或选择区间查看涨跌与期末成分 · 北京时间分日，周一开周。成交量仅含已抓取小时，不外推完整日量。日均为观测样本均值。最近 60 天读取日内历史，更早的每日中位数不用于K线；本地可逐步积累 400 天。 ",
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
      "额外收入/日",
      options.profile ? "当前角色饮食" : "期末最佳饮食",
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
        money(m.rareIncome),
        m.diet.map((id) => data.items[id]?.zh || id).join("、") || "不喝饮品",
      ].entries())
        row.append(node("td", j === 4 ? { class: "diet" } : {}, t));
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    container.append(wrap);
  }
  function render() {
    cards.replaceChildren();
    info.textContent = "";
    if (!result) return;
    const allDates = Object.values(result.series)
      .flat()
      .map((b) => b.last);
    if (!allDates.length) {
      cards.append(
        node(
          "p",
          { class: "empty" },
          "行情已加载，但没有符合筛选规则且原料、产物及额外掉落报价完整的品种。请检查角色等级和数据源。",
        ),
      );
      return;
    }
    const latest = Math.max(...allDates),
      cutoff = dayKey(latest - (range - 1) * DAY);
    info.textContent = `行情日期 ${dayKey(result.first)} — ${dayKey(result.last)} · 有效指数截至 ${dayKey(latest)} · ${source?.snapshots.length || 0} 个行情时点 · 历史缺口不补价`;
    for (const key of view === "overview" ? Object.keys(GROUPS) : [view]) {
      const allBars = aggregate(result.series[key], period),
        bars = allBars.filter((b) => dayKey(b.last) >= cutoff),
        offset = allBars.indexOf(bars[0]),
        last = bars.at(-1),
        card = node("article", { class: "card" });
      const ch = node("div", { class: "card-head" });
      const quote = node("div", { class: "quote" }),
        value = node(
          "span",
          { class: "value flat", title: "所选周期末收盘利润指数" },
          "—",
        ),
        change = node("p", { class: "change flat", "aria-live": "polite" });
      quote.append(value, change);
      ch.append(node("h2", {}, GROUPS[key]?.name || SKILLS[key]), quote);
      card.append(ch);
      const stats = node("p", { class: "stats" }),
        chart = node("div", { class: "chart" }),
        detail = node("details"),
        summary = node("summary", {}, "成分与最佳饮食"),
        table = node("div");
      detail.append(summary, table);
      detail.open = detailsOpen;
      detail.addEventListener("toggle", () => {
        // Ignore queued events from replaced cards and synchronized siblings.
        if (!detail.isConnected || detail.open === detailsOpen) return;
        detailsOpen = detail.open;
        for (const other of cards.querySelectorAll(".card details"))
          other.open = detailsOpen;
      });
      function select(
        b,
        selection = {
          first: bars.length - 1,
          last: bars.length - 1,
          bars: [b],
        },
      ) {
        const performance = selectionChange(
          allBars,
          offset + selection.first,
          offset + selection.last,
        );
        const firstBar = selection.bars[0],
          label =
            selection.bars.length > 1
              ? `${firstBar.day} — ${dayKey(b.last)}`
              : `${b.day} ${period === "day" ? "日线" : period === "week" ? "周线" : "月线"}`;
        value.textContent = money(b.close) + " / 日";
        value.className = `value ${performance.direction}`;
        change.className = `change ${performance.direction}`;
        change.textContent =
          performance.delta === null
            ? `${label} · 涨跌 —（无前收）`
            : `${label} · ${performance.delta > 0 ? "+" : ""}${money(performance.delta)}（${signedPercent(performance.percent)}）${performance.percent === null ? " · 前收为零" : ""}`;
        change.title = performance.previous
          ? `相对 ${performance.previous.day} 的收盘 ${money(performance.previous.close)}；百分比以此前收绝对值为分母。历史缺口不补价，使用前一可用周期。`
          : "缺少所选首根之前的收盘数据，不使用开盘值代替。";
        stats.textContent = `${b.day} · 开 ${money(b.open)}  高 ${money(b.high)}  低 ${money(b.low)}  收 ${money(b.close)} · 日均 ${money(b.mean)} · ${b.samples} 个样本${dayKey(b.last) === dayKey(Date.now() / 1000) ? "（含今日未完成数据）" : ""}${b.days ? " / " + b.days + " 日" : ""}${b.samples === 1 ? "（单样本，无法观测日内波动）" : ""}`;
        if (selection.bars.length > 1) {
          const selected = selection.bars;
          stats.textContent = `${label} · ${selected.length} 根K线 · 开 ${money(firstBar.open)}  高 ${money(Math.max(...selected.map((x) => x.high)))}  低 ${money(Math.min(...selected.map((x) => x.low)))}  收 ${money(b.close)} · ${selected.reduce((sum, x) => sum + x.samples, 0)} 个样本 · 成分见期末日期`;
        }
        const endDay = dayKey(b.last);
        const members = b.members;
        summary.textContent = `${endDay} 成分与${options.profile ? "角色饮食" : "最佳饮食"}（${members.length} 种）`;
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
  async function refreshData(
    force,
    playerMode = !!options.profile,
    updatePlayer = false,
  ) {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    updateEquipment.disabled = true;
    modeBtn.disabled = true;
    status.className = "status";
    try {
      const nextOptions = {
        ...DEFAULT_OPTIONS,
        ...(playerMode
          ? { profile: updatePlayer ? readPlayer(data) : options.profile }
          : {}),
      };
      const nextSource = await loadHistory(data, nextOptions, {
        cache,
        force,
        progress: (t) => (status.textContent = t),
      });
      status.textContent = playerMode
        ? "正在按当前角色配置重算每日成分…"
        : "正在计算最佳饮食和每日成分…";
      const nextResult = await buildIndices(
        data,
        nextSource.snapshots,
        nextOptions,
        (n, total) => (status.textContent = `计算指数 ${n}/${total} 天`),
        () => new Promise((r) => setTimeout(r, 0)),
      );
      options = nextOptions;
      source = nextSource;
      result = nextResult;
      modeBtn.textContent = `切换模式：${options.profile ? "当前玩家" : "默认配装"}`;
      subtitle.textContent = options.profile
        ? `${options.profile.name} · 当前配装与饮食 · M每日（百万金币）· 配置读取 ${new Date(options.profile.capturedAt).toLocaleTimeString()}，历史按此配置回算`
        : "默认配装 · 最佳饮食 · 税后期望收益 / M每日（百万金币）";
      status.textContent = source.warnings.length
        ? "行情已载入；部分请求使用缓存或存在数据提示。"
        : "行情与指数已更新。";
      warnings.replaceChildren();
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
      status.textContent = `更新失败：${e.message}${result ? " 保留上次模式与结果。" : ""} 请重试。`;
    } finally {
      busy = false;
      refresh.disabled = false;
      updateEquipment.disabled = !options.profile;
      modeBtn.disabled = false;
    }
  }
}
if (typeof document !== "undefined") {
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}
