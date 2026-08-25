import { readFile, writeFile } from "node:fs/promises";

const readmePath = "README.md";
const readme = await readFile(readmePath, "utf8");
const updated = readme.replace(
  /<img src="https:\/\/activity-graph-deploy\.vercel\.app\/graph\?[^\"]+" height="300" alt="Contribution Graph"\/>/,
  "<img src=\"./assets/contribution-graph.svg\" height=\"300\" alt=\"Contribution Graph\"/>",
);

if (updated !== readme) {
  await writeFile(readmePath, updated, "utf8");
  console.log("README now uses the local contribution graph.");
} else {
  console.log("README already uses the local contribution graph.");
}
