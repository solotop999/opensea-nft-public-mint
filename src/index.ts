#!/usr/bin/env node

import path from "path";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { runWizard } from "./wizard";
import { closePrompts } from "./prompt";

const HELP = `
NFT Public Mint Sniper

  Mint NFT trong các đợt public SeaDrop. Calldata được tạo từ dữ liệu on-chain,
  không cần tài khoản hoặc access token OpenSea.

Sử dụng
  npm start              chạy trình hướng dẫn tương tác
  npm start -- --help    hiển thị trợ giúp này

Chương trình sẽ lần lượt hỏi private key, chain, số lượng, liên kết NFT, RPC,
gas và thời điểm mint. Có thể đặt giá trị mặc định trong .env (xem .env.example).
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  try {
    await runWizard();
    closePrompts();
    process.exit(0);
  } catch (err: any) {
    closePrompts();
    console.error(chalk.red(`\n❌ ${err.message}\n`));
    process.exit(1);
  }
}

void main();
