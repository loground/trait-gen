import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "/Users/nikitavoronin/Downloads/code26/trait_generator";
const sourcePath = "/Users/nikitavoronin/Downloads/ezzie/website_wls.txt";
const behaviorPath = `${root}/output/robinhood_testnet_behavior.json`;
const checkpointPath = `${root}/output/robinhood_wallet_rpc_audit.csv.checkpoint.json`;
const outputDir = `${root}/outputs/robinhood_wallet_audit`;

const addresses = (await fs.readFile(sourcePath, "utf8"))
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);
const behavior = JSON.parse(await fs.readFile(behaviorPath, "utf8"));
const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
const behaviorByAddress = new Map(behavior.map((row) => [row.address, row]));

function normalize(address) {
  return address.replace(/^0X/, "0x").toLowerCase();
}

function structuralFlag(address) {
  const normalized = normalize(address);
  if (BigInt(normalized) <= 0xffffn) return "synthetic_low_address";
  if (/^0x([0-9a-f])\1{39}$/i.test(normalized)) return "synthetic_repeated_character";
  return "";
}

const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: "User" });
const summary = workbook.worksheets.add("Summary");
const activeSheet = workbook.worksheets.add("Active analysis");
const allSheet = workbook.worksheets.add("All wallets");
const rules = workbook.worksheets.add("Rules & sources");

for (const sheet of [summary, activeSheet, allSheet, rules]) sheet.showGridLines = false;

const activeHeaders = [
  "Address (addr: text prefix)", "Testnet nonce", "Sample tx", "Successful tx", "Success rate", "Active days",
  "Sample span, days", "Unique targets", "Unique methods", "Dominant target", "Dominant method",
  "Same-block burst", "Median interval, sec", "Single target", "Single method", "Same block",
  "Machine timing", "High-volume window", "Mostly failed", "Bot signals", "Score", "Decision",
  "Detected signals", "Newest tx", "Oldest sampled tx", "Explorer",
];
activeSheet.getRange(`A2:A${behavior.length + 1}`).format.numberFormat = "@";
activeSheet.getRange(`A1:Z${behavior.length + 1}`).values = [
  activeHeaders,
  ...behavior.map((row) => [
    `addr:${row.address}`,
    row.nonce,
    row.sampleSize,
    row.successful,
    null,
    row.uniqueDays,
    row.spanDays,
    row.uniqueTargets,
    row.uniqueMethods,
    row.dominantToRatio,
    row.dominantMethodRatio,
    row.maxSameBlockRatio,
    row.medianIntervalSeconds,
    null, null, null, null, null, null, null, null, null,
    row.signals.join(" | "),
    row.newestTimestamp ? new Date(row.newestTimestamp) : null,
    row.oldestSampleTimestamp ? new Date(row.oldestSampleTimestamp) : null,
    `https://explorer.testnet.chain.robinhood.com/address/${row.address}`,
  ]),
];

activeSheet.getRange("E2").formulas = [["=IFERROR(D2/C2,0)"]];
activeSheet.getRange(`E2:E${behavior.length + 1}`).fillDown();
const formulaSeeds = {
  N2: "=AND(C2>=10,J2>=0.9)",
  O2: "=AND(C2>=10,K2>=0.9)",
  P2: "=AND(C2>=6,L2>=0.5)",
  Q2: "=AND(C2>=10,M2<=20)",
  R2: "=AND(C2>=20,F2<=2)",
  S2: "=AND(C2>=6,E2<0.5)",
  T2: "=IF(N2,1,0)+IF(O2,1,0)+IF(P2,1,0)+IF(Q2,1,0)+IF(R2,1,0)+IF(S2,1,0)",
  U2: "=MAX(0,MIN(100,20+IF(C2>=3,15,0)+IF(F2>=3,15,0)+IF(G2>=7,10,0)+IF(H2>=3,15,0)+IF(I2>=3,10,0)+IF(E2>=0.8,10,0)-MIN(60,T2*20)))",
  V2: "=IF(OR(T2>=2,L2>=0.8),\"likely_bot\",IF(AND(U2>=65,T2=0,C2>=4,OR(F2>=3,G2>=14)),\"recommend\",\"review\"))",
};
for (const [cell, formula] of Object.entries(formulaSeeds)) {
  const column = cell.replace(/\d/g, "");
  activeSheet.getRange(cell).formulas = [[formula]];
  activeSheet.getRange(`${column}2:${column}${behavior.length + 1}`).fillDown();
}

