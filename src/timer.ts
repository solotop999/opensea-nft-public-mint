import chalk from "chalk";
import ora from "ora";

export async function waitForMintTime(mintTime: Date, earlyFireMs: number = 0): Promise<void> {
  // Fire early by earlyFireMs — tx sits in mempool and lands the moment contract allows
  const fireTime = new Date(mintTime.getTime() - earlyFireMs);
  const now = new Date();
  const diff = fireTime.getTime() - now.getTime();

  if (diff <= 0) {
    console.log(chalk.yellow("  Thời điểm gửi đã qua — đang gửi ngay."));
    return;
  }

  console.log(chalk.bold.white(`\n⏰ Thời điểm mint: ${mintTime.toISOString()}`));
  if (earlyFireMs > 0) {
    console.log(chalk.bold.yellow(`  🔥 Gửi sớm: ${earlyFireMs}ms trước giờ mint → gửi lúc ${fireTime.toISOString()}`));
  }
  console.log(chalk.gray(`  Hiện tại: ${now.toISOString()} | Đang chờ ${Math.ceil(diff / 1000)} giây...\n`));

  // If more than 10 seconds away, show a countdown spinner
  if (diff > 10000) {
    const spinner = ora({
      text: formatCountdown(fireTime),
      color: "cyan",
    }).start();

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const remaining = fireTime.getTime() - Date.now();

        if (remaining <= 5000) {
          clearInterval(interval);
          spinner.stop();
          resolve();
        } else {
          spinner.text = formatCountdown(fireTime);
        }
      }, 500);
    });
  }

  // Precise wait for the last few seconds using a tight loop
  const remaining = fireTime.getTime() - Date.now();
  if (remaining > 0) {
    if (remaining > 100) {
      await new Promise((resolve) =>
        setTimeout(resolve, remaining - 100)
      );
    }

    // Tight spin-wait for the final milliseconds
    while (Date.now() < fireTime.getTime()) {
      // Spin-wait — burns CPU but gives sub-ms precision
    }
  }

  console.log(chalk.bold.green("  🟢 ĐANG GỬI!\n"));
}

function formatCountdown(target: Date): string {
  const diff = target.getTime() - Date.now();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  if (hours > 0) {
    return `  Đang chờ... còn ${hours} giờ ${minutes} phút ${seconds} giây`;
  }
  if (minutes > 0) {
    return `  Đang chờ... còn ${minutes} phút ${seconds} giây`;
  }
  return `  Đang chờ... còn ${seconds} giây`;
}
