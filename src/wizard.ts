// Interactive public-mint wizard.
//
// Every transaction here is built from on-chain SeaDrop state — price, fee
// recipient and per-wallet cap all come from the contract — so no OpenSea
// account, token or API key is involved in the mint itself.
//
// Nothing is written to disk: pasted keys live in memory for the run only.

import chalk from "chalk";
import { JsonRpcProvider, Wallet, formatEther, getAddress, isAddress } from "ethers";
import { CHAINS, ChainProfile, resolveChain } from "./chains";
import { parseNftLink } from "./nft-link";
import { resolveSlug } from "./slug-resolver";
import {
  maskRpc,
  planRpcs,
  privateRpcsFromEnv,
  resolveRpcsForChain,
  toRpcUrl,
} from "./rpc-resolver";
import { parseRpcEndpoints } from "./rpc-blast";
import { buildLocalMintPlan, LocalMintPlan } from "./seadrop-public";
import { localPublicSnipe } from "./local-mint";
import { istTimeToDate, toIST } from "./time-format";
import { askChoice, askHidden, askNumber, askText, askYesNo, closePrompts } from "./prompt";

export async function runWizard(): Promise<void> {
  printBanner();

  // ── 1. Private keys ───────────────────────────────────────────────────
  const walletKeys = await promptKeys();

  // ── 2. Chain ──────────────────────────────────────────────────────────
  let chainKey = await askChoice<string>(
    "Chọn blockchain",
    CHAINS.map((c) => ({ label: c.name, value: c.key, hint: `chain id ${c.chainId}` })),
    Math.max(
      0,
      CHAINS.findIndex((c) => c.key === (process.env.CHAIN || "base").toLowerCase())
    )
  );

  // ── 3. Quantity ───────────────────────────────────────────────────────
  const quantity = await promptQuantity(walletKeys.length);

  // ── 4. NFT link ───────────────────────────────────────────────────────
  const target = await promptTarget(chainKey);
  const nftContract = target.contract;
  chainKey = target.chainKey;
  const chainProfile = resolveChain(chainKey)!;

  // ── 5. RPC endpoints ──────────────────────────────────────────────────
  const manualRpcs = await promptRpc(chainProfile);
  const { urls: candidateRpcs, source } = resolveRpcsForChain(chainKey, manualRpcs);
  console.log(chalk.gray(`  Nguồn: ${source}`));
  console.log(chalk.gray(`  Đang kiểm tra ${candidateRpcs.length} endpoint...`));

  const plan = await planRpcs(candidateRpcs, chainProfile.chainId);

  for (const bad of plan.dropped) {
    const wrong = resolveChain(bad.chainId);
    console.log(
      chalk.red(`    ✗ ${labelOf(bad.url)} thuộc chain ${bad.chainId}${wrong ? ` (${wrong.name})` : ""} — đã loại bỏ`)
    );
  }
  for (const ep of parseRpcEndpoints(plan.urls)) {
    const failure = plan.failures.find((f) => f.url === ep.url);
    if (failure) {
      const benign = /not allowed|does not exist|not supported|method not found/i.test(failure.message);
      console.log(
        benign
          ? chalk.gray(`    • ${ep.label}  (chỉ gửi)`)
          : chalk.yellow(`    ⚠ ${ep.label}  ${failure.message.slice(0, 90)}`)
      );
    } else {
      console.log(chalk.green(`    ✓ ${ep.label}`));
    }
  }

  if (plan.urls.length === 0) {
    throw new Error(`Không có RPC endpoint khả dụng cho ${chainProfile.name}`);
  }
  if (!plan.verified) {
    console.log(chalk.yellow(`  ⚠ Không endpoint nào xác nhận chain ID ${chainProfile.chainId}.`));
    if (!(await askYesNo("Vẫn tiếp tục?", false))) {
      throw new Error("Đã hủy — không thể xác minh chain của RPC");
    }
  } else {
    console.log(chalk.green(`  ✓ Đã xác nhận chain ID ${chainProfile.chainId} (${chainProfile.name})`));
  }
  const rpcUrls = plan.urls;

  // ── 6. Read the public drop from chain ────────────────────────────────
  console.log(chalk.bold.white("\nĐợt mint"));
  const mintPlan = await buildLocalMintPlan(rpcUrls[0], nftContract, quantity);
  if (!mintPlan) {
    throw new Error(
      `Không đọc được đợt public SeaDrop của ${nftContract} trên ${chainProfile.name}.\n` +
        "  Có thể đây không phải bộ sưu tập SeaDrop hoặc cấu hình được lưu trong token contract."
    );
  }

  const drop = mintPlan.drop;
  const startsAt = new Date(drop.startTime * 1000);
  const endsAt = new Date(drop.endTime * 1000);
  const live = Date.now() >= startsAt.getTime() && Date.now() < endsAt.getTime();

  console.log(chalk.green("  ✓ Đã tạo calldata từ SeaDrop on-chain — không cần token OpenSea"));
  console.log(chalk.gray(`    Người nhận phí: ${mintPlan.feeRecipient}`));
  console.log(
    chalk.gray(
      `    Giá:           ${formatEther(drop.mintPrice)} × ${quantity} = ${formatEther(mintPlan.value)} mỗi ví`
    )
  );
  console.log(chalk.gray(`    Tối đa mỗi ví: ${drop.maxTotalMintableByWallet || "không giới hạn"}`));
  console.log(
    chalk.gray(
      `    Thời gian:     ${toIST(startsAt)} → ${toIST(endsAt)} IST  ${live ? chalk.green("(đang mở)") : chalk.yellow(`(mở sau ${formatRemaining(startsAt.getTime() - Date.now())})`)}`
    )
  );

  if (drop.maxTotalMintableByWallet > 0 && quantity > drop.maxTotalMintableByWallet) {
    console.log(
      chalk.yellow(`  ⚠ Đợt mint chỉ cho phép ${drop.maxTotalMintableByWallet} NFT mỗi ví — giao dịch mint ${quantity} NFT sẽ bị revert.`)
    );
  }
  if (Date.now() >= endsAt.getTime()) {
    console.log(chalk.yellow("  ⚠ Đợt public mint này đã kết thúc on-chain."));
  }

  // ── 7. Gas ────────────────────────────────────────────────────────────
  const provider = new JsonRpcProvider(rpcUrls[0]);
  console.log(chalk.bold.white("\nGas"));
  const baseFeeGwei = await currentBaseFeeGwei(provider);
  if (baseFeeGwei !== null) {
    console.log(chalk.gray(`  Base fee hiện tại của mạng: ${baseFeeGwei.toFixed(6)} gwei`));
  }

  const envMaxFee = Number(process.env.MAX_FEE_PER_GAS || (chainKey === "ethereum" ? 80 : 2));
  const envPriority = Number(process.env.MAX_PRIORITY_FEE || (chainKey === "ethereum" ? 5 : 0.05));

  // A ceiling under the base fee is rejected outright by every node, so it must
  // not be enterable at all.
  let defaultMaxFee = envMaxFee;
  if (baseFeeGwei !== null) {
    const suggested = Math.ceil((baseFeeGwei * 2 + envPriority) * 1000) / 1000;
    if (envMaxFee < baseFeeGwei) defaultMaxFee = suggested;
    console.log(chalk.gray(`  Phải từ ${baseFeeGwei.toFixed(6)} gwei; mức ${suggested} có khoảng dự phòng.`));
  }

  const maxFeeGwei = await askNumber("Phí gas tối đa (gwei) — mức trần", defaultMaxFee, {
    min: baseFeeGwei ?? 0,
  });

  // EIP-1559 caps the tip at the ceiling; ethers refuses to sign otherwise.
  const priorityDefault = Math.min(envPriority, maxFeeGwei);
  const priorityGwei = await askNumber("Phí ưu tiên / tiền tip (gwei)", priorityDefault, {
    min: 0,
    max: maxFeeGwei,
  });

  const maxFeePerGas = gweiToWei(maxFeeGwei);
  const maxPriorityFee = gweiToWei(priorityGwei);
  const gasLimit = parseInt(process.env.GAS_LIMIT || "0", 10) || 250_000;

  // ── 8. Timing ─────────────────────────────────────────────────────────
  const { targetStart, timingLabel } = await promptTiming(drop.startTime);

  // ── 9. Balances + affordability ───────────────────────────────────────
  console.log(chalk.bold.white("\nCác ví"));
  const wallets = walletKeys.map((k) => new Wallet(k));
  const balances = await Promise.all(
    wallets.map((w) => provider.getBalance(w.address).catch(() => null))
  );
  const symbol = chainProfile.nativeSymbol;

  // Nodes reserve gasLimit × maxFee + value upfront and reject if the balance
  // falls short, regardless of the far smaller amount actually spent.
  const required = BigInt(gasLimit) * maxFeePerGas + mintPlan.value;

  wallets.forEach((w, i) => {
    const bal = balances[i];
    const text = bal === null ? "không đọc được số dư" : `${Number(formatEther(bal)).toFixed(6)} ${symbol}`;
    const short = bal !== null && bal < required;
    const line = `  [W${i}] ${w.address}  ${text}`;
    console.log(short ? chalk.red(`${line}  ✗ cần ${formatEther(required)}`) : chalk.gray(line));
  });

  const shortWallets = wallets.filter((_, i) => balances[i] !== null && (balances[i] as bigint) < required);
  if (shortWallets.length > 0) {
    console.log(
      chalk.gray(
        `\n  Node yêu cầu mỗi ví có gasLimit × maxFee${mintPlan.value > 0n ? " + giá mint" : ""} = ${formatEther(required)} ${symbol}.`
      )
    );
    const poorest = balances
      .filter((b): b is bigint => b !== null)
      .reduce((a, b) => (a < b ? a : b));
    const affordable = Number((poorest - mintPlan.value) / BigInt(gasLimit)) / 1e9;
    if (affordable > 0) {
      console.log(
        chalk.yellow(`  Hãy nạp thêm tiền hoặc chạy lại với phí tối đa không quá ${affordable.toFixed(4)} gwei.`)
      );
    }
    if (shortWallets.length === wallets.length) {
      throw new Error("Tất cả ví đều thiếu tiền — không thể phát giao dịch.");
    }
    console.log(chalk.yellow("  Những ví còn đủ tiền vẫn có thể gửi giao dịch."));
  }

  // ── 10. Confirm ───────────────────────────────────────────────────────
  console.log(chalk.bold.white("\n──────── SẴN SÀNG ────────"));
  line("Blockchain", `${chainProfile.name} (${chainProfile.chainId})`);
  line("RPC", `${labelOf(rpcUrls[0])} + ${rpcUrls.length - 1} more`);
  line("Mục tiêu", target.label);
  line("Contract", nftContract);
  line("Số ví", `${wallets.length}`);
  line("Số lượng", `${quantity} mỗi ví → tổng ${quantity * wallets.length}`);
  line(
    "Tiền mint",
    `${formatEther(mintPlan.value)} mỗi ví → tổng ${formatEther(mintPlan.value * BigInt(wallets.length))} (+ gas)`
  );
  line("Gas", `${maxFeeGwei} / ${priorityGwei} gwei · limit ${gasLimit}`);
  line("Thời điểm", timingLabel);
  console.log(chalk.bold.white("───────────────────────"));

  if (!(await askYesNo(chalk.bold("Gửi giao dịch?"), false))) {
    console.log(chalk.yellow("\n  Đã hủy — chưa có gì được gửi.\n"));
    closePrompts();
    return;
  }

  // Hand stdin back so readline never interleaves with the blast logging.
  closePrompts();

  await localPublicSnipe({
    nftContract,
    quantity,
    walletKeys,
    rpcUrls,
    maxFeePerGas,
    maxPriorityFee,
    gasLimit,
    targetStart,
    plan: mintPlan,
  });
}

