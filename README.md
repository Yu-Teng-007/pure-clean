# Pure Clean

面向开发者的 Windows 桌面磁盘清理工具。首页提供三种入口：开发清理、系统清理、大文件清理；进入后按场景扫描并安全删除。

## 技术栈

- Tauri 2 + Rust
- React + TypeScript + Vite + Tailwind CSS 4

## 开发

```bash
npm install
npm run tauri dev
```

## 打包

```bash
npm run tauri build
```

## 清理入口

- **开发清理**：项目根内的构建产物，以及 npm / yarn / pnpm、Gradle / Maven、pip、Cargo 等全局开发缓存
- **系统清理**：`%TEMP%`、回收站、Chrome / Edge 缓存（无需配置根目录）
- **大文件清理**：仅在已配置的扫描根目录内查找 ≥ 阈值（默认 500 MB，可调）的单个文件；默认不勾选

默认项目根：`D:\YHDJA`（若存在，可在开发 / 大文件入口中增删）。配置保存在 `%APPDATA%\pure-clean\config.json`。

## 安全说明

- 扫描与删除分离；删除前需二次确认
- Maven 仓库、pnpm store、浏览器缓存、大文件等默认不勾选
- 清理进行中不可返回首页
- 删除失败时会提示文件占用，请关闭相关程序后重试
