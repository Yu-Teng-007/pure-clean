# Pure Clean

面向开发者的 Windows 桌面磁盘清理工具。首页提供多种入口：一键安全清理、开发清理、系统清理、大文件清理、Docker / WSL；进入后按场景扫描并安全删除。

## 技术栈

- Tauri 2 + Rust
- React + TypeScript + Vite + Tailwind CSS 4

## 开发

```bash
npm install
npm run tauri:dev
```

## 打包

```bash
npm run tauri:build
```

## 清理入口

- **一键安全清理**：合并扫描开发与系统中的「安全」项，默认全选，降低决策成本
- **开发清理**：项目根内的构建产物，npm / yarn / pnpm、Gradle / Maven、pip、Cargo 等全局缓存，Cursor / VS Code / JetBrains IDE 缓存，以及超过闲置天数（默认 30 天）的 `node_modules`
- **系统清理**：`%TEMP%`、回收站、Chrome / Edge / Brave / Firefox 缓存、缩略图、Delivery Optimization、Prefetch、Windows Update 下载缓存、Windows.old（无需配置根目录）
- **大文件清理**：仅在已配置的扫描根目录内查找 ≥ 阈值（默认 500 MB，可调）的单个文件；默认不勾选
- **Docker / WSL**：Docker Desktop / WSL 虚拟磁盘（vhdx），以及 `docker system prune`（高风险，默认不勾选）

默认项目根：`D:\YHDJA`（若存在，可在开发 / 大文件 / 安全清理入口中增删）。配置保存在 `%APPDATA%\pure-clean\config.json`。

## 安全说明

- 扫描与删除分离；删除前需二次确认
- Maven 仓库、pnpm store、浏览器缓存、大文件、IDE 缓存、node_modules、Docker / WSL 等默认不勾选
- 清理进行中不可返回首页
- 删除失败时会提示文件占用，请关闭相关程序后重试
- 删除 Docker / WSL 虚拟磁盘前请先关闭 Docker Desktop 并执行 `wsl --shutdown`
