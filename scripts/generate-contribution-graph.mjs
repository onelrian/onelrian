import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USERNAME || "onelrian";

// ── Fetch contribution calendar HTML ──────────────────────────────────
const response = await fetch(`https://github.com/users/${username}/contributions`, {
  headers: { "user-agent": "onelrian-profile-graph-generator" },
});
if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
const html = await response.text();

// ── Parse daily levels ───────────────────────────────────────────────
const totalMatch = html.match(/<h2[^>]*>\s*([0-9,]+)\s*contributions\s*in the last year/i);
const total = totalMatch ? Number(totalMatch[1].replaceAll(",", "")) : 0;
const dayTags = html.match(/<td[^>]*ContributionCalendar-day[^>]*>/g) || [];
const byWeek = new Map();

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : "";
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const days = [];
for (const tag of dayTags) {
  const date = attr(tag, "data-date");
  const id = attr(tag, "id");
  const level = Number(attr(tag, "data-level")) || 0;
  const match = id.match(/contribution-day-component-(\d+)-(\d+)/);
  if (!date || !match) continue;
  const weekday = Number(match[1]);
  const weekIndex = Number(match[2]);
  if (!byWeek.has(weekIndex)) byWeek.set(weekIndex, []);
  byWeek.get(weekIndex).push({ date, weekday, level });
  days.push({ date, level });
}

const weeks = [...byWeek.entries()]
  .sort(([a], [b]) => a - b)
  .map(([, d]) => d.sort((a, b) => a.weekday - b.weekday));

if (!weeks.length) throw new Error("No contribution cells found");

// Map levels to estimated counts (GitHub uses these thresholds)
const levelToCount = [0, 2, 5, 8, 12];
const counts = days.map((d) => levelToCount[d.level] || 0);

// ── Line chart: exact Vercel replica ─────────────────────────────────
function catmullRom2bezier(points, tension = 0.4) {
  if (points.length < 2) return "";
  const d = [`M${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / (6 / tension);
    const cp1y = p1.y + (p2.y - p0.y) / (6 / tension);
    const cp2x = p2.x - (p3.x - p1.x) / (6 / tension);
    const cp2y = p2.y - (p3.y - p1.y) / (6 / tension);
    d.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
  }
  return d.join(" ");
}

const LW = 1200, LH = 420;
const LPAD = { top: 80, right: 50, bottom: 50, left: 70 };
const cW = LW - LPAD.left - LPAD.right;
const cH = LH - LPAD.top - LPAD.bottom;
const maxVal = Math.max(...counts, 1);

const pts = counts.map((v, i) => ({
  x: LPAD.left + (i / Math.max(counts.length - 1, 1)) * cW,
  y: LPAD.top + cH - (v / maxVal) * cH,
}));

const linePath = catmullRom2bezier(pts);
const areaPath = linePath + ` L${pts[pts.length - 1].x},${LPAD.top + cH} L${pts[0].x},${LPAD.top + cH} Z`;

// Month labels — pick ~12 evenly spaced
const monthLabels = [];
let prevMonth = "";
const step = Math.max(1, Math.floor(days.length / 12));
for (let i = 0; i < days.length; i += step) {
  const m = new Date(`${days[i].date}T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" });
  if (m !== prevMonth) {
    monthLabels.push({ x: LPAD.left + (i / Math.max(days.length - 1, 1)) * cW, label: m });
    prevMonth = m;
  }
}

// Y-axis ticks
const yTicks = [];
const yStep = Math.max(1, Math.ceil(maxVal / 5));
for (let v = 0; v <= maxVal; v += yStep) {
  yTicks.push({ y: LPAD.top + cH - (v / maxVal) * cH, label: String(v) });
}

const lineSvg = `<svg width="${LW}" height="${LH}" viewBox="0 0 ${LW} ${LH}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    svg { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; }
    .line-title { font: 600 20px 'Segoe UI', Ubuntu, Sans-Serif; fill: #58a6ff; }
    .axis-label { font-size: 12px; fill: #58a6ff; }
    .grid-line { stroke: #58a6ff; stroke-width: 1px; stroke-opacity: 0.3; stroke-dasharray: 2px; }
    .data-line { stroke: #58a6ff; stroke-width: 4px; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .data-area { fill: #26a641; fill-opacity: 0.1; stroke: none; }
    .data-point { stroke: #c9d1d9; stroke-width: 10px; stroke-linecap: round; fill: none; }
  </style>
  <rect width="${LW}" height="${LH}" rx="16" fill="#0d1117" stroke="#8b949e" stroke-width="1"/>
  <text x="${LPAD.left}" y="40" class="line-title">${escapeXml(username)}'s Contribution Graph</text>
  ${yTicks.map((t) => `<line x1="${LPAD.left}" y1="${t.y}" x2="${LW - LPAD.right}" y2="${t.y}" class="grid-line"/><text x="${LPAD.left - 10}" y="${t.y + 4}" class="axis-label" text-anchor="end">${t.label}</text>`).join("\n  ")}
  ${monthLabels.map((m) => `<text x="${m.x}" y="${LH - LPAD.bottom + 20}" class="axis-label" text-anchor="middle">${m.label}</text>`).join("\n  ")}
  <path d="${areaPath}" class="data-area"/>
  <path d="${linePath}" class="data-line"/>
  ${counts.length <= 120 ? pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" class="data-point"/>`).join("\n  ") : ""}