// ── Steps ───────────────────────────────────────────────────────────────

async function promptKeys(): Promise<string[]> {
  console.log(chalk.bold.white("Private key"));
  console.log(chalk.gray("  Dán mỗi dòng một key — nội dung nhập sẽ được ẩn. Để trống khi hoàn tất."));
  console.log(chalk.gray("  Mỗi key được xác nhận bằng địa chỉ ví. Không có dữ liệu nào được lưu xuống ổ đĩa."));

  const keys: string[] = [];
  const seen = new Set<string>();

  for (;;) {
    const raw = await askHidden(chalk.gray(`  › key thứ ${keys.length + 1}: `));
    if (!raw) {
      if (keys.length === 0) {
        console.log(chalk.red("  ✗ Cần nhập ít nhất một key."));
        continue;
      }
      break;
    }

    const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
    let wallet: Wallet;
    try {
      wallet = new Wallet(normalized);
    } catch {
      console.log(chalk.red("  ✗ Private key không hợp lệ — hãy thử lại."));
      continue;
    }

    if (seen.has(wallet.address.toLowerCase())) {
      console.log(chalk.yellow(`  ⚠ Trùng với ${short(wallet.address)} — đã bỏ qua.`));
      continue;
    }
    seen.add(wallet.address.toLowerCase());
    keys.push(normalized);
    console.log(chalk.green(`  ✓ [W${keys.length - 1}] ${wallet.address}`));
  }

  console.log(chalk.gray(`  Đã nạp ${keys.length} ví.`));
  return keys;
}

