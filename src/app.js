import { usageAdapters } from "./adapters/grok-usage-csv.js";
import { usageStore } from "./storage/usage-store.js";

const $ = selector => document.querySelector(selector);
const state = { events: [], sourceName: "", sourceRows: 0, skippedRows: 0, range: "7d", custom: null, metric: "total", search: "", page: 1, pageSize: 10, hoveredIndex: -1 };
const numberFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const fullNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const metrics = { total: "Total tokens", prompt: "Prompt tokens", completion: "Completion tokens", cached: "Cached prompt", cacheWrite: "Cache writes", requests: "Requests" };
const colors = { prompt: "#a78bfa", completion: "#60a5fa", cached: "#48d9d1", cacheWrite: "#f5bd61", total: "#a78bfa", requests: "#60a5fa" };

function format(value) { return numberFormat.format(value || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]); }
function setError(message = "") { const box = $("#import-error"); box.textContent = message; box.hidden = !message; }
function showModal() { setError(); $("#import-modal").hidden = false; }
function hideModal() { $("#import-modal").hidden = true; setError(); }

function activeRange() {
  if (!state.events.length) return [];
  const latest = state.events[state.events.length - 1].timestamp;
  let from = -Infinity, to = Infinity;
  if (state.range === "24h") from = latest - 24 * 3600_000;
  if (state.range === "7d") from = latest - 7 * 24 * 3600_000;
  if (state.range === "30d") from = latest - 30 * 24 * 3600_000;
  if (state.range === "custom" && state.custom) { from = state.custom.from; to = state.custom.to; }
  return state.events.filter(event => event.timestamp >= from && event.timestamp <= to);
}

function summarize(events) {
  return events.reduce((sum, event) => {
    for (const key of ["prompt", "completion", "cached", "cacheWrite", "total", "cost"]) sum[key] += event[key] || 0;
    sum.requests++;
    return sum;
  }, { prompt: 0, completion: 0, cached: 0, cacheWrite: 0, total: 0, cost: 0, requests: 0 });
}

function renderKpis(events) {
  const sum = summarize(events);
  $("#kpi-total").textContent = format(sum.total);
  $("#kpi-requests").textContent = fullNumber.format(sum.requests);
  $("#kpi-prompt").textContent = format(sum.prompt);
  $("#kpi-completion").textContent = format(sum.completion);
  $("#kpi-cached").textContent = format(sum.cached);
  $("#kpi-total-sub").textContent = `${fullNumber.format(sum.total)} tokens in range`;
  const spanHours = events.length > 1 ? Math.max((events[events.length - 1].timestamp - events[0].timestamp) / 3600_000, 1 / 60) : 1;
  $("#kpi-rpm").textContent = `${(sum.requests / spanHours).toFixed(1)} requests / hour`;
  const cacheRate = sum.cached + sum.prompt > 0 ? sum.cached / (sum.cached + sum.prompt) * 100 : 0;
  $("#kpi-cache-rate").textContent = `Cache share ${cacheRate.toFixed(1)}%`;
}

function renderBreakdown(events) {
  const sum = summarize(events);
  const values = [
    ["prompt", "Prompt", sum.prompt, colors.prompt],
    ["completion", "Completion", sum.completion, colors.completion],
    ["cached", "Cached prompt", sum.cached, colors.cached],
    ["cacheWrite", "Cache writes", sum.cacheWrite, colors.cacheWrite]
  ];
  $("#donut-total").textContent = format(sum.total);
  let angle = 0;
  const segments = values.map(([key, label, value, color]) => {
    const start = angle; angle += sum.total ? value / sum.total * 360 : 0;
    return `${color} ${start}deg ${angle}deg`;
  });
  $("#breakdown-donut").style.background = sum.total ? `conic-gradient(${segments.join(",")})` : "conic-gradient(#30394a 0deg 360deg)";
  for (const [key, label, value] of values) {
    $(`#break-${key}`).textContent = format(value);
    $(`#pct-${key}`).textContent = `${sum.total ? value / sum.total * 100 : 0 .toFixed?.(1) || "0.0"}%`;
    // Keep the percentage readable even when no events exist.
    $(`#pct-${key}`).textContent = `${(sum.total ? value / sum.total * 100 : 0).toFixed(1)}%`;
  }
}

function bucketEvents(events) {
  if (!events.length) return [];
  const span = events[events.length - 1].timestamp - events[0].timestamp;
  const interval = span <= 6 * 3600_000 ? 5 * 60_000 : span <= 2 * 24 * 3600_000 ? 60 * 60_000 : span <= 45 * 24 * 3600_000 ? 6 * 3600_000 : 24 * 3600_000;
  const buckets = new Map();
  for (const event of events) {
    const start = Math.floor(event.timestamp / interval) * interval;
    if (!buckets.has(start)) buckets.set(start, { timestamp: start, total: 0, prompt: 0, completion: 0, cached: 0, cacheWrite: 0, requests: 0 });
    const bucket = buckets.get(start);
    for (const key of ["total", "prompt", "completion", "cached", "cacheWrite"]) bucket[key] += event[key] || 0;
    bucket.requests++;
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp).map(bucket => ({ ...bucket, label: dateFormat.format(bucket.timestamp) }));
}

