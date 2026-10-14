export const money = (n) =>
  Number.isFinite(n) ? (n / 1e6).toFixed(2) + "M" : "—";
const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}
export function renderChart(container, bars, onSelect, period = "day") {
  container.replaceChildren();
  if (!bars.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      "暂无符合筛选条件的数据。最低行动等级 20、日成交量至少 10,000；请检查角色等级和数据源状态。";
    container.append(p);
    return;
  }
  const controls = document.createElement("div");
  controls.className = "chart-controls";
  const rangeButton = document.createElement("button");
  rangeButton.type = "button";
  rangeButton.textContent = "选取区间";
  rangeButton.setAttribute("aria-pressed", "false");
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.textContent = "全部范围";
  const hint = document.createElement("span");
  hint.className = "muted";
  hint.textContent = "单击选单根；Shift + 单击选区间";
  controls.append(rangeButton, allButton, hint);
  container.append(controls);
  let anchor = bars.length - 1,
    rangeStart = null,
    pickingRange = false;
  const groups = [];
  function notifySelection(start, end) {
    const first = Math.min(start, end),
      last = Math.max(start, end);
    groups.forEach((g, i) =>
      g.setAttribute("aria-pressed", String(i >= first && i <= last)),
    );
    onSelect(bars[last], { first, last, bars: bars.slice(first, last + 1) });
  }
  function endRange() {
    pickingRange = false;
    rangeStart = null;
    rangeButton.textContent = "选取区间";
    rangeButton.setAttribute("aria-pressed", "false");
  }
  function choose(index, extend = false) {
    if (pickingRange) {
      if (rangeStart === null) {
        rangeStart = index;
        anchor = index;
        rangeButton.textContent = "请选择区间终点";
        notifySelection(index, index);
      } else {
        const start = rangeStart;
        endRange();
        notifySelection(start, index);
      }
    } else {
      if (!extend) anchor = index;
      notifySelection(anchor, index);
    }
  }
  rangeButton.addEventListener("click", () => {
    if (pickingRange) endRange();
    else {
      pickingRange = true;
      rangeStart = null;
      rangeButton.textContent = "请选择区间起点";
      rangeButton.setAttribute("aria-pressed", "true");
    }
  });
  allButton.addEventListener("click", () => {
    endRange();
    anchor = 0;
    notifySelection(0, bars.length - 1);
  });
  const width = 760,
    height = 220,
    pad = { l: 78, r: 15, t: 14, b: 28 },
    pw = width - pad.l - pad.r,
    ph = height - pad.t - pad.b;
  const min = Math.min(...bars.map((b) => b.low)),
    max = Math.max(...bars.map((b) => b.high));
  const gap = (max - min || Math.max(Math.abs(max) * 0.05, 100)) * 0.12,
    lo = min - gap,
    hi = max + gap;
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * ph;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${bars.length} 根利润K线，单位M每日（百万金币）；点击或键盘选择；Shift 扩展选择范围`,
  });
  for (let i = 0; i <= 4; i++) {
    const value = lo + ((hi - lo) * i) / 4,
      yy = y(value);
    svg.append(
      svgEl("line", {
        x1: pad.l,
        x2: width - pad.r,
        y1: yy,
        y2: yy,
        stroke: "#29344a",
      }),
      svgEl(
        "text",
        {
          x: pad.l - 8,
          y: yy + 4,
          "text-anchor": "end",
          fill: "#a6b4ca",
          "font-size": 11,
        },
        money(value),
      ),
    );
  }
  if (lo < 0 && hi > 0)
    svg.append(
      svgEl("line", {
        x1: pad.l,
        x2: width - pad.r,
        y1: y(0),
        y2: y(0),
        stroke: "#91a0b8",
        "stroke-dasharray": "4 4",
      }),
    );
  const step = pw / bars.length;
  // One position per observed bucket. Explicit break marks show calendar gaps.
  bars.forEach((b, i) => {
    const x = pad.l + (i + 0.5) * step,
      w = Math.max(1, Math.min(12, step * 0.58)),
      color = b.close >= b.open ? "#f28d8d" : "#54d6b0";
    const g = svgEl("g", {
      tabindex: 0,
      role: "button",
      "data-candle": i,
      "aria-pressed": String(i === bars.length - 1),
      "aria-label": `${b.day} 开 ${money(b.open)} 高 ${money(b.high)} 低 ${money(b.low)} 收 ${money(b.close)} 日均 ${money(b.mean)}`,
    });
    g.append(
      svgEl("rect", {
        x: pad.l + i * step,
        y: pad.t,
        width: step,
        height: ph,
        fill: "transparent",
      }),
      svgEl("line", {
        x1: x,
        x2: x,
        y1: y(b.high),
        y2: y(b.low),
        stroke: color,
        "stroke-width": 1.3,
      }),
      svgEl("rect", {
        x: x - w / 2,
        y: Math.min(y(b.open), y(b.close)),
        width: w,
        height: Math.max(1.8, Math.abs(y(b.open) - y(b.close))),
        fill: color,
        rx: 0.6,
      }),
    );
    g.append(
      svgEl(
        "title",
        {},
        `${b.day}\n开 ${money(b.open)} · 高 ${money(b.high)} · 低 ${money(b.low)} · 收 ${money(b.close)}\n日均 ${money(b.mean)} · ${b.samples} 个实际样本`,
      ),
    );
    groups.push(g);
    g.addEventListener("click", (e) => choose(i, e.shiftKey));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(i, e.shiftKey);
      }
    });
    svg.append(g);
    if (
      i === 0 ||
      i === bars.length - 1 ||
      i % Math.max(1, Math.ceil(bars.length / 5)) === 0
    )
      svg.append(
        svgEl(
          "text",
          {
            x,
            y: height - 7,
            "text-anchor": "middle",
            fill: "#a6b4ca",
            "font-size": 10,
          },
          b.day.slice(5),
        ),
      );
    if (i > 0) {
      const prev = bars[i - 1].day,
        delta = (Date.parse(b.day) - Date.parse(prev)) / 86400000,
        limit = period === "day" ? 1 : period === "week" ? 7 : 32;
      if (delta > limit)
        svg.append(
          svgEl(
            "text",
            {
              x: x - step / 2,
              y: pad.t + 12,
              fill: "#ffd590",
              "font-size": 14,
            },
            "⋮",
          ),
        );
    }
  });
  container.append(svg);
}