const allHeaders = [
  "Source line", "Address (addr: text prefix)", "Structural flag", "Testnet nonce", "Outgoing activity",
  "Testnet decision", "Score", "Mainnet scan status", "Mainnet nonce", "Decision reason",
];
const allRows = addresses.map((original, index) => {
  const address = normalize(original);
  const testnet = checkpoint.testnet[address] ?? { nonce: 0 };
  const mainnet = checkpoint.mainnet[address];
  return [
    index + 1,
    `addr:${original}`,
    structuralFlag(original),
    testnet.nonce ?? 0,
    (testnet.nonce ?? 0) > 0 ? "yes" : "no",
    null,
    null,
    mainnet ? "scanned_partial_pass" : "not_scanned_rate_limit",
    mainnet?.nonce ?? null,
    null,
  ];
});
allSheet.getRange(`B2:B${allRows.length + 1}`).format.numberFormat = "@";
allSheet.getRange(`A1:J${allRows.length + 1}`).values = [allHeaders, ...allRows];
const activeEnd = behavior.length + 1;
allSheet.getRange("F2").formulas = [[
  `=IF(C2<>\"\",\"exclude_synthetic\",IF(D2=0,\"exclude_no_activity\",IFERROR(VLOOKUP(LOWER(B2),'Active analysis'!$A$2:$V$${activeEnd},22,FALSE),\"review\")))`,
]];
allSheet.getRange(`F2:F${allRows.length + 1}`).fillDown();
allSheet.getRange("G2").formulas = [[
  `=IFERROR(VLOOKUP(LOWER(B2),'Active analysis'!$A$2:$V$${activeEnd},21,FALSE),0)`,
]];
allSheet.getRange(`G2:G${allRows.length + 1}`).fillDown();
allSheet.getRange("J2").formulas = [[
  "=IF(C2<>\"\",C2,IF(D2=0,\"no signed outgoing testnet activity\",IF(F2=\"recommend\",\"diverse and persistent testnet activity\",IF(F2=\"likely_bot\",\"multiple automation signals\",\"insufficient longevity or one automation signal\"))))",
]];
allSheet.getRange(`J2:J${allRows.length + 1}`).fillDown();

summary.getRange("A1:H2").merge();
summary.getRange("A1").values = [["Robinhood Chain wallet audit"]];
summary.getRange("A3:H3").merge();
summary.getRange("A3").values = [["Complete testnet screening • Mainnet pass is partial because public APIs reached their quota"]];
summary.getRange("A5:B12").values = [
  ["Metric", "Value"],
  ["Source wallets", null],
  ["Testnet outgoing active", null],
  ["Recommended for testnet mint", null],
  ["Manual review", null],
  ["Likely automated", null],
  ["Synthetic/system patterns", null],
  ["Mainnet addresses scanned", null],
];
summary.getRange("B6").formulas = [[`=COUNTA('All wallets'!$B$2:$B$${allRows.length + 1})`]];
summary.getRange("B7").formulas = [[`=COUNTIF('All wallets'!$D$2:$D$${allRows.length + 1},\">0\")`]];
summary.getRange("B8").formulas = [[`=COUNTIF('Active analysis'!$V$2:$V$${activeEnd},\"recommend\")`]];
summary.getRange("B9").formulas = [[`=COUNTIF('Active analysis'!$V$2:$V$${activeEnd},\"review\")`]];
summary.getRange("B10").formulas = [[`=COUNTIF('Active analysis'!$V$2:$V$${activeEnd},\"likely_bot\")`]];
summary.getRange("B11").formulas = [[`=COUNTIF('All wallets'!$C$2:$C$${allRows.length + 1},\"synthetic_low_address\")+COUNTIF('All wallets'!$C$2:$C$${allRows.length + 1},\"synthetic_repeated_character\")`]];
summary.getRange("B12").formulas = [[`=COUNTIF('All wallets'!$H$2:$H$${allRows.length + 1},\"scanned_partial_pass\")`]];

summary.getRange("D5:H5").merge();
summary.getRange("D5").values = [["Decision summary"]];
summary.getRange("D6:H11").merge(true);
summary.getRange("D6:D11").values = [
  ["RECOMMEND — no automation signals, ≥4 sampled transactions, score ≥65, and either ≥3 active days or ≥14-day span."],
  ["REVIEW — real signed activity exists, but history is short, concentrated, or has one automation signal."],
  ["LIKELY BOT — at least two automation signals or ≥80% of the sample was packed into one block."],
  ["NO ACTIVITY — no signed outgoing transaction on Robinhood testnet."],
  ["MAINNET — only the first quota-limited partial pass is recorded; do not treat this workbook as a complete mainnet allowlist."],
  ["A bot label is probabilistic. Review high-value participants manually before committing an irreversible mint allowlist."],
];

