import { readFileSync } from "node:fs";
import { compareReports } from "./report-comparison.mjs";
const args = process.argv.slice(2);
if (args.length !== 2) throw new Error("Usage: npm run benchmark:compare -- left-report.json right-report.json");
const result = compareReports(...args.map(path => JSON.parse(readFileSync(path, "utf8"))));
console.log(result.left + " -> " + result.right + ": " + result.pairedCases + " paired cases, " +
    result.bothCompleted + " completed pairs, " + result.pairsWithoutMetrics + " pairs without comparable metrics.");
console.table(result.deltas);
if (result.failures.length) console.table(result.failures.map(({ delta, ...rest }) => rest));
console.log(result.interpretation);
