#!/usr/bin/env node
/**
 * 一键发布：统一版本号 → 提交 → 打 tag → 推送到 GitHub 触发 CI
 *
 * 用法：
 *   npm run release -- 0.1.1          指定版本
 *   npm run release -- patch          递增 patch（默认）
 *   npm run release -- minor -y       递增 minor，跳过确认
 *   npm run release -- patch --dry-run
 *   npm run release -- patch --remote origin
 */

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const VERSION_FILES = {
  packageJson: join(root, "package.json"),
  tauriConf: join(root, "src-tauri", "tauri.conf.json"),
  cargoToml: join(root, "src-tauri", "Cargo.toml"),
};

const SEMVER = /^\d+\.\d+\.\d+$/;
const BUMP_TYPES = new Set(["patch", "minor", "major"]);

function run(cmd, { dryRun = false, capture = false } = {}) {
  console.log(`$ ${cmd}`);
  if (dryRun) return capture ? "" : undefined;
  return execSync(cmd, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
  });
}

function readVersions() {
  const pkg = JSON.parse(readFileSync(VERSION_FILES.packageJson, "utf8"));
  const tauri = JSON.parse(readFileSync(VERSION_FILES.tauriConf, "utf8"));
  const cargo = readFileSync(VERSION_FILES.cargoToml, "utf8");
  const cargoMatch = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  return {
    packageJson: pkg.version,
    tauriConf: tauri.version,
    cargoToml: cargoMatch?.[1] ?? null,
  };
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`未知 bump 类型: ${type}`);
  }
}

function resolveTargetVersion(current, arg) {
  if (!arg || arg === "patch") {
    return bumpVersion(current, "patch");
  }
  if (BUMP_TYPES.has(arg)) {
    return bumpVersion(current, arg);
  }
  if (SEMVER.test(arg)) {
    return arg;
  }
  throw new Error(`无效版本 "${arg}"，请使用 patch / minor / major 或 x.y.z`);
}

function updateVersions(newVersion) {
  const pkg = JSON.parse(readFileSync(VERSION_FILES.packageJson, "utf8"));
  pkg.version = newVersion;
  writeFileSync(VERSION_FILES.packageJson, `${JSON.stringify(pkg, null, 2)}\n`);

  const tauri = JSON.parse(readFileSync(VERSION_FILES.tauriConf, "utf8"));
  tauri.version = newVersion;
  writeFileSync(VERSION_FILES.tauriConf, `${JSON.stringify(tauri, null, 2)}\n`);

  const cargo = readFileSync(VERSION_FILES.cargoToml, "utf8");
  writeFileSync(
    VERSION_FILES.cargoToml,
    cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`),
  );
}

function remoteExists(remote) {
  try {
    run(`git remote get-url ${remote}`, { capture: true });
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch() {
  return run("git rev-parse --abbrev-ref HEAD", { capture: true }).trim();
}

function tagExists(tag) {
  try {
    run(`git rev-parse ${tag}`, { capture: true });
    return true;
  } catch {
    return false;
  }
}

function hasGhCli() {
  try {
    run("gh --version", { capture: true });
    return true;
  } catch {
    return false;
  }
}

function getGhRepo(remote) {
  const url = run(`git remote get-url ${remote}`, { capture: true }).trim();
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return match?.[1] ?? null;
}

function parseArgs(argv) {
  const opts = {
    versionArg: null,
    remote: "github",
    dryRun: false,
    yes: false,
    skipPush: false,
    watch: false,
    publish: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--remote":
      case "-r":
        opts.remote = argv[++i];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--yes":
      case "-y":
        opts.yes = true;
        break;
      case "--skip-push":
        opts.skipPush = true;
        break;
      case "--watch":
        opts.watch = true;
        break;
      case "--publish":
        opts.publish = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`未知参数: ${arg}`);
        }
        if (!opts.versionArg) {
          opts.versionArg = arg;
        }
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
净界一键发布

用法:
  npm run release -- [版本|patch|minor|major] [选项]

示例:
  npm run release -- patch
  npm run release -- 0.2.0 -y
  npm run release -- minor --dry-run

选项:
  -r, --remote <name>   推送远程（默认 github）
  -y, --yes             跳过确认
      --dry-run         仅预览，不写文件、不执行 git
      --skip-push       本地提交与打 tag，不推送
      --watch           推送后用 gh 监视 Actions（需安装 gh）
      --publish         CI 完成后用 gh 将 Draft 发布为正式版
  -h, --help            显示帮助
`);
}

async function confirm(message) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${message} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

function gitCommit(message, paths, dryRun) {
  const msgPath = join(tmpdir(), `pure-clean-release-${Date.now()}.txt`);
  if (!dryRun) {
    writeFileSync(msgPath, message, "utf8");
  }
  const pathArgs = paths.map((p) => `"${p}"`).join(" ");
  try {
    run(`git commit -F "${msgPath}" -- ${pathArgs}`, { dryRun });
  } finally {
    if (!dryRun) {
      try {
        unlinkSync(msgPath);
      } catch {
        /* ignore */
      }
    }
  }
}

function getPorcelainStatus() {
  return run("git status --porcelain", { capture: true })
    .split("\n")
    .filter(Boolean);
}

const VERSION_PATHS = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
];

