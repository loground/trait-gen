import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const checkpointPath = process.argv[2] ?? "output/robinhood_wallet_rpc_audit.csv.checkpoint.json";
const outputPath = resolve(process.argv[3] ?? "output/robinhood_testnet_behavior.json");
const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
const active = Object.entries(checkpoint.testnet)
  .filter(([, value]) => value.nonce > 0)
  .map(([address, value]) => ({ address, nonce: value.nonce }));

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function getJson(url, attempt = 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 8) throw error;
    await delay(Math.min(15_000, 500 * 2 ** (attempt - 1)));
    return getJson(url, attempt + 1);
  }
}

function frequency(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function maxCount(values) {
  return Math.max(0, ...frequency(values).values());
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function analyze(wallet, items) {
  const outgoing = items.filter((item) => item.from?.hash?.toLowerCase() === wallet.address);
  const sampleSize = outgoing.length;
  const timestamps = outgoing.map((item) => Date.parse(item.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
  const intervals = timestamps.slice(1).map((value, index) => (value - timestamps[index]) / 1000);
  const toAddresses = outgoing.map((item) => item.to?.hash?.toLowerCase() ?? "contract_creation");
  const methods = outgoing.map((item) => item.method ?? item.raw_input?.slice(0, 10) ?? "transfer");
  const blocks = outgoing.map((item) => item.block_number);
  const days = outgoing.map((item) => item.timestamp?.slice(0, 10)).filter(Boolean);
  const successful = outgoing.filter((item) => item.status === "ok").length;
  const spanDays = timestamps.length >= 2 ? (timestamps.at(-1) - timestamps[0]) / 86_400_000 : 0;
  const dominantToRatio = sampleSize ? maxCount(toAddresses) / sampleSize : 0;
  const dominantMethodRatio = sampleSize ? maxCount(methods) / sampleSize : 0;
  const maxSameBlockRatio = sampleSize ? maxCount(blocks) / sampleSize : 0;
  const medianIntervalSeconds = median(intervals);

  const signals = [];
  if (sampleSize >= 10 && dominantToRatio >= 0.9) signals.push("single_target_concentration");
  if (sampleSize >= 10 && dominantMethodRatio >= 0.9) signals.push("single_method_repetition");
  if (sampleSize >= 6 && maxSameBlockRatio >= 0.5) signals.push("same_block_burst");
  if (sampleSize >= 10 && medianIntervalSeconds !== null && medianIntervalSeconds <= 20) signals.push("machine_like_timing");
  if (sampleSize >= 20 && new Set(days).size <= 2) signals.push("high_volume_short_window");
  if (sampleSize >= 6 && successful / sampleSize < 0.5) signals.push("mostly_failed_transactions");

  let score = 20;
  if (sampleSize >= 3) score += 15;
  if (new Set(days).size >= 3) score += 15;
  if (spanDays >= 7) score += 10;
  if (new Set(toAddresses).size >= 3) score += 15;
  if (new Set(methods).size >= 3) score += 10;
  if (sampleSize && successful / sampleSize >= 0.8) score += 10;
  score -= Math.min(60, signals.length * 20);
  score = Math.max(0, Math.min(100, score));

  let category = "review";
  if (signals.length >= 2 || maxSameBlockRatio >= 0.8) category = "likely_bot";
  else if (
    score >= 65 &&
    signals.length === 0 &&
    sampleSize >= 4 &&
    (new Set(days).size >= 3 || spanDays >= 14)
  ) category = "recommend";

  return {
    ...wallet,
    category,
    score,
    signals,
    sampleSize,
    successful,
    uniqueDays: new Set(days).size,
    spanDays: Number(spanDays.toFixed(2)),
    uniqueTargets: new Set(toAddresses).size,
    uniqueMethods: new Set(methods).size,
    dominantToRatio: Number(dominantToRatio.toFixed(4)),
    dominantMethodRatio: Number(dominantMethodRatio.toFixed(4)),
    maxSameBlockRatio: Number(maxSameBlockRatio.toFixed(4)),
    medianIntervalSeconds: medianIntervalSeconds === null ? null : Number(medianIntervalSeconds.toFixed(2)),
    newestTimestamp: outgoing[0]?.timestamp ?? null,
    oldestSampleTimestamp: outgoing.at(-1)?.timestamp ?? null,
  };
}

const results = [];
let cursor = 0;
const concurrency = 3;
async function worker() {
  while (cursor < active.length) {
    const wallet = active[cursor++];
    const url = `https://explorer.testnet.chain.robinhood.com/api/v2/addresses/${wallet.address}/transactions?filter=from`;
    const payload = await getJson(url);
    results.push(analyze(wallet, payload.items ?? []));
    console.error(`${results.length}/${active.length}`);
    await delay(150);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
results.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(outputPath);