rules.getRange("A1:D1").values = [["Rule / source", "Threshold or URL", "Purpose", "Notes"]];
rules.getRange("A2:D15").values = [
  ["Recommend", "score ≥ 65; 0 bot signals; sample ≥ 4; active days ≥ 3 OR span ≥ 14 days", "Mint shortlist", "Strict longevity gate"],
  ["Likely bot", "bot signals ≥ 2 OR same-block burst ≥ 80%", "Exclude or inspect", "Probabilistic, not proof of ownership"],
  ["Single target", "sample ≥ 10 and dominant target ≥ 90%", "Automation signal", ""],
  ["Single method", "sample ≥ 10 and dominant method ≥ 90%", "Automation signal", ""],
  ["Same-block burst", "sample ≥ 6 and same-block share ≥ 50%", "Automation signal", ""],
  ["Machine timing", "sample ≥ 10 and median interval ≤ 20 sec", "Automation signal", ""],
  ["High-volume window", "sample ≥ 20 and active days ≤ 2", "Automation signal", ""],
  ["Mostly failed", "sample ≥ 6 and success rate < 50%", "Automation signal", ""],
  ["Official network docs", "https://docs.robinhood.com/chain/connecting/", "Chain IDs and endpoints", "Mainnet 4663; testnet 46630"],
  ["Official testnet explorer", "https://explorer.testnet.chain.robinhood.com", "Transaction history", "Blockscout"],
  ["Official mainnet explorer", "https://robinhoodchain.blockscout.com", "Partial mainnet scan", "Public quota reached"],
  ["Source list", sourcePath, "12,326 submitted addresses", "XLSX uses addr: prefix; TXT outputs contain clean addresses"],
  ["History sample", "Most recent 50 outgoing transactions", "Behavioral metrics", "Older behavior may not be represented"],
  ["Snapshot date", "2026-08-24", "Reproducibility", "On-chain state changes after this date"],
];

const navy = "#172033";
const blue = "#2563EB";
const lightBlue = "#DBEAFE";
const green = "#DCFCE7";
const yellow = "#FEF3C7";
const red = "#FEE2E2";
const gray = "#F3F4F6";

summary.getRange("A1:H2").format = { fill: navy, font: { color: "#FFFFFF", bold: true, size: 20 }, verticalAlignment: "center" };
summary.getRange("A3:H3").format = { fill: lightBlue, font: { color: "#1E3A8A", italic: true }, verticalAlignment: "center" };
summary.getRange("A5:B5").format = { fill: blue, font: { color: "#FFFFFF", bold: true } };
summary.getRange("A6:A12").format = { fill: gray, font: { bold: true } };
summary.getRange("B6:B12").format = { font: { bold: true, size: 14 }, numberFormat: "#,##0" };
summary.getRange("D5:H5").format = { fill: blue, font: { color: "#FFFFFF", bold: true } };
summary.getRange("D6:H11").format = { fill: "#F8FAFC", wrapText: true, verticalAlignment: "top" };
summary.getRange("A5:B12").format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
summary.getRange("D5:H11").format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
summary.getRange("A1:H12").format.font.name = "Aptos";
summary.getRange("A1:H12").format.rowHeight = 26;
summary.getRange("A1:H2").format.rowHeight = 34;
summary.getRange("A3:H3").format.rowHeight = 24;
summary.getRange("A1:A12").format.columnWidth = 33;
summary.getRange("B1:B12").format.columnWidth = 15;
summary.getRange("C1:C12").format.columnWidth = 3;
summary.getRange("D1:H12").format.columnWidth = 18;
summary.getRange("D6:H11").format.rowHeight = 42;

for (const sheet of [activeSheet, allSheet, rules]) {
  const used = sheet.getUsedRange();
  used.format.font.name = "Aptos";
  used.getRow(0).format = { fill: navy, font: { color: "#FFFFFF", bold: true }, wrapText: true, rowHeight: 32 };
  sheet.freezePanes.freezeRows(1);
}

activeSheet.tables.add(`A1:Z${behavior.length + 1}`, true, "ActiveWalletsTable").style = "TableStyleMedium2";
allSheet.tables.add(`A1:J${allRows.length + 1}`, true, "AllWalletsTable").style = "TableStyleMedium2";
rules.tables.add("A1:D15", true, "RulesTable").style = "TableStyleMedium2";