function renderChart(events) {
  const canvas = $("#usage-chart"), wrap = canvas.parentElement, empty = $("#chart-empty"), tooltip = $("#chart-tooltip");
  const rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const width = rect.width, height = rect.height;
  ctx.clearRect(0, 0, width, height);
  const buckets = bucketEvents(events), metric = state.metric;
  $("#legend-label").textContent = metrics[metric];
  $("#chart-period").textContent = events.length ? `${dateFormat.format(events[0].timestamp)} — ${dateFormat.format(events[events.length - 1].timestamp)}` : "No events in range";
  $("#bucket-label").textContent = buckets.length > 1 ? `Adaptive buckets · ${buckets.length} points` : "Adaptive time buckets";
  empty.hidden = buckets.length > 0;
  if (!buckets.length || width < 10 || height < 10) { tooltip.hidden = true; return; }
  const pad = { left: 42, right: 12, top: 18, bottom: 30 }, plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
  const values = buckets.map(bucket => bucket[metric] || 0), max = Math.max(...values, 1), scaleMax = max * 1.15;
  ctx.font = "10px Inter, sans-serif"; ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH * i / 4;
    ctx.strokeStyle = "#27303d"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#7f8ba0"; ctx.textAlign = "right"; ctx.fillText(format(scaleMax * (1 - i / 4)), pad.left - 9, y);
  }
  const points = buckets.map((bucket, i) => ({ x: pad.left + (buckets.length === 1 ? plotW / 2 : i / (buckets.length - 1) * plotW), y: pad.top + plotH * (1 - values[i] / scaleMax), bucket }));
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH); gradient.addColorStop(0, "#a78bfa42"); gradient.addColorStop(1, "#a78bfa00");
  ctx.beginPath(); ctx.moveTo(points[0].x, pad.top + plotH); points.forEach(point => ctx.lineTo(point.x, point.y)); ctx.lineTo(points[points.length - 1].x, pad.top + plotH); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.strokeStyle = colors[metric]; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  ctx.fillStyle = "#7f8ba0"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  const tickCount = Math.min(5, points.length);
  for (let i = 0; i < tickCount; i++) { const point = points[Math.round(i * (points.length - 1) / Math.max(tickCount - 1, 1))]; ctx.fillText(dateFormat.format(point.bucket.timestamp), point.x, height - pad.bottom + 10); }
  if (state.hoveredIndex >= 0 && state.hoveredIndex < points.length) {
    const point = points[state.hoveredIndex];
    ctx.strokeStyle = "#9ba7bb66"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(point.x, pad.top); ctx.lineTo(point.x, pad.top + plotH); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = colors[metric]; ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill();
    tooltip.hidden = false; tooltip.innerHTML = `<strong>${escapeHtml(new Date(point.bucket.timestamp).toLocaleString())}</strong><span>${escapeHtml(metrics[metric])}: <b>${fullNumber.format(point.bucket[metric] || 0)}</b></span><span>Requests: <b>${point.bucket.requests}</b></span>`;
    tooltip.style.left = `${Math.max(5, Math.min(width - 190, point.x + 12))}px`; tooltip.style.top = `${Math.max(5, Math.min(height - 75, point.y - 20))}px`;
  } else tooltip.hidden = true;
  canvas._chartPoints = points;
}

function renderEvents(events) {
  const search = state.search.toLowerCase();
  const filtered = events.filter(event => [event.model, event.usageType, event.chargeCategory, new Date(event.timestamp).toISOString()].join(" ").toLowerCase().includes(search));
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const pageEvents = filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  $("#events-body").innerHTML = pageEvents.length ? pageEvents.slice().reverse().map(event => `<tr>
    <td>${escapeHtml(new Date(event.timestamp).toLocaleString())}</td><td><span class="model-chip">${escapeHtml(event.model)}</span></td>
    <td class="num">${fullNumber.format(event.total)}</td><td class="num">${fullNumber.format(event.prompt)}</td><td class="num">${fullNumber.format(event.completion)}</td><td class="num">${fullNumber.format(event.cached)}</td><td><span class="type-chip">${escapeHtml(event.usageType)}</span></td>
  </tr>`).join("") : '<tr><td colspan="7" class="table-empty">No events match this view.</td></tr>';
  $("#table-count").textContent = `${filtered.length.toLocaleString()} events`;
  $("#page-label").textContent = `Page ${state.page} of ${pages}`;
  $("#prev-page").disabled = state.page <= 1; $("#next-page").disabled = state.page >= pages;
  $("#events-subtitle").textContent = `${filtered.length.toLocaleString()} records in selected range`;
}

