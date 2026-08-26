"use strict";

const DATA_PATH = "./data/dashboard.json";
const TOP_LEVEL_KEYS = [
  "account",
  "disclosure",
  "equity_curve",
  "execution_state",
  "performance",
  "paper_experiment",
  "positions",
  "public_contract_version",
  "recent_fills",
  "risk",
  "round_trips",
  "selected_candidate",
  "selected_strategy",
  "signals",
  "system_health",
  "title",
  "trading_mode",
  "deployment",
].sort();
let latestSnapshot = null;

function requireObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function requireArray(value, name, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function requireString(value, name, maximum = 160) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function decimalNumber(value, name) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${name} is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} is invalid`);
  }
  return parsed;
}

function validateSnapshot(data) {
  const root = requireObject(data, "dashboard");
  const keys = Object.keys(root).sort();
  if (keys.length !== TOP_LEVEL_KEYS.length || keys.some((key, index) => key !== TOP_LEVEL_KEYS[index])) {
    throw new Error("dashboard contract keys are invalid");
  }
  if (
    root.public_contract_version !== "2.1" ||
    root.trading_mode !== "Paper Trading" ||
    root.selected_candidate !== "CASH_ONLY" ||
    root.selected_strategy !== "cash" ||
    root.execution_state !== "DISABLED"
  ) {
    throw new Error("dashboard identity is invalid");
  }
  requireObject(root.account, "account");
  requireObject(root.performance, "performance");
  requireObject(root.risk, "risk");
  requireObject(root.system_health, "system health");
  requireObject(root.deployment, "deployment");
  const experiment = requireObject(root.paper_experiment, "paper experiment");
  if (!["UNAVAILABLE", "CASH", "ALLOCATED"].includes(experiment.target_state)) {
    throw new Error("paper experiment target state is invalid");
  }
  if (
    experiment.experiment_id !== "paper-forward-v1" ||
    experiment.strategy !== "Simple Long-Horizon Momentum" ||
    experiment.classification !== "PAPER_CHALLENGER_ONLY" ||
    experiment.live_approved !== false
  ) {
    throw new Error("paper experiment identity is invalid");
  }
  requireObject(experiment.performance, "paper experiment performance");
  requireObject(experiment.operational_checkpoint, "operational checkpoint");
  requireObject(experiment.initial_performance_checkpoint, "performance checkpoint");
  requireObject(experiment.stronger_evidence_checkpoint, "evidence checkpoint");
  if (
    !Number.isInteger(experiment.completed_sessions) ||
    !Number.isInteger(experiment.elapsed_market_sessions) ||
    experiment.completed_sessions < 0 ||
    experiment.completed_sessions > experiment.elapsed_market_sessions
  ) {
    throw new Error("paper experiment session clocks are invalid");
  }
  requireArray(experiment.current_target, "paper target", 2);
  requireArray(experiment.current_allocation, "paper allocation", 2);
  requireArray(experiment.current_positions, "paper positions", 2);
  requireArray(experiment.recent_fills, "paper fills", 20);
  requireArray(experiment.benchmarks, "paper benchmarks", 5);
  requireArray(experiment.result_boundaries, "result boundaries", 4);
  requireArray(root.equity_curve, "equity curve", 5000);
  requireArray(root.positions, "positions", 2);
  requireArray(root.recent_fills, "recent fills", 20);
  requireArray(root.round_trips, "round trips", 20);
  requireArray(root.signals, "signals", 3);
  requireArray(root.disclosure, "disclosure", 8);
  return root;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimalNumber(value, "money"));
}

function quantity(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 8,
  }).format(decimalNumber(value, "quantity"));
}

function percent(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimalNumber(value, "percentage"));
}

function integer(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function timestamp(value) {
  const parsed = new Date(requireString(value, "timestamp"));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("timestamp is invalid");
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric",
  }).format(parsed);
}

const REASON_LABELS = {
  insufficient_history: "Insufficient history",
  missing_base_value: "Base value unavailable",
  external_cashflow: "External cash flow detected",
  incomplete_fill_history: "Fill history incomplete",
  position_reconciliation_failed: "Ledger reconciliation unavailable",
  no_completed_round_trips: "No completed round trips",
  zero_equity: "Equity is zero",
  experiment_not_started: "Experiment has not started",
  benchmark_unavailable: "Prospective benchmark unavailable",
};

function metricDisplay(metric, kind) {
  const value = requireObject(metric, "metric");
  if (value.state === "unavailable") {
    return {
      display: "—",
      context: REASON_LABELS[value.reason] || "Unavailable",
      numeric: null,
    };
  }
  if (value.state !== "available" || value.value === null) {
    throw new Error("metric state is invalid");
  }
  const numeric = decimalNumber(value.value, "metric value");
  let display = quantity(value.value);
  if (kind === "money") {
    display = money(value.value);
  } else if (kind === "percent") {
    display = percent(value.value);
  }
  return {
    display,
    context: value.as_of ? `As of ${value.as_of}` : "",
    numeric,
  };
}

function renderSummary(data) {
  const target = document.getElementById("summary-strip");
  clear(target);
  const items = [
    ["Selected strategy", `${data.selected_candidate} · ${data.selected_strategy} · ${data.system_health.strategy_version}`],
    ["Paper experiment", `${data.paper_experiment.experiment_status} · canary ${data.paper_experiment.canary_status}`],
    ["Last successful update", timestamp(data.deployment.last_successful_update)],
    ["Data freshness", data.deployment.data_freshness === "fresh" ? "Fresh snapshot" : "Stale snapshot"],
  ];
  for (const [label, value] of items) {
    const row = element("div", "summary-item");
    if (label === "Data freshness" && data.deployment.data_freshness === "stale") {
      row.classList.add("summary-warning");
      row.setAttribute("role", "status");
      row.setAttribute("aria-live", "polite");
    }
    row.append(element("span", "", label), element("strong", "", value));
    target.append(row);
  }
}

function renderMetrics(data) {
  const target = document.getElementById("metrics");
  clear(target);
  const paper = data.paper_experiment.performance;
  const metrics = [
    ["Equity", { state: "available", value: data.account.equity }, "money"],
    ["Cash", { state: "available", value: data.account.cash }, "money"],
    ["Paper-forward P&L", paper.total_pnl, "money"],
    ["Paper-forward return", paper.total_return, "percent"],
    ["Daily paper P&L", paper.daily_pnl, "money"],
    ["Realized paper P&L", paper.realized_pnl, "money"],
    ["Unrealized paper P&L", paper.unrealized_pnl, "money"],
    ["Paper max drawdown", paper.maximum_drawdown, "percent"],
    ["Open positions", { state: "available", value: String(data.account.open_positions) }, "count"],
    ["Filled orders", { state: "available", value: String(paper.trade_count) }, "count"],
    ["Fill count", { state: "available", value: String(paper.fill_count) }, "count"],
    [
      "Completed round trips",
      paper.completed_round_trips === null
        ? { state: "unavailable", value: null, reason: "incomplete_fill_history" }
        : { state: "available", value: String(paper.completed_round_trips) },
      "count",
    ],
  ];
  for (const [label, metric, kind] of metrics) {
    const shown = metricDisplay(metric, kind);
    const card = element("article", "metric-card");
    const valueNode = element("strong", "metric-value", shown.display);
    if (
      shown.numeric !== null &&
      shown.numeric > 0 &&
      (label.includes("P&L") || label.includes("return"))
    ) {
      valueNode.classList.add("value-positive");
    }
    if (shown.numeric !== null && shown.numeric < 0) {
      valueNode.classList.add("value-negative");
    }
    card.append(
      element("span", "metric-label", label),
      valueNode,
      element("span", "metric-context", shown.context),
    );
    target.append(card);
  }
}

function renderExperiment(data) {
  const experiment = data.paper_experiment;
  const badge = document.getElementById("experiment-badge");
  badge.textContent = `${experiment.experiment_status.replaceAll("_", " ")} · ${experiment.execution_enabled ? "scheduled execution enabled" : "read only"}`;
  badge.className = `badge ${experiment.execution_enabled ? "badge-paper" : "badge-disabled"}`;

  const summary = document.getElementById("experiment-summary");
  clear(summary);
  const summaryItems = [
    ["Experiment ID", experiment.experiment_id],
    ["Prospective baseline", experiment.prospective_baseline_version],
    ["Classification", experiment.classification],
    ["Live approved", experiment.live_approved ? "Yes" : "No"],
    ["Start", experiment.experiment_start ? timestamp(experiment.experiment_start) : "Not started"],
    ["Clean reconciled sessions", integer(experiment.completed_sessions)],
    ["Elapsed market sessions", integer(experiment.elapsed_market_sessions)],
    ["Latest action", requireString(experiment.latest_action_reason, "latest action")],
    ["Risk decision", requireString(experiment.latest_risk_decision, "risk decision")],
    ["Reconciliation", requireString(experiment.latest_reconciliation_state, "reconciliation state")],
  ];
  for (const [label, value] of summaryItems) {
    const item = element("div", "experiment-fact");
    item.append(element("span", "", label), element("strong", "", value));
    summary.append(item);
  }

  const progress = document.getElementById("experiment-progress");
  clear(progress);
  const checkpoints = [
    ["20-session operational", experiment.operational_checkpoint],
    ["60-session initial performance", experiment.initial_performance_checkpoint],
    ["120-session stronger evidence", experiment.stronger_evidence_checkpoint],
  ];
  for (const [label, checkpoint] of checkpoints) {
    const card = element("article", "checkpoint-card");
    const track = element("div", "progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `${label} clean-session progress`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(checkpoint.required_sessions));
    track.setAttribute(
      "aria-valuenow",
      String(Math.min(checkpoint.completed_sessions, checkpoint.required_sessions)),
    );
    const bar = element("div", "progress-value");
    bar.style.width = `${Math.max(0, Math.min(1, decimalNumber(checkpoint.progress, "checkpoint progress"))) * 100}%`;
    track.append(bar);
    card.append(
      element("span", "", label),
      element("strong", "", `${integer(checkpoint.completed_sessions)} / ${integer(checkpoint.required_sessions)}`),
      track,
    );
    progress.append(card);
  }

  const target = document.getElementById("experiment-target");
  clear(target);
  if (experiment.target_state === "UNAVAILABLE") {
    target.append(element("p", "empty-state", "The latest frozen challenger target is unavailable."));
  } else if (experiment.target_state === "CASH") {
    target.append(element("p", "empty-state", "The frozen challenger target is cash."));
  } else {
    target.append(table(
      "Frozen challenger target",
      ["Rank", "Asset", "Target"],
      experiment.current_target.map((item) => [integer(item.rank), item.symbol, money(item.target_notional)]),
    ));
  }

  const benchmarks = document.getElementById("experiment-benchmarks");
  clear(benchmarks);
  const benchmarkLabels = {
    cash: "Cash",
    equal_weight_buy_and_hold_price_return_gldm_slv_xle:
      "Equal-weight GLDM / SLV / XLE (price return)",
    production_cash_only: "Frozen production CASH_ONLY",
    paper_forward_executed: "Paper-forward executed",
    paper_forward_frictionless_shadow: "Frictionless frozen challenger shadow",
  };
  const benchmarkRows = experiment.benchmarks.map((item) => {
    const shown = metricDisplay(item.return_metric, "percent");
    return [benchmarkLabels[item.name] || item.name.replaceAll("_", " "), shown.display, shown.context];
  });
  benchmarks.append(table("Prospective benchmark returns", ["Benchmark", "Return", "State"], benchmarkRows));

  const boundaries = document.getElementById("result-boundaries");
  clear(boundaries);
  for (const item of experiment.result_boundaries) {
    boundaries.append(element("div", "boundary-card", requireString(item, "result boundary", 180)));
  }
}

function renderAllocation(data) {
  const target = document.getElementById("allocation");
  clear(target);
  const equity = decimalNumber(data.account.equity, "equity");
  const cash = decimalNumber(data.account.cash, "cash");
  const cashWeight = equity > 0 ? Math.max(0, Math.min(1, cash / equity)) : 0;
  const bar = element("div", "allocation-bar");
  const cashSegment = element("div", "allocation-segment");
  cashSegment.style.width = `${cashWeight * 100}%`;
  bar.append(cashSegment);
  if (cashWeight < 1) {
    const assetSegment = element("div", "allocation-segment asset");
    assetSegment.style.width = `${(1 - cashWeight) * 100}%`;
    bar.append(assetSegment);
  }
  const legend = element("div", "legend");
  const cashRow = element("div", "legend-row");
  cashRow.append(element("span", "", "Cash"), element("strong", "", `${money(data.account.cash)} · ${percent(cashWeight)}`));
  legend.append(cashRow);
  for (const position of data.positions) {
    const row = element("div", "legend-row");
    row.append(
      element("span", "", `${requireString(position.symbol, "symbol")} · ${requireString(position.category, "category")}`),
      element("strong", "", `${money(position.market_value)} · ${percent(position.portfolio_weight)}`),
    );
    legend.append(row);
  }
  target.append(bar, legend);
}

function renderSignals(data) {
  const target = document.getElementById("signals");
  clear(target);
  for (const signal of data.signals) {
    const card = element("article", "signal-card");
    const top = element("div", "signal-top");
    const identity = element("div", "");
    identity.append(
      element("span", "signal-symbol", requireString(signal.symbol, "signal symbol")),
      element("span", "signal-category", requireString(signal.category, "signal category")),
    );
    top.append(identity, element("span", "status-label", requireString(signal.eligibility, "eligibility").replaceAll("_", " ")));
    const facts = element("div", "signal-facts");
    const values = [
      ["Momentum votes", `${signal.momentum_votes} / 4`],
      ["Above MA", signal.above_moving_average ? "Yes" : "No"],
      ["Target weight", percent(signal.target_weight)],
      ["Current weight", percent(signal.current_weight)],
    ];
    for (const [label, value] of values) {
      const fact = element("div", "signal-fact");
      fact.append(element("span", "", label), element("strong", "", value));
      facts.append(fact);
    }
    card.append(
      top,
      element("p", "signal-reason", requireString(signal.reason, "signal reason", 220)),
      facts,
      element("p", "signal-category", `Completed session · ${signal.completed_data_session}`),
    );
    target.append(card);
  }
}

function table(caption, headers, rows) {
  const wrap = element("div", "table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", `${caption}; scroll horizontally if needed`);
  const tableNode = element("table", "");
  tableNode.append(element("caption", "sr-only", caption));
  const head = element("thead", "");
  const headRow = element("tr", "");
  for (const header of headers) {
    const heading = element("th", "", header);
    heading.setAttribute("scope", "col");
    headRow.append(heading);
  }
  head.append(headRow);
  const body = element("tbody", "");
  for (const rowValues of rows) {
    const row = element("tr", "");
    for (const value of rowValues) {
      row.append(element("td", "", value));
    }
    body.append(row);
  }
  tableNode.append(head, body);
  wrap.append(tableNode);
  return wrap;
}

function renderPositions(data) {
  const target = document.getElementById("positions");
  clear(target);
  if (data.positions.length === 0) {
    const empty = element("div", "empty-state");
    empty.append(element("strong", "", "No open paper positions"), element("span", "", "The current strategy remains in cash."));
    target.append(empty);
    return;
  }
  const rows = data.positions.map((position) => [
    `${position.symbol} · ${position.category}`,
    quantity(position.quantity),
    money(position.market_value),
    position.average_entry_price === null ? "—" : money(position.average_entry_price),
    money(position.current_price),
    position.unrealized_pnl === null ? "—" : money(position.unrealized_pnl),
    percent(position.portfolio_weight),
  ]);
  target.append(table("Current paper positions", ["Asset", "Quantity", "Market value", "Avg entry", "Current", "Unrealized P&L", "Weight"], rows));
}

function renderActivity(data) {
  const target = document.getElementById("activity");
  clear(target);
  if (data.recent_fills.length === 0) {
    const empty = element("div", "empty-state");
    empty.append(element("strong", "", "No paper trades have been executed yet."), element("span", "", "Accepted, canceled, and rejected orders are not counted as trades."));
    target.append(empty);
    return;
  }
  const rows = [...data.recent_fills].reverse().map((fill) => [
    timestamp(fill.timestamp),
    `${fill.symbol} · ${fill.category}`,
    requireString(fill.side, "fill side"),
    quantity(fill.quantity),
    money(fill.price),
    money(fill.notional),
  ]);
  target.append(table("Recent paper fill activity", ["Time", "Asset", "Side", "Quantity", "Price", "Notional"], rows));
}

function detailRow(term, description) {
  const row = element("div", "detail-row");
  row.append(element("dt", "", term), element("dd", "", description));
  return row;
}

function renderRisk(data) {
  const target = document.getElementById("risk");
  clear(target);
  const risk = data.risk;
  const rows = [
    ["Strategy capital ceiling", money(risk.strategy_capital_ceiling)],
    ["Maximum gross exposure", money(risk.maximum_gross_exposure)],
    ["Minimum cash reserve", money(risk.minimum_cash_reserve)],
    ["Maximum position size", money(risk.maximum_position_size)],
    ["Combined metals limit", money(risk.metals_exposure_limit)],
    ["Liquidation threshold", money(risk.liquidation_threshold)],
    ["Production execution", risk.execution_enabled ? "Enabled" : "Disabled · CASH_ONLY"],
    ["Paper experiment execution", data.paper_experiment.execution_enabled ? "Enabled behind gates" : "Read only"],
    ["Scheduled shadow gate", `${risk.scheduled_shadow_gate} · ${risk.scheduled_shadow_completed} / ${risk.scheduled_shadow_required}`],
    ["Reconciliation", risk.reconciliation_state],
  ];
  for (const [term, description] of rows) {
    target.append(detailRow(term, description));
  }
}

function renderHealth(data) {
  const target = document.getElementById("health");
  clear(target);
  const health = data.system_health;
  const rows = [
    ["Doctor", health.doctor],
    ["Broker environment", health.broker_environment],
    ["Account", health.account_status],
    ["Market data", health.market_data],
    ["Reconciliation", health.reconciliation],
    ["Workflow source", health.workflow_source.replaceAll("_", " ")],
    ["Last completion", timestamp(health.last_workflow_completion)],
    ["Strategy version", health.strategy_version],
    ["Dashboard version", health.deployment_version],
  ];
  for (const [term, description] of rows) {
    target.append(detailRow(term, description));
  }
}

function renderDisclosure(data) {
  const target = document.getElementById("disclosure");
  clear(target);
  for (const item of data.disclosure) {
    target.append(element("div", "disclosure-card", requireString(item, "disclosure", 240)));
  }
}

function renderChart(data) {
  const canvas = document.getElementById("equity-chart");
  const context = canvas.getContext("2d");
  const container = canvas.parentElement;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(240, container.clientWidth);
  const height = 300;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const points = data.equity_curve.map((point) => ({
    date: requireString(point.session_date, "equity date"),
    equity: decimalNumber(point.equity, "equity point"),
  }));
  const contextNode = document.getElementById("equity-context");
  const scaleNode = document.getElementById("chart-scale-note");
  const summaryNode = document.getElementById("equity-data-summary");
  if (points.length === 0) {
    context.fillStyle = "#aebbd0";
    context.font = "14px system-ui";
    context.fillText("Daily portfolio history is unavailable.", 20, height / 2);
    contextNode.textContent = "No validated completed-session observations";
    scaleNode.textContent = "The chart is intentionally blank rather than estimated.";
    summaryNode.textContent = "Validated completed-session equity history is unavailable.";
    canvas.setAttribute("aria-label", "Account equity history is unavailable");
    return;
  }
  const values = points.map((point) => point.equity);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(rawMax - rawMin, Math.max(rawMax * 0.05, 1));
  const minimum = Math.max(0, rawMin - span * 0.25);
  const maximum = rawMax + span * 0.25;
  const left = 58;
  const right = 16;
  const top = 18;
  const bottom = 36;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  context.strokeStyle = "#293750";
  context.fillStyle = "#aebbd0";
  context.font = "11px system-ui";
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (plotHeight * index) / 4;
    const value = maximum - ((maximum - minimum) * index) / 4;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
    context.fillText(money(value), 4, y + 4);
  }
  context.strokeStyle = "#78d6c5";
  context.lineWidth = 2.5;
  context.beginPath();
  points.forEach((point, index) => {
    const x = left + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));
    const y = top + ((maximum - point.equity) / (maximum - minimum)) * plotHeight;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  context.fillStyle = "#aebbd0";
  context.fillText(points[0].date, left, height - 10);
  const lastLabel = points[points.length - 1].date;
  const measured = context.measureText(lastLabel).width;
  context.fillText(lastLabel, width - right - measured, height - 10);
  contextNode.textContent = `${points[0].date} to ${lastLabel} · baseline ${money(points[0].equity)} · latest completed ${money(points[points.length - 1].equity)}`;
  scaleNode.textContent = `Vertical scale is explicitly truncated to ${money(minimum)}–${money(maximum)} for readability; it does not begin at zero.`;
  summaryNode.textContent = `The equity series contains ${points.length} completed-session observations from ${points[0].date} through ${lastLabel}. It starts at ${money(points[0].equity)}, ends at ${money(points[points.length - 1].equity)}, and ranges from ${money(rawMin)} to ${money(rawMax)}.`;
  canvas.dataset.rendered = "true";
  canvas.setAttribute(
    "aria-label",
    `Account equity from ${points[0].date} to ${lastLabel}, ending at ${money(points[points.length - 1].equity)}`,
  );
}

function render(data) {
  latestSnapshot = data;
  renderSummary(data);
  renderExperiment(data);
  renderMetrics(data);
  renderAllocation(data);
  renderSignals(data);
  renderPositions(data);
  renderActivity(data);
  renderRisk(data);
  renderHealth(data);
  renderDisclosure(data);
  renderChart(data);
  document.getElementById("cash-state").classList.toggle("hidden", data.positions.length > 0);
}

function showFailure() {
  const main = document.getElementById("main");
  clear(main);
  const panel = element("section", "error-card");
  panel.setAttribute("role", "alert");
  panel.tabIndex = -1;
  panel.append(
    element("p", "eyebrow", "Dashboard unavailable"),
    element("h1", "", "The latest public snapshot could not be validated."),
    element("p", "", "The previous successful deployment remains the source of truth. No values were estimated."),
  );
  main.append(panel);
  panel.focus();
}

fetch(DATA_PATH, { cache: "no-store", credentials: "same-origin" })
  .then((response) => {
    if (!response.ok || response.headers.get("content-length") === "0") {
      throw new Error("dashboard response is invalid");
    }
    return response.json();
  })
  .then((payload) => render(validateSnapshot(payload)))
  .catch(() => showFailure());

window.addEventListener("resize", () => {
  if (latestSnapshot !== null) {
    renderChart(latestSnapshot);
  }
});
