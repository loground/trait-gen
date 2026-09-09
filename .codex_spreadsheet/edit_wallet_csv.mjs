import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const [mode, inputPath, outputDir, wallet] = process.argv.slice(2);
const csvText = await fs.readFile(inputPath, "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Wallets" });
const sheet = workbook.worksheets.getItem("Wallets");
const sourceRows = csvText
  .replace(/\r\n/g, "\n")
  .replace(/\n$/, "")
  .split("\n")
  .map((line) => line.split(","));
const workbookRows = sourceRows.map((row, index) => [index === 0 ? row[0] : `'${row[0]}`, row[1], row[2]]);
sheet.getRange(`A1:C${workbookRows.length}`).values = workbookRows;
const used = sheet.getUsedRange(true);
const values = used.values;

if (mode === "inspect") {
  const top = await workbook.inspect({
    kind: "table",
    sheetId: "Wallets",
    range: "A1:C8",
    include: "values,formulas",
    tableMaxRows: 8,
    tableMaxCols: 3,
  });
  console.log(top.ndjson);
  console.log(JSON.stringify({ rows: values.length, columns: values[0]?.length ?? 0 }));
  await fs.mkdir(outputDir, { recursive: true });
  const preview = await workbook.render({
    sheetName: "Wallets",
    range: "A1:C8",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(`${outputDir}/before.png`, new Uint8Array(await preview.arrayBuffer()));
  process.exit(0);
}

if (mode !== "edit" || !wallet) throw new Error("Usage: edit <input> <outputDir> <wallet>");
const normalized = wallet.toLowerCase();
const duplicate = sourceRows.slice(1).some((row) => String(row[0] ?? "").toLowerCase() === normalized);
if (duplicate) throw new Error(`Wallet already exists: ${wallet}`);

const newRowNumber = values.length + 1;
sheet.getRange(`A${newRowNumber}:C${newRowNumber}`).values = [[`'${wallet}`, "", ""]];

const check = await workbook.inspect({
  kind: "table",
  sheetId: "Wallets",
  range: `A${newRowNumber - 2}:C${newRowNumber}`,
  include: "values,formulas",
  tableMaxRows: 3,
  tableMaxCols: 3,
});
console.log(check.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({
  sheetName: "Wallets",
  range: `A${newRowNumber - 2}:C${newRowNumber}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(`${outputDir}/after.png`, new Uint8Array(await preview.arrayBuffer()));

const finalValues = [...sourceRows, [wallet, "", ""]];
const escapeCsv = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const outputCsv = finalValues.map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
await fs.writeFile(`${outputDir}/final_2154.csv`, outputCsv, "utf8");

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(`${outputDir}/final_2154.xlsx`);
console.log(JSON.stringify({ outputRows: finalValues.length, appendedRow: newRowNumber, wallet }));
