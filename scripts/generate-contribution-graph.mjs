import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USERNAME || "onelrian";

// ── Fetch contribution calendar HTML ──────────────────────────────────
const response = await fetch(`https://github.com/users/${username}/contributions`, {
  headers: { "user-agent": "onelrian-profile-graph-generator" },
});
if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
const html = await response.text();

// ── Parse ALL daily levels ────────────────────────────────────────────
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

const allDays = [];
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
  allDays.push({ date, level });
}

// ── Last 30 days ─────────────────────────────────────────────────────
const last30 = allDays.slice(-30);
const levelToCount = [0, 2, 5, 8, 12];
const counts = last30.map((d) => levelToCount[d.level] || 0);

// ── Monotone cubic interpolation (D3-style, no overshoot) ────────────
function monotoneCubic(pts) {
  if (pts.length < 2) return "";
  const n = pts.length;
  const dx = [], dy = [], m = [], ms = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    dy.push(pts[i + 1].y - pts[i].y);
    m.push(dy[i] / (dx[i] || 1));
  }
  ms.push(m[0]);
  for (let i = 1; i < n - 1; i++) {
    ms.push((m[i - 1] + m[i]) / 2);
  }
  ms.push(m[n - 2]);

  // Adjust tangents for monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-6) {
      ms[i] = 0;
      ms[i + 1] = 0;
    } else {
      const a = ms[i] / m[i];
      const b = ms[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        ms[i] = t * a * m[i];
        ms[i + 1] = t * b * m[i];
      }
    }
  }

  const d = [`M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`];
  for (let i = 0; i < n - 1; i++) {
    const cp1x = pts[i].x + dx[i] / 3;
    const cp1y = pts[i].y + ms[i] * dx[i] / 3;
    const cp2x = pts[i + 1].x - dx[i] / 3;
    const cp2y = pts[i + 1].y - ms[i + 1] * dx[i] / 3;
    d.push(`C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`);
  }
  return d.join(" ");
}

// ── LINE CHART: GitHub dark mode, modern smooth ──────────────────────
const LW = 960, LH = 280;
const LPAD = { top: 50, right: 30, bottom: 44, left: 50 };
const cW = LW - LPAD.left - LPAD.right;
const cH = LH - LPAD.top - LPAD.bottom;
const maxVal = Math.max(...counts, 1);

const pts = counts.map((v, i) => ({
  x: LPAD.left + (i / Math.max(counts.length - 1, 1)) * cW,
  y: LPAD.top + cH - (v / maxVal) * cH,
}));

const linePath = monotoneCubic(pts);
const areaPath = linePath + ` L${pts[pts.length - 1].x},${LPAD.top + cH} L${pts[0].x},${LPAD.top + cH} Z`;

// X-axis: day labels for every 5th day
const xLabels = [];
last30.forEach((d, i) => {
  if (i % 5 === 0 || i === last30.length - 1) {
    const dt = new Date(`${d.date}T00:00:00Z`);
    const label = `${dt.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${dt.getUTCDate()}`;
    xLabels.push({ x: pts[i].x, label });
  }
});

// Y-axis ticks
const yTicks = [];
const yStep = Math.max(1, Math.ceil(maxVal / 4));
for (let v = 0; v <= maxVal; v += yStep) {
  yTicks.push({ y: LPAD.top + cH - (v / maxVal) * cH, label: String(v) });
}

