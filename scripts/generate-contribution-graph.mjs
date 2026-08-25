import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USERNAME ? process.env.PROFILE_USERNAME : "onelrian";
const response = await fetch(`https://github.com/users/${username}/contributions`, {
  headers: { "user-agent": "onelrian-profile-graph-generator" },
});

if (!response.ok) {
  throw new Error(`GitHub contribution calendar returned ${response.status}`);
}

const html = await response.text();
const totalMatch = html.match(/<h2[^>]*>\s*([0-9,]+)\s*contributions\s*in the last year/i);
const total = totalMatch ? Number(totalMatch[1].replaceAll(",", "")) : 0;
const dayTags = html.match(/<td[^>]*ContributionCalendar-day[^>]*>/g);
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
    .replaceAll("\"", "&quot;");
}

for (const tag of dayTags ? dayTags : []) {
  const date = attr(tag, "data-date");
  const id = attr(tag, "id");
  const level = Number(attr(tag, "data-level")) ? Number(attr(tag, "data-level")) : 0;
  const match = id.match(/contribution-day-component-(\d+)-(\d+)/);
  if (!date || !match) continue;

  const weekday = Number(match[1]);
  const weekIndex = Number(match[2]);
  if (!byWeek.has(weekIndex)) byWeek.set(weekIndex, []);
  byWeek.get(weekIndex).push({ date, weekday, level });
}

const weeks = [...byWeek.entries()]
  .sort(([a], [b]) => a - b)
  .map(([, days]) => days.sort((a, b) => a.weekday - b.weekday));

if (!weeks.length) {
  throw new Error("No contribution cells found");
}

const cell = 12;
const gap = 4;
const left = 36;
const top = 48;
const width = left + 53 * (cell + gap) + 28;
const height = 176;
const colors = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const cells = [];

weeks.forEach((days, weekIndex) => {
  days.forEach((day) => {
    const x = left + weekIndex * (cell + gap);
    const y = top + day.weekday * (cell + gap);
    const color = colors[day.level] ? colors[day.level] : colors[0];
    const title = escapeXml(`${day.date}: contribution level ${day.level}`);
    cells.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${color}"><title>${title}</title></rect>`);
  });
});

const labels = [];
let previousMonth = "";

weeks.forEach((days, index) => {
  const firstDay = days[0];
  if (!firstDay) return;
  const month = new Date(`${firstDay.date}T00:00:00Z`).toLocaleString("en", {
    month: "short",
    timeZone: "UTC",
  });
  if (month !== previousMonth) {
    labels.push(`<text x="${left + index * (cell + gap)}" y="28" class="label">${month}</text>`);
    previousMonth = month;
  }
});

const subtitle = `${total.toLocaleString("en-US")} contributions in the last year`;
const generatedAt = new Date().toISOString().slice(0, 10);
const svg = [
  `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">`,
  `  <title id="title">${username} contribution graph</title>`,
  `  <desc id="desc">${escapeXml(subtitle)}. Generated ${generatedAt} from GitHub public contribution calendar.</desc>`,
  `  <style>.title{fill:#c9d1d9;font:600 16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.label{fill:#8b949e;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.meta{fill:#8b949e;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>`,
  `  <rect width="${width}" height="${height}" rx="12" fill="#0d1117"/>`,
  `  <text x="${left}" y="20" class="title">Contribution Graph</text>`,
  `  ${labels.join("\n  ")}`,
  `  <text x="8" y="76" class="label">Mon</text>`,
  `  <text x="8" y="108" class="label">Wed</text>`,
  `  <text x="8" y="140" class="label">Fri</text>`,
  `  ${cells.join("\n  ")}`,
  `  <text x="${left}" y="${height - 16}" class="meta">${escapeXml(subtitle)} - refreshed hourly</text>`,
  `</svg>`,
  "",
].join("\n");

await mkdir("assets", { recursive: true });
await writeFile("assets/contribution-graph.svg", svg, "utf8");
console.log(`Wrote assets/contribution-graph.svg for ${username}`);
