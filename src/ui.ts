import * as readline from "node:readline";

// ANSI color codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

export const ui = {
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,

  banner() {
    console.log();
    console.log(
      `${BOLD}${CYAN}  passkeys-rescue${RESET} ${DIM}v1.0.0${RESET}`
    );
    console.log(
      `${DIM}  Rescue your passkeys when domain is lost${RESET}`
    );
    console.log();
  },

  step(n: number, total: number, msg: string) {
    console.log(`  ${BLUE}[${n}/${total}]${RESET} ${msg}`);
  },

  success(msg: string) {
    console.log(`  ${GREEN}✔${RESET} ${msg}`);
  },

  warn(msg: string) {
    console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
  },

  error(msg: string) {
    console.log(`  ${RED}✘${RESET} ${msg}`);
  },

  info(msg: string) {
    console.log(`  ${CYAN}ℹ${RESET} ${msg}`);
  },

  divider() {
    console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
  },
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` ${DIM}(${defaultValue})${RESET}` : "";
  return new Promise((resolve) => {
    rl.question(`  ${CYAN}?${RESET} ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

export function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(
      `  ${CYAN}?${RESET} ${question} ${DIM}(${hint})${RESET}: `,
      (answer) => {
        const a = answer.trim().toLowerCase();
        if (a === "") resolve(defaultYes);
        else resolve(a === "y" || a === "yes");
      }
    );
  });
}

export function select(
  question: string,
  options: string[]
): Promise<number> {
  console.log(`  ${CYAN}?${RESET} ${question}`);
  options.forEach((opt, i) => {
    console.log(`    ${BOLD}${i + 1}${RESET}) ${opt}`);
  });
  return new Promise((resolve) => {
    rl.question(`  ${DIM}Enter choice (1-${options.length})${RESET}: `, (answer) => {
      const n = parseInt(answer.trim(), 10);
      if (n >= 1 && n <= options.length) resolve(n - 1);
      else resolve(0);
    });
  });
}

export function closePrompt() {
  rl.close();
}