const lineSvg = `<svg width="${LW}" height="${LH}" viewBox="0 0 ${LW} ${LH}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#58a6ff" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <style>
    svg { font: 500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .title { font: 600 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #e6edf3; }
    .sub { font: 400 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #7d8590; }
    .ax { fill: #7d8590; }
    .grid { stroke: #21262d; stroke-width: 1; }
  </style>
  <rect width="${LW}" height="${LH}" rx="12" fill="#0d1117"/>
  <text x="${LPAD.left}" y="28" class="title">Contribution Activity</text>
  <text x="${LPAD.left}" y="42" class="sub">Last 30 days</text>
  ${yTicks.map((t) => `<line x1="${LPAD.left}" y1="${t.y}" x2="${LW - LPAD.right}" y2="${t.y}" class="grid"/><text x="${LPAD.left - 8}" y="${t.y + 3.5}" class="ax" text-anchor="end">${t.label}</text>`).join("\n  ")}
  ${xLabels.map((l) => `<text x="${l.x}" y="${LH - LPAD.bottom + 16}" class="ax" text-anchor="middle">${l.label}</text>`).join("\n  ")}
  <path d="${areaPath}" fill="url(#areaGrad)"/>
  <path d="${linePath}" stroke="#58a6ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" filter="url(#glow)"/>
  ${pts.map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="#0d1117" stroke="#58a6ff" stroke-width="1.5"/>`).join("\n  ")}
</svg>
`;

// ── GRID: Last 30 days, modern GitHub dark mode ──────────────────────
// Show as a compact grid: ~5 weeks x 7 days
const gCell = 16;
const gGap = 4;
const gLeft = 40;
const gTop = 56;
// 30 days = ~5 weeks
const numWeeks = Math.ceil(last30.length / 7);
const gWidth = gLeft + numWeeks * (gCell + gGap) + 16;
const gHeight = gTop + 7 * (gCell + gGap) + 28;

// Modern GitHub dark mode greens — subtle, smooth transitions
const gridColors = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const gCells = [];

// Rebuild week structure for last 30 days only
const gByWeek = new Map();
last30.forEach((d, i) => {
  const wi = Math.floor(i / 7);
  const di = i % 7;
  if (!gByWeek.has(wi)) gByWeek.set(wi, []);
  gByWeek.get(wi).push({ ...d, weekday: di });
});

gByWeek.forEach((weekDays, wi) => {
  weekDays.forEach((d) => {
    const x = gLeft + wi * (gCell + gGap);
    const y = gTop + d.weekday * (gCell + gGap);
    gCells.push(`<rect x="${x}" y="${y}" width="${gCell}" height="${gCell}" rx="4" fill="${gridColors[d.level]}" fill-opacity="${d.level === 0 ? 0.6 : 1}"><title>${escapeXml(d.date)}: level ${d.level}</title></rect>`);
  });
});

// Month labels
const gLabels = [];
let pm2 = "";
gByWeek.forEach((weekDays, wi) => {
  const first = weekDays[0];
  if (!first) return;
  const m = new Date(`${first.date}T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" });
  if (m !== pm2) {
    gLabels.push(`<text x="${gLeft + wi * (gCell + gGap)}" y="38" class="gl">${m}</text>`);
    pm2 = m;
  }
});

const gridSvg = `<svg width="${gWidth}" height="${gHeight}" viewBox="0 0 ${gWidth} ${gHeight}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Contribution grid">
  <style>
    .gt { font: 600 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #e6edf3; }
    .gs { font: 400 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #7d8590; }
    .gl { fill: #7d8590; font: 500 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
  <rect width="${gWidth}" height="${gHeight}" rx="10" fill="#0d1117"/>
  <text x="${gLeft}" y="22" class="gt">Contributions</text>
  <text x="${gLeft}" y="36" class="gs">${total.toLocaleString("en-US")} in the last year</text>
  ${gLabels.join("\n  ")}
  ${gCells.join("\n  ")}
  <text x="${gLeft}" y="${gHeight - 6}" class="gs">Less ${gridColors.slice(1).map((c) => `<tspan fill="${c}" font-size="14">■</tspan>`).join(" ")} More</text>
</svg>
`;

// ── Write both SVGs ──────────────────────────────────────────────────
await mkdir("assets", { recursive: true });
await Promise.all([
  writeFile("assets/contribution-line-chart.svg", lineSvg, "utf8"),
  writeFile("assets/contribution-grid.svg", gridSvg, "utf8"),
]);
console.log(`Wrote assets/contribution-line-chart.svg and assets/contribution-grid.svg for ${username}`);