</svg>
`;

// ── Grid heatmap: fixed spacing (no overlap) ─────────────────────────
const cell = 13;
const gap = 3;
const gLeft = 44;
const gTop = 60;
const gWidth = gLeft + 53 * (cell + gap) + 28;
const gHeight = 210;
const gridColors = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const cells = [];

weeks.forEach((weekDays, wi) => {
  weekDays.forEach((d) => {
    const x = gLeft + wi * (cell + gap);
    const y = gTop + d.weekday * (cell + gap);
    cells.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${gridColors[d.level]}" stroke="#30363d" stroke-width="1"><title>${escapeXml(d.date)}: level ${d.level}</title></rect>`);
  });
});

const gLabels = [];
let pm = "";
weeks.forEach((weekDays, i) => {
  const first = weekDays[0];
  if (!first) return;
  const m = new Date(`${first.date}T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" });
  if (m !== pm) {
    gLabels.push(`<text x="${gLeft + i * (cell + gap)}" y="44" class="glabel">${m}</text>`);
    pm = m;
  }
});

const subtitle = `${total.toLocaleString("en-US")} contributions in the last year`;
const gridSvg = `<svg width="${gWidth}" height="${gHeight}" viewBox="0 0 ${gWidth} ${gHeight}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="gtitle gdesc">
  <title id="gtitle">${username} contribution graph</title>
  <desc id="gdesc">${escapeXml(subtitle)}. Generated ${new Date().toISOString().slice(0, 10)} from GitHub public contribution calendar.</desc>
  <style>
    .gtitle { fill: #f0f6fc; font: 700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .glabel { fill: #8b949e; font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .gmeta { fill: #8b949e; font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  </style>
  <rect width="${gWidth}" height="${gHeight}" rx="10" fill="#0d1117"/>
  <text x="${gLeft}" y="24" class="gtitle">Contribution Graph</text>
  ${gLabels.join("\n  ")}
  <text x="8" y="${gTop + 12}" class="glabel">Mon</text>
  <text x="8" y="${gTop + 12 + 2 * (cell + gap)}" class="glabel">Wed</text>
  <text x="8" y="${gTop + 12 + 4 * (cell + gap)}" class="glabel">Fri</text>
  ${cells.join("\n  ")}
  <text x="${gLeft}" y="${gHeight - 8}" class="gmeta">${escapeXml(subtitle)} - refreshed hourly</text>
</svg>
`;

// ── Write both SVGs ──────────────────────────────────────────────────
await mkdir("assets", { recursive: true });
await Promise.all([
  writeFile("assets/contribution-line-chart.svg", lineSvg, "utf8"),
  writeFile("assets/contribution-grid.svg", gridSvg, "utf8"),
]);
console.log(`Wrote assets/contribution-line-chart.svg and assets/contribution-grid.svg for ${username}`);