async function promptQuantity(walletCount: number): Promise<number> {
  console.log(chalk.bold.white("\nSố lượng"));
  const qty = await askNumber("Số NFT mỗi ví", 1, { min: 1, max: 100 });
  if (walletCount > 1) {
    console.log(chalk.gray(`  → ${qty} × ${walletCount} ví = tổng ${qty * walletCount}`));
  }
  return Math.floor(qty);
}

async function promptTarget(
  chainKey: string
): Promise<{ contract: string; label: string; chainKey: string }> {
  console.log(chalk.bold.white("\nNFT mục tiêu"));
  console.log(chalk.gray("  Dán liên kết OpenSea (bộ sưu tập hoặc NFT), slug hoặc địa chỉ contract."));

  let activeChain = chainKey;

  for (;;) {
    const raw = await askText("Liên kết NFT");
    if (!raw) {
      console.log(chalk.red("  ✗ Hãy dán liên kết, slug hoặc địa chỉ."));
      continue;
    }

    let parsed;
    try {
      parsed = parseNftLink(raw);
    } catch (err: any) {
      console.log(chalk.red(`  ✗ ${err.message}`));
      continue;
    }

    if (parsed.chainHint && parsed.chainHint !== activeChain && resolveChain(parsed.chainHint)) {
      const hinted = resolveChain(parsed.chainHint)!;
      console.log(
        chalk.yellow(`  ⚠ Liên kết thuộc ${hinted.name}, nhưng bạn đã chọn ${resolveChain(activeChain)!.name}.`)
      );
      if (await askYesNo(`Chuyển sang ${hinted.name}?`, true)) {
        activeChain = hinted.key;
        console.log(chalk.green(`  ✓ Đã chuyển sang ${hinted.name}`));
      }
    }

    if (parsed.kind === "address") {
      const normalized = normalizeAddress(parsed.value);
      if (!normalized) {
        console.log(chalk.red(`  ✗ "${parsed.value}" không phải địa chỉ 20 byte.`));
        continue;
      }
      if (normalized.checksumWarning) {
        console.log(chalk.yellow("  ⚠ Địa chỉ chữ hoa/thường có checksum EIP-55 không khớp — có thể đã nhập sai."));
        if (!(await askYesNo("Vẫn sử dụng địa chỉ này?", false))) continue;
      }
      console.log(chalk.green(`  ✓ Địa chỉ contract ${normalized.address}`));
      return { contract: normalized.address, label: short(normalized.address), chainKey: activeChain };
    }

    // Slug → address is a plain OpenSea REST lookup, which often answers without
    // a key. Always try; a key only makes it reliable. The mint itself never
    // touches OpenSea either way.
    const apiKey = (process.env.OPENSEA_API_KEY || "").trim();

    try {
      console.log(chalk.gray(`  Đang phân giải slug "${parsed.value}"${apiKey ? "" : " (không có API key — có thể bị từ chối)"}...`));
      const info = await resolveSlug(parsed.value, apiKey || undefined, activeChain);
      const resolved = normalizeAddress(info.contractAddress);
      if (!resolved) {
        console.log(chalk.red(`  ✗ API trả về địa chỉ không hợp lệ: ${info.contractAddress}`));
        continue;
      }
      console.log(chalk.green(`  ✓ ${info.name} → ${resolved.address}`));
      if (info.chain && resolveChain(info.chain) && info.chain !== activeChain) {
        console.log(chalk.yellow(`  ⚠ Được niêm yết trên "${info.chain}", không phải "${activeChain}".`));
        if (await askYesNo(`Chuyển sang ${resolveChain(info.chain)!.name}?`, true)) {
          activeChain = resolveChain(info.chain)!.key;
        }
      }
      return { contract: resolved.address, label: info.name || parsed.value, chainKey: activeChain };
    } catch (err: any) {
      console.log(chalk.red(`  ✗ ${err.message}`));
      console.log(
        chalk.gray("    Hãy dán trực tiếp địa chỉ contract (0x…) — cách này không cần API key.")
      );
      console.log(
        chalk.gray("    Có thể tìm địa chỉ trong phần Chi tiết của bộ sưu tập hoặc trong URL của một NFT.")
      );
    }
  }
}

