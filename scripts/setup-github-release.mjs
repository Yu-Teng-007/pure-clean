#!/usr/bin/env node
/**
 * GitHub Releases 发版环境一次性初始化
 *
 * 用法：npm run release:setup
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO = "Yu-Teng-007/pure-clean";
const DEFAULT_REMOTE = "github";
const KEY_PATH = join(root, "src-tauri", ".tauri", "updater.key");
const PUB_PATH = join(root, "src-tauri", ".tauri", "updater.key.pub");
const TAURI_CONF = join(root, "src-tauri", "tauri.conf.json");

function run(cmd, { capture = false } = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
  });
}

function remoteExists(remote) {
  try {
    run(`git remote get-url ${remote}`, { capture: true });
    return true;
  } catch {
    return false;
  }
}

async function confirm(message) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${message} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

function hasGhCli() {
  try {
    run("gh --version", { capture: true });
    return true;
  } catch {
    return false;
  }
}

function getBranch() {
  return run("git rev-parse --abbrev-ref HEAD", { capture: true }).trim();
}

async function main() {
  const repo = process.env.GITHUB_REPO ?? DEFAULT_REPO;
  const remote = process.env.GITHUB_REMOTE ?? DEFAULT_REMOTE;
  const branch = getBranch();

  console.log("\n净界 · GitHub 发版环境初始化\n");
  console.log(`  目标仓库: ${repo}`);
  console.log(`  Git 远程: ${remote}`);
  console.log(`  当前分支: ${branch}\n`);

  // 1. GitHub remote
  if (remoteExists(remote)) {
    const url = run(`git remote get-url ${remote}`, { capture: true }).trim();
    console.log(`✓ 远程 ${remote} 已存在：${url}`);
  } else {
    console.log(`→ 添加远程 ${remote}…`);
    const url = `https://github.com/${repo}.git`;
    run(`git remote add ${remote} ${url}`);
    console.log(`✓ 已添加 ${remote} → ${url}`);
  }

  // 2. Updater 密钥
  if (existsSync(KEY_PATH)) {
    console.log(`✓ 私钥存在：src-tauri/.tauri/updater.key`);
  } else {
    console.log("→ 生成 updater 签名密钥…");
    run("npx tauri signer generate --ci -w src-tauri/.tauri/updater.key -f");
    console.log("✓ 已生成 updater.key / updater.key.pub");
    console.warn(
      "\n⚠ 请将 updater.key 全文填入 GitHub Secret：TAURI_SIGNING_PRIVATE_KEY",
    );
    console.warn(
      "  并将 updater.key.pub 内容更新到 tauri.conf.json 的 pubkey（若尚未更新）\n",
    );
  }

  if (existsSync(PUB_PATH)) {
    const pub = readFileSync(PUB_PATH, "utf8").trim();
    const tauri = JSON.parse(readFileSync(TAURI_CONF, "utf8"));
    const configured = tauri.plugins?.updater?.pubkey?.trim();
    if (configured && configured === pub) {
      console.log("✓ tauri.conf.json pubkey 与 updater.key.pub 一致");
    } else if (configured) {
      console.warn("⚠ tauri.conf.json pubkey 与 updater.key.pub 不一致，请核对");
    }
  }

  // 3. gh CLI
  if (hasGhCli()) {
    console.log("✓ 已安装 GitHub CLI (gh)");
    try {
      run("gh auth status", { capture: true });
      console.log("✓ gh 已登录");
    } catch {
      console.warn("⚠ gh 未登录，执行：gh auth login");
    }
  } else {
    console.warn("⚠ 未安装 gh CLI（可选，用于 --watch / --publish）");
    console.warn("  安装：https://cli.github.com/");
  }

  // 4. 首次推送
  console.log("\n--- GitHub Secrets（需在网页手动配置）---");
  console.log("  TAURI_SIGNING_PRIVATE_KEY         ← updater.key 全文");
  console.log("  TAURI_SIGNING_PRIVATE_KEY_PASSWORD ← 无密码则留空");
  console.log(`  路径：https://github.com/${repo}/settings/secrets/actions\n`);

  const pushed = await confirm(`是否将当前分支 ${branch} 推送到 ${remote}？`);
  if (pushed) {
    run(`git push -u ${remote} ${branch}`);
    console.log(`✓ 已推送 ${branch} → ${remote}`);
  }

  console.log("\n--- 就绪 ---");
  console.log("  预览发布：npm run release -- patch --dry-run -y");
  console.log("  正式发版：npm run release -- patch -y --watch --publish");
  console.log(`  文档：docs/github-releases-updater.md\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message ?? err}`);
  process.exit(1);
});