function checkWorkingTree(opts) {
  const lines = getPorcelainStatus();
  if (lines.length === 0) return;

  const versionSet = new Set(VERSION_PATHS);
  const other = lines.filter((line) => {
    const path = line.slice(3).trim().replace(/^".*?" -> "(.+)"$/, "$1");
    const normalized = path.replace(/\\/g, "/");
    return !versionSet.has(normalized);
  });

  if (other.length === 0) return;

  console.warn("\n⚠ 工作区还有其他未提交变更（本次发布不会包含它们）：");
  for (const line of other.slice(0, 10)) {
    console.warn(`  ${line}`);
  }
  if (other.length > 10) {
    console.warn(`  … 另有 ${other.length - 10} 项`);
  }

  if (!opts.yes && !opts.dryRun) {
    return confirm("仍继续发布？");
  }
}

async function publishDraftRelease(tag, remote, dryRun) {
  if (!hasGhCli()) {
    console.warn("⚠ 未安装 gh CLI，跳过自动 Publish");
    return false;
  }
  const repo = getGhRepo(remote);
  if (!repo) {
    console.warn("⚠ 无法解析 GitHub 仓库，跳过自动 Publish");
    return false;
  }
  console.log(`\n→ 发布 Draft Release（${repo} ${tag}）…`);
  run(`gh release edit ${tag} --repo ${repo} --draft=false`, { dryRun });
  return true;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const versions = readVersions();
  const current = versions.packageJson;

  const mismatched = Object.entries(versions).filter(([, v]) => v !== current);
  if (mismatched.length > 0) {
    console.warn("⚠ 版本号不一致：");
    for (const [file, v] of mismatched) {
      console.warn(`  ${file}: ${v}（package.json 为 ${current}）`);
    }
    if (!opts.yes && !opts.dryRun) {
      const ok = await confirm("仍继续发布？");
      if (!ok) process.exit(1);
    }
  }

  const newVersion = resolveTargetVersion(current, opts.versionArg);
  const tag = `v${newVersion}`;
  const branch = getCurrentBranch();

  if (tagExists(tag)) {
    throw new Error(`本地已存在 tag ${tag}，请先删除或换版本号`);
  }

  if (!opts.skipPush && !opts.dryRun && !remoteExists(opts.remote)) {
    throw new Error(
      `远程 "${opts.remote}" 不存在。请先运行：npm run release:setup`,
    );
  }

  const dirtyOk = await checkWorkingTree(opts);
  if (dirtyOk === false) {
    console.log("已取消。");
    process.exit(0);
  }

  console.log("\n净界 · 一键发布\n");
  console.log(`  当前版本: ${current}`);
  console.log(`  新版本:   ${newVersion}`);
  console.log(`  Tag:      ${tag}`);
  console.log(`  分支:     ${branch}`);
  console.log(`  远程:     ${opts.remote}`);
  if (opts.dryRun) console.log("  模式:     dry-run（预览）");
  if (opts.skipPush) console.log("  推送:     跳过");
  console.log("");

  if (!opts.yes && !opts.dryRun) {
    const ok = await confirm("确认发布？");
    if (!ok) {
      console.log("已取消。");
      process.exit(0);
    }
  }

  console.log("\n→ 更新版本文件…");
  if (!opts.dryRun) {
    updateVersions(newVersion);
  }
  console.log("  ✓ package.json");
  console.log("  ✓ src-tauri/tauri.conf.json");
  console.log("  ✓ src-tauri/Cargo.toml");

  const commitMsg = `chore(release): 发布 ${tag}

- 更新 package.json、tauri.conf.json、Cargo.toml 版本号为 ${newVersion}
- 推送 ${tag} 触发 GitHub Actions 构建 Release`;

  console.log("\n→ Git 提交…");
  run("git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml", {
    dryRun: opts.dryRun,
  });
  gitCommit(commitMsg, VERSION_PATHS, opts.dryRun);

  console.log("\n→ 创建 tag…");
  run(`git tag ${tag}`, { dryRun: opts.dryRun });

  if (!opts.skipPush) {
    console.log("\n→ 推送到远程…");
    run(`git push ${opts.remote} ${branch}`, { dryRun: opts.dryRun });
    run(`git push ${opts.remote} ${tag}`, { dryRun: opts.dryRun });
  }

  console.log("\n✓ 发布流程已完成。\n");

  let published = false;
  if (opts.watch && !opts.dryRun && !opts.skipPush && hasGhCli()) {
    const repo = getGhRepo(opts.remote);
    if (repo) {
      console.log(`→ 监视 GitHub Actions（${repo}）…`);
      run(`gh run watch --repo ${repo}`, { dryRun: false });
      if (opts.publish) {
        published = await publishDraftRelease(tag, opts.remote, opts.dryRun);
      }
    } else {
      console.warn("⚠ 无法解析 GitHub 仓库地址，跳过 --watch");
    }
  }

  if (opts.publish && !published && !opts.dryRun && !opts.skipPush) {
    published = await publishDraftRelease(tag, opts.remote, opts.dryRun);
  }

  if (published) {
    console.log("✓ Release 已 Publish，用户可检查应用内更新。\n");
  } else {
    console.log("后续步骤：");
    console.log("  1. 打开 GitHub → Actions，等待 Release 工作流完成");
    console.log("  2. GitHub → Releases → 打开 Draft → Publish release");
    console.log("     （或：npm run release -- patch -y --watch --publish）");
    console.log("  3. 旧版应用：设置 → 软件更新 → 检查并安装\n");
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message ?? err}`);
  process.exit(1);
});
