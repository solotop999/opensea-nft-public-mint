// Minimal interactive prompt layer built on node:readline — no extra deps.
//
// Menus are numbered rather than arrow-key driven on purpose: a sniper gets
// driven under time pressure, often over SSH, and typing "2 <enter>" works
// identically in every terminal (including Windows Terminal / PowerShell)
// without any raw-mode key handling to get wrong.

import readline from "readline";
import chalk from "chalk";

let rl: readline.Interface | null = null;
let shuttingDown = false;

// Lines are queued as they arrive rather than read via rl.question(), which
// only captures the *next* line emitted after it is called. A piped stdin emits
// every line at once, so anything not currently being awaited would be dropped
// and the wizard would stall on question two.
const queue: string[] = [];
let waiter: ((line: string) => void) | null = null;

// Terminal mode only when stdin really is a TTY. Forcing it on makes readline
// treat a redirected stdin as raw keystrokes — the whole buffer echoes at once.
const isTty = Boolean(process.stdin.isTTY);

function getRl(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: isTty,
    });

    rl.on("line", (line) => {
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(line);
      } else {
        queue.push(line);
      }
    });

    // Ctrl+C, Ctrl+D, or piped input running out mid-question. Without this the
    // pending question never resolves and the process just dies quietly.
    rl.on("close", () => {
      if (waiter && !shuttingDown) {
        console.log(chalk.yellow("\n  Đầu vào đã đóng — đang hủy. Chưa có gì được gửi.\n"));
        process.exit(130);
      }
    });
  }
  return rl;
}

// Release stdin. Call this before firing so readline never competes with the
// blast logging (or holds the event loop open at exit).
export function closePrompts(): void {
  shuttingDown = true;
  if (rl) {
    rl.close();
    rl = null;
  }
}

function readLine(): Promise<string> {
  getRl();
  const queued = queue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve) => {
    waiter = resolve;
  });
}

export async function ask(prompt: string, fallback = ""): Promise<string> {
  process.stdout.write(prompt);
  const answer = (await readLine()).trim();
  // A TTY echoes what was typed and moves the cursor down on Enter; a pipe does
  // neither, which runs every prompt together into one unreadable line. Echo it
  // ourselves so scripted runs leave a transcript you can actually audit.
  if (!isTty) process.stdout.write(`${answer}\n`);
  return answer.length > 0 ? answer : fallback;
}

// Read a line without echoing it. In a TTY we mute readline's redraw entirely —
// muting selectively would leak the typed text, since every redraw string
// contains both the prompt and the input. Outside a TTY readline never echoes.
export async function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  if (!isTty) {
    const answer = await readLine();
    process.stdout.write("\n"); // never echo the key itself
    return answer.trim();
  }

  const r = getRl() as unknown as { _writeToOutput?: (s: string) => void };
  const original = r._writeToOutput;
  r._writeToOutput = () => {};
  try {
    return (await readLine()).trim();
  } finally {
    r._writeToOutput = original;
    process.stdout.write("\n");
  }
}

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

export async function askChoice<T>(
  title: string,
  choices: Choice<T>[],
  defaultIndex = 0
): Promise<T> {
  console.log(chalk.bold.white(`\n${title}`));
  choices.forEach((c, i) => {
    const hint = c.hint ? chalk.gray(`  — ${c.hint}`) : "";
    console.log(`    ${chalk.bold.cyan(`${i + 1})`)} ${c.label}${hint}`);
  });

  for (;;) {
    const raw = await ask(
      chalk.gray(`  › chọn từ 1-${choices.length} [${defaultIndex + 1}]: `),
      String(defaultIndex + 1)
    );
    const idx = parseInt(raw, 10) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < choices.length) {
      console.log(chalk.green(`  ✓ ${choices[idx].label}`));
      return choices[idx].value;
    }
    console.log(chalk.red(`  ✗ Hãy nhập một số từ 1 đến ${choices.length}.`));
  }
}

export async function askNumber(
  question: string,
  fallback: number,
  opts: { min?: number; max?: number } = {}
): Promise<number> {
  const { min = -Infinity, max = Infinity } = opts;
  for (;;) {
    const raw = await ask(
      chalk.gray(`  › ${question} [${fallback}]: `),
      String(fallback)
    );
    const n = Number(raw);
    if (Number.isFinite(n) && n >= min && n <= max) return n;
    console.log(
      chalk.red(
        `  ✗ Hãy nhập một số${min > -Infinity ? ` ≥ ${min}` : ""}${max < Infinity ? ` và ≤ ${max}` : ""}.`
      )
    );
  }
}

export async function askText(question: string, fallback = ""): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  return ask(chalk.gray(`  › ${question}${suffix}: `), fallback);
}

export async function askYesNo(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  for (;;) {
    const raw = (
      await ask(chalk.gray(`  › ${question} (${hint}): `), defaultYes ? "y" : "n")
    ).toLowerCase();
    if (raw === "y" || raw === "yes" || raw === "có" || raw === "co") return true;
    if (raw === "n" || raw === "no" || raw === "không" || raw === "khong") return false;
    console.log(chalk.red("  ✗ Hãy trả lời y (có) hoặc n (không)."));
  }
}
