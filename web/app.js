"use strict";
const byId = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat("en-US");
const number = (value, decimals = 2) => value === null ? "—" : value.toFixed(decimals);
const formatP = (value) => value === null ? "—" : value < .001 ? value.toExponential(2) : value.toFixed(4);
const asPercent = (value) => value === null ? "—" : number(value) + "%";
const labels = {
  b_cell: "B cells", cd8_t_cell: "CD8 T cells", cd4_t_cell: "CD4 T cells",
  nk_cell: "NK cells", monocyte: "Monocytes",
  yes: "Responders", no: "Non-responders", F: "Female", M: "Male", unknown: "Unknown",
};
const escape = (value) => String(value ?? "—").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const pageSize = 25;
let dashboard;
let frequencies;
let page = 0;

async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Could not load " + path);
  return response.json();
}

function table(headers, rows, numeric = [], highlight = -1) {
  const heading = headers.map((name, i) =>
    `<th scope="col" class="${numeric.includes(i) ? "number" : ""}">${escape(name)}</th>`).join("");
  const body = rows.map((row) => "<tr>" + row.map((value, i) =>
    `<td class="${numeric.includes(i) ? "number" : ""} ${i === highlight && value === "Significant" ? "signal" : ""}">${escape(value)}</td>`
  ).join("") + "</tr>").join("");
  const empty = `<tr><td colspan="${headers.length}">No matching rows.</td></tr>`;
  return `<table><thead><tr>${heading}</tr></thead><tbody>${body || empty}</tbody></table>`;
}

