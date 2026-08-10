# Pure Clean

面向开发者的 Windows 桌面磁盘清理工具。首页提供多种入口，进入后按场景扫描并安全删除。

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

- **智能优化**（首页主入口）：一键安全清理 + 按启发式建议禁用非必要开机项，并生成报告
- **清理工具**：汇总各场景清理（安全 / 开发 / 系统 / 大文件 / 重复 / 闲置 / 安装包 / Docker）
- **开机项管理**：列出并启用/禁用 `HKCU`/`HKLM` Run 与 Startup 文件夹中的启动项
- **内存清理**：查看内存占用与高占用进程，一键压缩工作集并尝试刷新待机列表
- **硬件信息**：检测本机系统、CPU、内存、显卡、主板、磁盘、显示器、网卡与电池概况

### 清理工具内模式

- **一键安全清理**：仅保留「安全」风险项并默认全选（仅清理，不改开机项）
- **开发清理**：构建产物、包管理器 / 语言工具缓存、IDE 缓存、闲置 `node_modules`
- **系统清理**：临时目录、回收站、浏览器缓存、缩略图、Delivery Optimization、Prefetch、Windows Update、Windows.old
- **大文件清理**：扫描根内 ≥ 阈值（默认 500 MB）的单个文件
- **重复文件**：按大小 + 内容哈希分组；默认只勾选副本、保留一份
- **闲置文件**：扫描根与「下载」文件夹中超过 N 天未修改的文件
- **安装包 / 镜像**：`*.msi` / setup 类 `*.exe` / `*.iso` 与 Android SDK 残留
- **Docker / WSL**：虚拟磁盘（vhdx）与 `docker system prune`

默认项目根：`D:\YHDJA`（若存在）。配置保存在 `%APPDATA%\pure-clean\config.json`，清理历史在 `history.json`，禁用的注册表开机项备份在 `startup-disabled.json`。

## 体验与安全

- 扫描与删除分离；删除前二次确认
- **保护路径**：永不扫描 / 删除的白名单（首页与工作台均可配置）
- **模拟清理（Dry-run）**：只估算释放空间，不实际删除
- **移到回收站**：可选代替永久删除
- 清理报告按分类汇总，并写入本地历史
- 首页展示各盘剩余空间与最近清理记录
- Maven / pnpm store / 浏览器缓存 / 大文件 / IDE / node_modules / Docker 等默认不勾选
- 清理进行中不可返回首页；删除失败会提示文件占用

删除 Docker / WSL 虚拟磁盘前请先关闭 Docker Desktop 并执行 `wsl --shutdown`。