activeSheet.getRange(`E2:E${activeEnd}`).format.numberFormat = "0.0%";
activeSheet.getRange(`G2:G${activeEnd}`).format.numberFormat = "0.00";
activeSheet.getRange(`J2:L${activeEnd}`).format.numberFormat = "0.0%";
activeSheet.getRange(`M2:M${activeEnd}`).format.numberFormat = "0.00";
activeSheet.getRange(`X2:Y${activeEnd}`).format.numberFormat = "yyyy-mm-dd hh:mm";
activeSheet.getRange(`V2:V${activeEnd}`).conditionalFormats.add("containsText", { text: "recommend", format: { fill: green, font: { color: "#166534", bold: true } } });
activeSheet.getRange(`V2:V${activeEnd}`).conditionalFormats.add("containsText", { text: "review", format: { fill: yellow, font: { color: "#92400E", bold: true } } });
activeSheet.getRange(`V2:V${activeEnd}`).conditionalFormats.add("containsText", { text: "likely_bot", format: { fill: red, font: { color: "#991B1B", bold: true } } });
allSheet.getRange(`F2:F${allRows.length + 1}`).conditionalFormats.add("containsText", { text: "recommend", format: { fill: green, font: { color: "#166534" } } });
allSheet.getRange(`F2:F${allRows.length + 1}`).conditionalFormats.add("containsText", { text: "review", format: { fill: yellow, font: { color: "#92400E" } } });
allSheet.getRange(`F2:F${allRows.length + 1}`).conditionalFormats.add("containsText", { text: "likely_bot", format: { fill: red, font: { color: "#991B1B" } } });

activeSheet.getRange(`A1:A${activeEnd}`).format.columnWidth = 44;
activeSheet.getRange(`B1:V${activeEnd}`).format.columnWidth = 14;
activeSheet.getRange(`W1:W${activeEnd}`).format.columnWidth = 34;
activeSheet.getRange(`X1:Y${activeEnd}`).format.columnWidth = 20;
activeSheet.getRange(`Z1:Z${activeEnd}`).format.columnWidth = 52;
allSheet.getRange(`A1:A${allRows.length + 1}`).format.columnWidth = 12;
allSheet.getRange(`B1:B${allRows.length + 1}`).format.columnWidth = 44;
allSheet.getRange(`C1:C${allRows.length + 1}`).format.columnWidth = 30;
allSheet.getRange(`D1:I${allRows.length + 1}`).format.columnWidth = 20;
allSheet.getRange(`J1:J${allRows.length + 1}`).format.columnWidth = 42;
rules.getRange("A1:A15").format.columnWidth = 24;
rules.getRange("B1:B15").format.columnWidth = 66;
rules.getRange("C1:C15").format.columnWidth = 24;
rules.getRange("D1:D15").format.columnWidth = 34;
rules.getRange("A1:D15").format.wrapText = true;
rules.getRange("A2:D15").format.rowHeight = 30;

workbook.comments.addThread({ cell: rules.getRange("B10") }, "Official Robinhood Chain documentation used to verify chain IDs and public endpoints.");
workbook.comments.addThread({ cell: rules.getRange("B11") }, "Blockscout API was queried on 2026-08-24 for outgoing testnet transaction history.");

await fs.mkdir(outputDir, { recursive: true });
const recommended = behavior.filter((row) => row.category === "recommend").map((row) => row.address).sort();
const review = behavior.filter((row) => row.category === "review").map((row) => row.address).sort();
const bots = behavior.filter((row) => row.category === "likely_bot").map((row) => row.address).sort();
await fs.writeFile(`${outputDir}/recommended_testnet_allowlist.txt`, `${recommended.join("\n")}\n`);
await fs.writeFile(`${outputDir}/manual_review_testnet.txt`, `${review.join("\n")}\n`);
await fs.writeFile(`${outputDir}/likely_bots_testnet.txt`, `${bots.join("\n")}\n`);

const inspection = await workbook.inspect({
  kind: "table",
  range: "Summary!A1:H12",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 10,
});
console.log(inspection.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

for (const [sheetName, range, fileName] of [
  ["Summary", "A1:H12", "preview_summary.png"],
  ["Active analysis", "A1:Z18", "preview_active.png"],
  ["All wallets", "A1:J24", "preview_all.png"],
  ["Rules & sources", "A1:D15", "preview_rules.png"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${fileName}`, new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/robinhood_wallet_audit.xlsx`);
console.log(`${outputDir}/robinhood_wallet_audit.xlsx`);