async function promptRpc(profile: ChainProfile): Promise<string[]> {
  console.log(chalk.bold.white("\nRPC endpoint"));
  console.log(chalk.gray("  RPC riêng (Alchemy / QuickNode / Infura) giúp tăng cơ hội trong đợt mint cạnh tranh."));
  if (profile.rpc.alchemyHost) {
    console.log(chalk.gray(`  Dán URL đầy đủ hoặc chỉ Alchemy key → https://${profile.rpc.alchemyHost}/v2/<key>`));
  }
  console.log(chalk.gray("  Phân cách nhiều RPC bằng dấu phẩy để gửi đồng thời."));

  const fromEnv = privateRpcsFromEnv(profile.key);
  if (fromEnv.length > 0) {
    console.log(chalk.gray(`  .env đã có: ${fromEnv.map(maskRpc).join(", ")}`));
    console.log(chalk.gray("  Để trống = giữ giá trị trong .env."));
  } else {
    console.log(chalk.yellow(`  .env chưa có RPC cho ${profile.name}. Để trống = chỉ dùng node công khai.`));
  }

  for (;;) {
    const raw = await askText(`RPC cho ${profile.name}`);
    if (!raw) return fromEnv;

    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const urls: string[] = [];
    let bad = false;
    for (const part of parts) {
      const url = toRpcUrl(part, profile.key);
      if (!url) {
        console.log(chalk.red(`  ✗ "${part}" không phải URL hoặc API key hợp lệ.`));
        bad = true;
        break;
      }
      urls.push(url);
    }
    if (bad || urls.length === 0) continue;

    for (const url of urls) console.log(chalk.green(`  ✓ ${maskRpc(url)}`));
    return urls;
  }
}