function render() {
  const events = activeRange();
  renderKpis(events); renderBreakdown(events); renderChart(events); renderEvents(events);
  $("#dataset-name").textContent = state.sourceName || "No dataset loaded";
  $("#dataset-meta").textContent = state.events.length ? `${state.events.length.toLocaleString()} events · ${new Date(state.events[0].timestamp).toLocaleDateString()} – ${new Date(state.events[state.events.length - 1].timestamp).toLocaleDateString()}${state.skippedRows ? ` · ${state.skippedRows} invalid rows skipped` : ""}` : "Import a Grok Usage CSV to begin";
}

async function importFile(file) {
  if (!file) return;
  try {
    setError();
    const text = await file.text();
    const adapter = usageAdapters.find(candidate => candidate.supports(file.name, text.slice(0, 12000)));
    if (!adapter) throw new Error("Unsupported file. The first release accepts Grok Usage CSV exports with Event Time, Product and Usage columns.");
    const result = adapter.parse(text);
    const dataset = { sourceName: file.name, adapterId: adapter.id, importedAt: Date.now(), sourceRows: result.sourceRows, skippedRows: result.skippedRows, events: result.events };
    await usageStore.save(dataset);
    state.events = result.events; state.sourceName = file.name; state.sourceRows = result.sourceRows; state.skippedRows = result.skippedRows; state.range = "all"; state.page = 1;
    $("#range-select").value = "all"; $("#custom-range").hidden = true;
    hideModal(); render();
  } catch (error) { setError(error.message || "Could not import this file."); }
}

function downloadCsv() {
  const events = activeRange();
  const headers = ["Event Time", "Model", "Total Tokens", "Prompt Tokens", "Completion Tokens", "Cached Prompt Tokens", "Cache Write Tokens", "Usage Type", "Cost", "Currency"];
  const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = events.map(event => [new Date(event.timestamp).toISOString(), event.model, event.total, event.prompt, event.completion, event.cached, event.cacheWrite, event.usageType, event.cost, event.currency]);
  const blob = new Blob([[headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = "ai-usage-dashboard-export.csv"; anchor.click(); URL.revokeObjectURL(url);
}

$("#import-button").addEventListener("click", showModal);
$("#open-import").addEventListener("click", showModal);
$("#close-modal").addEventListener("click", hideModal);
$("#cancel-import").addEventListener("click", hideModal);
$("#choose-file").addEventListener("click", () => $("#csv-file").click());
$("#csv-file").addEventListener("change", event => { importFile(event.target.files?.[0]); event.target.value = ""; });
$("#dropzone").addEventListener("dragover", event => { event.preventDefault(); $("#dropzone").classList.add("dragging"); });
$("#dropzone").addEventListener("dragleave", () => $("#dropzone").classList.remove("dragging"));
$("#dropzone").addEventListener("drop", event => { event.preventDefault(); $("#dropzone").classList.remove("dragging"); importFile(event.dataTransfer.files?.[0]); });
$("#range-select").addEventListener("change", event => { state.range = event.target.value; $("#custom-range").hidden = state.range !== "custom"; if (state.range === "custom") return; state.custom = null; state.page = 1; render(); });
$("#apply-range").addEventListener("click", () => {
  const from = Date.parse($("#date-from").value), to = Date.parse($("#date-to").value);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) { setError("Choose a valid start and end date in chronological order."); showModal(); return; }
  state.custom = { from, to: to + 59_999 }; state.range = "custom"; state.page = 1; render();
});
$("#metric-select").addEventListener("change", event => { state.metric = event.target.value; state.hoveredIndex = -1; render(); });
$("#event-search").addEventListener("input", event => { state.search = event.target.value; state.page = 1; renderEvents(activeRange()); });
$("#prev-page").addEventListener("click", () => { state.page--; renderEvents(activeRange()); });
$("#next-page").addEventListener("click", () => { state.page++; renderEvents(activeRange()); });
$("#export-button").addEventListener("click", downloadCsv);
$("#usage-chart").addEventListener("mousemove", event => {
  const points = event.currentTarget._chartPoints || []; if (!points.length) return;
  const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left;
  state.hoveredIndex = points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0);
  renderChart(activeRange());
});
$("#usage-chart").addEventListener("mouseleave", () => { state.hoveredIndex = -1; renderChart(activeRange()); });
window.addEventListener("resize", () => renderChart(activeRange()));

try {
  const saved = await usageStore.load();
  if (saved?.events?.length) {
    state.events = saved.events; state.sourceName = saved.sourceName || "Saved dataset"; state.sourceRows = saved.sourceRows || saved.events.length; state.skippedRows = saved.skippedRows || 0; state.range = "all"; $("#range-select").value = "all";
  }
} catch (error) { console.warn("Browser storage unavailable:", error); }
render();