function metric(label, value, tone = "neutral") {
  return `<div class="metric ${tone}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
}

function drawPlot(results) {
  const extrema = results.flatMap((result) => [result.yes, result.no]).filter(Boolean);
  const observedMax = Math.max(0, ...extrema.flatMap((box) => [box.max, ...box.outliers]));
  const step = observedMax > 60 ? 20 : observedMax > 30 ? 10 : 5;
  const width = 6 * step;
  const x = (value) => (100 * value / width).toFixed(5);
  const ticks = Array.from({length: 7}, (_, i) =>
    `<span style="left:${x(i * step)}%">${i * step}%</span>`).join("");
  const rows = results.map((result) => {
    const tracks = ["yes", "no"].map((group) => {
      const box = result[group];
      if (!box) return '<div class="track"></div>';
      const label = labels[result.population] + ", " + labels[group];
      const detail = label + " · median " + asPercent(box.median) +
        " · quartiles " + asPercent(box.q1) + " to " + asPercent(box.q3) +
        " · whiskers " + asPercent(box.min) + " to " + asPercent(box.max);
      const medianPosition = box.q3 === box.q1 ? 50 : 100 * (box.median - box.q1) / (box.q3 - box.q1);
      const outliers = box.outliers.map((value) =>
        `<i class="outlier" style="left:${x(value)}%" aria-hidden="true"></i>`).join("");
      return `<div class="track ${group}">
        <i class="whisker" style="left:${x(box.min)}%;width:${x(box.max - box.min)}%" aria-hidden="true"></i>
        <button class="box" type="button" style="left:${x(box.q1)}%;width:${x(box.q3 - box.q1)}%"
          title="${escape(detail)}" aria-label="${escape(detail)}"><i class="median" style="left:${medianPosition}%" aria-hidden="true"></i></button>
        ${outliers}</div>`;
    }).join("");
    return `<div class="chart-row"><strong>${labels[result.population]}</strong><div class="plot-tracks">${tracks}</div></div>`;
  }).join("");
  byId("plot").innerHTML = `<div class="chart-axis"><span></span><div class="ticks">${ticks}</div></div>${rows}`;
  byId("box-detail").textContent = "Select a box to see its median, quartiles and whiskers.";
}

function renderResponse() {
  const visit = byId("visits").value;
  const results = dashboard.comparison[visit];
  const signals = results.filter((result) => result.significant);
  const nYes = Math.max(...results.map((result) => result.n_yes));
  const nNo = Math.max(...results.map((result) => result.n_no));
  byId("response-metrics").innerHTML =
    metric("Responder subjects", integer.format(nYes), "yes") +
    metric("Non-responder subjects", integer.format(nNo), "no") +
    metric("Significant populations", signals.length + " of " + results.length);
  byId("chart-description").textContent = visit === "all"
    ? "Each subject contributes their mean percentage across eligible visits."
    : "Each subject contributes their mean percentage across eligible time-zero samples.";
  byId("significance").textContent = signals.length
    ? signals.map((result) => labels[result.population] +
        (result.rank_biserial > 0 ? " trend higher" : " trend lower") +
        " in responders (adjusted p = " + formatP(result.p_adjusted) + ")").join(". ") + "."
    : "No population reached the Holm-adjusted significance threshold of " + dashboard.alpha + ".";
  drawPlot(results);
  byId("stats").innerHTML = table(
    ["Population", "Yes n", "No n", "Yes median", "No median", "Median Δ (pp)", "U", "Rank-biserial", "Raw p", "Holm p", "Result"],
    results.map((r) => [
      labels[r.population], r.n_yes, r.n_no, asPercent(r.yes?.median ?? null), asPercent(r.no?.median ?? null),
      number(r.median_difference), number(r.u, 1), number(r.rank_biserial, 3), formatP(r.p), formatP(r.p_adjusted),
      r.significant === null ? "Unavailable" : r.significant ? "Significant" : "Not significant",
    ]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9], 10,
  );
}

function renderFrequencies() {
  if (!frequencies) return;
  const sample = byId("sample-filter").value.trim().toLowerCase();
  const population = byId("population-filter").value;
  const filtered = frequencies.filter((row) => row[0].toLowerCase().includes(sample) && (!population || row[2] === population));
  const start = page * pageSize;
  const rows = filtered.slice(start, start + pageSize).map(([id, total, kind, count, percentage]) =>
    [id, integer.format(total), kind, integer.format(count), asPercent(percentage)]);
  byId("frequency-table").innerHTML = table(
    ["sample", "total_count", "population", "count", "percentage"], rows, [1, 3, 4]);
  byId("row-count").textContent = filtered.length
    ? `${integer.format(start + 1)}–${integer.format(start + rows.length)} of ${integer.format(filtered.length)} rows`
    : "0 rows";
  byId("previous").disabled = page === 0;
  byId("next").disabled = start + pageSize >= filtered.length;
}

function renderBaseline() {
  const base = dashboard.baseline;
  const average = base.average_b_cell;
  const subjectCount = Object.values(base.response).reduce((sum, n) => sum + n, 0);
  byId("baseline-metrics").classList.add("two");
  byId("baseline-metrics").innerHTML =
    metric("Baseline samples / subjects", integer.format(base.samples.length) + " / " + integer.format(subjectCount)) +
    metric("Mean B-cell count · male melanoma responders at time 0", number(average.mean)) +
    `<p class="note" style="grid-column: 1 / -1">B-cell mean uses all sample and treatment types (${integer.format(average.samples)} samples).</p>`;
  const summaries = [
    ["Samples by project", "Project", base.projects],
    ["Subjects by response", "Response", {yes: 0, no: 0, ...base.response}],
    ["Subjects by sex", "Sex", {M: 0, F: 0, ...base.sex}],
  ];
  byId("breakdowns").innerHTML = summaries.map(([title, group, counts]) =>
    `<div class="panel"><h3>${title}</h3><div class="table-scroll">${table([group, "Count"],
      Object.entries(counts).map(([key, value]) => [labels[key] ?? key, integer.format(value)]), [1])}</div></div>`
  ).join("");
  renderInventory();
}

function renderInventory() {
  const headers = ["Sample", "Project", "Subject", "Condition", "Age", "Sex", "Treatment", "Response", "Sample type", "Time"];
  const keys = ["sample", "project", "subject", "condition", "age", "sex", "treatment", "response",
    "sample_type", "time_from_treatment_start"];
  const project = byId("project-filter").value;
  const rows = dashboard.baseline.samples.filter((row) => !project || row.project === project)
    .map((row) => keys.map((key) => row[key]));
  byId("baseline-table").innerHTML = table(headers, rows, [4, 9]);
  byId("baseline-count").textContent = integer.format(rows.length) + " matching samples";
}

function addOptions(id, values) {
  for (const value of values) byId(id).add(new Option(value, value));
}

async function showView() {
  const sections = ["response", "frequencies", "baseline"];
  const hash = location.hash.slice(1);
  const active = sections.includes(hash) ? hash : "response";
  for (const id of sections) {
    byId(id).hidden = id !== active;
    const link = document.querySelector(`nav a[href="#${id}"]`);
    if (id === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (active === "frequencies" && !frequencies) {
    const container = byId("frequency-table");
    container.textContent = "Loading frequencies…";
    try {
      frequencies = await readJson("frequencies.json");
      renderFrequencies();
    } catch (error) {
      container.textContent = "Could not load sample frequencies. Reload the page to retry.";
    }
  }
}

async function start() {
  byId("status").textContent = "Loading analysis…";
  try {
    dashboard = await readJson("dashboard.json");
    byId("dataset").textContent = integer.format(dashboard.sample_count) + " samples · " +
      integer.format(dashboard.subject_count) + " subjects";
    addOptions("population-filter", dashboard.populations);
    addOptions("project-filter", Object.keys(dashboard.baseline.projects));
    renderResponse();
    renderBaseline();
    byId("visits").addEventListener("change", renderResponse);
    byId("plot").addEventListener("click", (event) => {
      const box = event.target.closest(".box");
      if (box) byId("box-detail").textContent = box.title;
    });
    byId("project-filter").addEventListener("change", renderInventory);
    for (const [id, event] of [["sample-filter", "input"], ["population-filter", "change"]]) {
      byId(id).addEventListener(event, () => { page = 0; renderFrequencies(); });
    }
    byId("previous").addEventListener("click", () => { page--; renderFrequencies(); });
    byId("next").addEventListener("click", () => { page++; renderFrequencies(); });
    addEventListener("hashchange", showView);
    byId("status").textContent = "";
    await showView();
  } catch (error) {
    byId("status").textContent = "Could not load the analysis. Check the pipeline output and reload.";
  }
}

start();
