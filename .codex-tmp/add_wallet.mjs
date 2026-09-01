import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourcePath = "/Users/nikitavoronin/Downloads/ezzie/CSV_finals/final_1940.csv";
const outputDir = "/Users/nikitavoronin/Downloads/code26/trait_generator/outputs/wallet_add_1940";
const wallet = "0x86e4f8c77e4eb36047939d830e4e26c817f91e91";

const csvText = await fs.readFile(sourcePath, "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Wallets" });
const sheet = workbook.worksheets.getItem("Wallets");
const used = sheet.getUsedRange(true);
const existingRows = used.values;
const matches = existingRows.filter((row) => String(row[0] ?? "").toLowerCase() === wallet.toLowerCase());
if (matches.length > 0) throw new Error(`Wallet already exists (${matches.length} match(es))`);

await fs.mkdir(outputDir, { recursive: true });
const before = await workbook.render({
  sheetName: "Wallets",
  range: "A13448:C13456",
  scale: 1.5,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "before.png"), new Uint8Array(await before.arrayBuffer()));

const newRow = existingRows.length + 1;
sheet.getRange(`A${newRow}:C${newRow}`).values = [[wallet, "", ""]];

const check = await workbook.inspect({
  kind: "table",
  range: `Wallets!A${newRow - 4}:C${newRow}`,
  include: "values,formulas",
  tableMaxRows: 5,
  tableMaxCols: 3,
  maxChars: 3000,
});
console.log(check.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const after = await workbook.render({
  sheetName: "Wallets",
  range: `A${newRow - 4}:C${newRow}`,
  scale: 1.5,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "after.png"), new Uint8Array(await after.arrayBuffer()));

const newline = csvText.endsWith("\n") ? "" : "\n";
await fs.writeFile(path.join(outputDir, "final_1940.csv"), `${csvText}${newline}${wallet},,\n`, "utf8");
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(path.join(outputDir, "final_1940.xlsx"));

console.log(JSON.stringify({ newRow, outputDir, sourceRows: existingRows.length, finalRows: existingRows.length + 1 }));