async function promptTiming(
  startTime: number
): Promise<{ targetStart: Date | null; timingLabel: string }> {
  const startsInFuture = startTime * 1000 > Date.now();
  const at = new Date(startTime * 1000);

  const choices: { label: string; value: "wait" | "now" | "custom"; hint?: string }[] = [];
  if (startsInFuture) {
    // Firing before the on-chain start reverts with NotActive, so it isn't
    // offered at all once a future start time is known.
    choices.push({
      label: "Chờ đợt mint mở",
      value: "wait",
      hint: `${toIST(at)} IST · còn ${formatRemaining(at.getTime() - Date.now())} · gửi tại T-0`,
    });
  } else {
    choices.push({ label: "Gửi ngay", value: "now", hint: "đợt mint đang mở" });
  }
  choices.push({ label: "Thời gian tùy chỉnh", value: "custom", hint: "HH:MM, 24 giờ IST, hôm nay" });

  const pick = await askChoice("Khi nào gửi giao dịch?", choices, 0);

  if (pick === "wait") return { targetStart: at, timingLabel: `chờ đợt mint — ${toIST(at)} IST` };
  if (pick === "now") return { targetStart: null, timingLabel: "gửi ngay lập tức" };

  for (;;) {
    const raw = await askText("Thời gian (HH:MM, 24 giờ, IST)");
    try {
      const custom = istTimeToDate(raw);
      if (custom.getTime() < startTime * 1000) {
        console.log(chalk.bold.red(`  ✗ Thời điểm này trước khi đợt mint mở (${toIST(at)} IST) — giao dịch sẽ revert.`));
        if (!(await askYesNo("Vẫn sử dụng thời điểm này?", false))) continue;
      }
      return { targetStart: custom, timingLabel: `tùy chỉnh — ${toIST(custom)} IST` };
    } catch (err: any) {
      console.log(chalk.red(`  ✗ ${err.message}`));
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

// Accept an address in any case — explorer copy-pastes arrive case-mangled and
// hard-failing is worse. A mixed-case string failing EIP-55 is the typo signal.
function normalizeAddress(raw: string): { address: string; checksumWarning: boolean } | null {
  const value = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  const body = value.slice(2);
  const mixedCase = /[a-f]/.test(body) && /[A-F]/.test(body);
  return {
    address: getAddress(value.toLowerCase()),
    checksumWarning: mixedCase && !isAddress(value),
  };
}

async function currentBaseFeeGwei(provider: JsonRpcProvider): Promise<number | null> {
  try {
    const fee = await provider.getFeeData();
    const wei = fee.gasPrice ?? fee.maxFeePerGas;
    return wei === null || wei === undefined ? null : Number(wei) / 1e9;
  } catch {
    return null;
  }
}

function gweiToWei(gwei: number): bigint {
  return BigInt(Math.round(gwei * 1e9));
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function labelOf(url: string): string {
  return parseRpcEndpoints([url])[0].label;
}

function line(label: string, value: string): void {
  console.log(`  ${chalk.gray(label.padEnd(10))} ${chalk.white(value)}`);
}

function printBanner(): void {
  console.log(
    chalk.bold.cyan(`
╔═══════════════════════════════════════╗
║        NFT PUBLIC MINT SNIPER         ║
║   On-chain calldata · no OpenSea      ║
╚═══════════════════════════════════════╝`)
  );
  console.log(chalk.gray("  Chỉ hỗ trợ đợt public SeaDrop. Nhấn Ctrl+C để thoát bất cứ lúc nào.\n"));
}
