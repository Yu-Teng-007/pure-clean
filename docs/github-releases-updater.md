# 净界 · GitHub Releases 自动更新配置指南

项目内已完成以下配置，你只需完成本文 **4 步** 即可启用应用内自动更新：

- `src-tauri/tauri.conf.json`：updater 已启用、`createUpdaterArtifacts: true`、公钥与 endpoint
- `.github/workflows/release.yml`：推送 `v*` tag 时自动构建 Windows 安装包并上传 Release
- 应用内：**设置 → 软件更新 → 立即检查更新 / 下载并安装**

Updater 检查地址（需与 GitHub 仓库路径一致）：

```text
https://github.com/yuteng77/pure-clean/releases/latest/download/latest.json
```

---

## 第 1 步：在 GitHub 创建仓库并推送代码

当前本地 `origin` 指向 Gitee，需额外添加 **GitHub 远程** 并推送。

1. 在 GitHub 新建空仓库 **`yuteng77/pure-clean`**（建议不勾选「Initialize with README」，避免首次推送冲突）
2. 在本机执行初始化脚本（会自动添加 `github` 远程、检查密钥、可选首次推送）：

```powershell
npm run release:setup
```

或手动：

```bash
cd d:\MYCode\pure-clean
git remote add github https://github.com/yuteng77/pure-clean.git
git push github master
```

> 本项目默认分支为 **`master`**（非 `main`），发版脚本会自动识别当前分支。

若 GitHub 用户名或仓库名不同，请修改 `src-tauri/tauri.conf.json` 中 `plugins.updater.endpoints` 的 URL。

---

## 第 2 步：配置 GitHub Actions Secrets

路径：**GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret**

| Secret 名称 | 填写内容 |
|-------------|----------|
| `TAURI_SIGNING_PRIVATE_KEY` | 本机文件 `src-tauri/.tauri/updater.key` 的**完整内容**（单行 base64，整行复制） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时未设密码则留空；若设了密码则填该密码 |

说明：

- **公钥**已写入 `tauri.conf.json` 的 `pubkey`，会编译进安装包
- **私钥** `updater.key` 已在 `.gitignore` 中，**切勿提交到 Git**
- 若本机没有密钥文件，在项目根目录执行：

```bash
npx tauri signer generate --ci -w src-tauri/.tauri/updater.key -f
```

  然后将 `.key` 内容填入 Secret，并把 `.key.pub` 内容更新到 `tauri.conf.json` 的 `pubkey` 字段。

---

## 第 3 步：打 tag 触发 Release 构建

发版前请统一版本号（`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`）。

### 方式 A：一键脚本（推荐）

```powershell
# PowerShell
.\scripts\release.ps1 patch -Yes

# 或 npm（跨平台）
npm run release -- patch -y
```

脚本会自动：递增/指定版本 → 更新三处版本号 → 提交 → 打 `v*` tag → 推送到 `github` 远程。

常用参数：

| 命令 | 说明 |
|------|------|
| `npm run release -- patch` | patch +1（默认） |
| `npm run release -- 0.2.0 -y` | 指定版本，跳过确认 |
| `npm run release -- minor --dry-run` | 仅预览 |
| `npm run release -- patch --watch` | 推送后用 `gh` 监视 CI |
| `npm run release -- patch -y --watch --publish` | 监视 CI 完成后自动 Publish Draft |

首次发版前请运行 `npm run release:setup` 完成远程与密钥检查。

### 方式 B：手动

```bash
git add .
git commit -m "chore(release): 发布 v0.1.1"
git tag v0.1.1
git push github master
git push github v0.1.1
```

推送 tag 后，GitHub Actions 会运行 `.github/workflows/release.yml`，自动：

1. 在 Windows 上构建 NSIS 安装包（`*-setup.exe`）
2. 签名并生成 `latest.json`
3. 创建 **Draft（草稿）Release**，并上传安装包与 `latest.json`

**发版后请手动操作：** GitHub → **Releases** → 打开对应 Draft → 确认附件齐全 → 点击 **Publish release** 正式发布。

---

## 第 4 步：验证应用内更新

1. 安装 **旧版本**安装包（例如当前 `v0.1.0` 构建产物）
2. 在 GitHub 发布 **更高版本**（例如 `v0.1.1`）并完成 Publish
3. 打开净界 → **设置 → 软件更新**
   - 点击 **「立即检查更新」** → 应提示「发现新版本 …」
   - 点击 **「下载并安装」** → 自动下载、安装并重启

若开启了 **「启动时检查更新」**，启动时发现新版本会 Toast 提示，可到设置中安装。

---

## 常见问题

| 现象 | 可能原因 |
|------|----------|
| 检查更新失败 / 网络错误 | Release 仍为 Draft 未 Publish；或 `latest.json` 未上传 |
| 签名验证失败 | Secret 中的私钥与 `tauri.conf.json` 的 `pubkey` 不是同一对 |
| 始终显示「已是最新」 | 已安装版本 ≥ Release 版本；或 endpoint 仓库路径错误 |
| CI 构建失败 | 未配置 `TAURI_SIGNING_PRIVATE_KEY`；或 Rust/Node 构建报错 |

---

## 后续发版速查

```powershell
npm run release:setup          # 首次：配置 GitHub 远程与密钥
npm run release -- patch -y --watch --publish
# 或 .\scripts\release.ps1 patch -Yes -Watch -Publish
```

然后：等 CI 完成 → GitHub Releases 里 Publish。

**重要：** 第一个**内置 updater 公钥**的安装包发布之后，用户才能通过应用内更新升到后续版本；更早的安装包需手动下载新安装包覆盖安装。
