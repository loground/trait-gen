import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? "output/robinhood_wallet_rpc_audit.csv";

if (!inputPath) {
  console.error("Usage: node scripts/audit_robinhood_wallets.mjs <wallets.txt> [output.csv]");
  process.exit(1);
}

const networks = [
  { key: "testnet", graphql: "https://explorer.testnet.chain.robinhood.com/api/v1/graphql" },
  { key: "mainnet", rpc: "https://rpc.mainnet.chain.robinhood.com" },
];

const rawAddresses = (await readFile(inputPath, "utf8"))
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);

const rows = rawAddresses.map((original, index) => {
  const address = original.replace(/^0X/, "0x").toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(address);
  let lowAddress = false;
  if (valid) lowAddress = BigInt(address) <= 0xffffn;
  return { index: index + 1, original, address, valid, lowAddress };
});

const validRows = rows.filter((row) => row.valid);
// Blockscout caps GraphQL complexity at 100; these three fields cost 3 points/address.
const CHUNK_SIZE = 33;
const CONCURRENCY = 2;
const checkpointPath = resolve(`${outputPath}.checkpoint.json`);
let checkpoint = { mainnet: {}, testnet: {} };
try {
  checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let checkpointWrite = Promise.resolve();

function saveCheckpoint() {
  checkpointWrite = checkpointWrite.then(async () => {
    await mkdir(dirname(checkpointPath), { recursive: true });
    await writeFile(checkpointPath, JSON.stringify(checkpoint));
  });
  return checkpointWrite;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function fetchAddresses(url, walletChunk, attempt = 1) {
  try {
    const hashes = walletChunk.map((row) => `\"${row.address}\"`).join(",");
    const query = `{addresses(hashes:[${hashes}]){hash nonce transactionsCount}}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.every((item) => item.message === "Addresses not found.")) return [];
    if (payload.errors) throw new Error(payload.errors.map((item) => item.message).join("; "));
    if (!Array.isArray(payload.data?.addresses)) throw new Error("GraphQL did not return addresses");
    return payload.data.addresses;
  } catch (error) {
    if (attempt >= 8) throw error;
    await delay(Math.min(15_000, 500 * 2 ** (attempt - 1)));
    return fetchAddresses(url, walletChunk, attempt + 1);
  }
}

async function fetchNonces(url, walletChunk, attempt = 1) {
  try {
    const batch = walletChunk.map((row, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "eth_getTransactionCount",
      params: [row.address, "latest"],
    }));
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error(payload.error?.message ?? "RPC did not return a batch");
    const byId = new Map(payload.map((item) => [item.id, item]));
    return walletChunk.map((row, index) => ({
      hash: row.address,
      nonce: Number(BigInt(byId.get(index + 1)?.result ?? 0)),
      transactionsCount: 0,
    }));
  } catch (error) {
    if (attempt >= 8) throw error;
    await delay(Math.min(15_000, 500 * 2 ** (attempt - 1)));
    return fetchNonces(url, walletChunk, attempt + 1);
  }
}

async function scanNetwork(network) {
  for (const row of validRows) {
    const saved = checkpoint[network.key]?.[row.address];
    if (saved) {
      row[`${network.key}Nonce`] = saved.nonce;
      row[`${network.key}TransactionsCount`] = saved.transactionsCount;
      row[`${network.key}Scanned`] = true;
    }
  }
  const pendingRows = validRows.filter((row) => !row[`${network.key}Scanned`]);
  const work = chunks(pendingRows, CHUNK_SIZE);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < work.length) {
      const chunkIndex = cursor++;
      const walletChunk = work[chunkIndex];
      const response = network.graphql
        ? await fetchAddresses(network.graphql, walletChunk)
        : await fetchNonces(network.rpc, walletChunk);
      const byAddress = new Map(response.map((item) => [item.hash.toLowerCase(), item]));
      for (const row of walletChunk) {
        const item = byAddress.get(row.address);
        row[`${network.key}Nonce`] = Number(item?.nonce ?? 0);
        row[`${network.key}TransactionsCount`] = Number(item?.transactionsCount ?? 0);
        row[`${network.key}Scanned`] = true;
        checkpoint[network.key][row.address] = {
          nonce: row[`${network.key}Nonce`],
          transactionsCount: row[`${network.key}TransactionsCount`],
        };
      }
      completed += walletChunk.length;
      if (completed % 100 < CHUNK_SIZE || completed === pendingRows.length) {
        await saveCheckpoint();
      }
      if (completed % 1000 < CHUNK_SIZE || completed === pendingRows.length) {
        console.error(`${network.key}: ${validRows.length - pendingRows.length + completed}/${validRows.length}`);
      }
      await delay(250);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await saveCheckpoint();
}

for (const network of networks) await scanNetwork(network);

function formatEth(value) {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function classify(row) {
  if (!row.valid) return { stage1: "exclude", reason: "invalid_address", score: 0 };
  if (row.lowAddress) return { stage1: "exclude", reason: "reserved_or_system_low_address", score: 0 };
  if (row.mainnetIsContract || row.testnetIsContract) {
    return { stage1: "review", reason: "contract_or_smart_wallet", score: 20 };
  }
  const mainNonce = row.mainnetNonce ?? 0;
  const testNonce = row.testnetNonce ?? 0;
  if (mainNonce === 0 && testNonce === 0) {
    return { stage1: "exclude", reason: "no_outgoing_activity", score: 0 };
  }
  let score = 0;
  if (mainNonce > 0) score += 30;
  if (mainNonce >= 3) score += 15;
  if (mainNonce >= 10) score += 10;
  if (testNonce > 0) score += 10;
  if (testNonce >= 3) score += 5;
  if ((row.mainnetBalanceWei ?? 0n) > 0n) score += 10;
  if ((row.testnetBalanceWei ?? 0n) > 0n) score += 5;
  return {
    stage1: "history_check",
    reason: mainNonce > 0 ? "mainnet_outgoing_activity" : "testnet_only_outgoing_activity",
    score,
  };
}

const header = [
  "source_line", "address", "valid", "low_address", "mainnet_nonce", "mainnet_balance_eth",
  "mainnet_transactions", "mainnet_contract", "testnet_nonce", "testnet_balance_eth",
  "testnet_transactions", "testnet_contract",
  "stage1", "stage1_score", "stage1_reason",
];
const csvRows = [header.join(",")];
for (const row of rows) {
  const result = classify(row);
  csvRows.push([
    row.index,
    row.original,
    row.valid,
    row.lowAddress,
    row.mainnetNonce ?? "",
    typeof row.mainnetBalanceWei === "bigint" ? formatEth(row.mainnetBalanceWei) : "",
    row.mainnetTransactionsCount ?? "",
    row.mainnetIsContract ?? "",
    row.testnetNonce ?? "",
    typeof row.testnetBalanceWei === "bigint" ? formatEth(row.testnetBalanceWei) : "",
    row.testnetTransactionsCount ?? "",
    row.testnetIsContract ?? "",
    result.stage1,
    result.score,
    result.reason,
  ].join(","));
}

const resolvedOutput = resolve(outputPath);
await mkdir(dirname(resolvedOutput), { recursive: true });
await writeFile(resolvedOutput, `${csvRows.join("\n")}\n`);

const summary = new Map();
for (const row of rows) {
  const result = classify(row);
  summary.set(result.stage1, (summary.get(result.stage1) ?? 0) + 1);
}
console.error(JSON.stringify(Object.fromEntries(summary), null, 2));
console.log(resolvedOutput);
