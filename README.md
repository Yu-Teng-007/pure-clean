# Pure Clean

面向开发者的 Windows 桌面磁盘清理工具。扫描并安全删除构建产物、包管理器缓存、Gradle/Python 缓存，以及 Temp、回收站、浏览器缓存等系统垃圾。

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

## 默认扫描

- 项目根：`D:\YHDJA`（若存在，可在界面中增删）
- 全局定点：npm / yarn / pnpm 缓存、Gradle / Maven、pip、Cargo registry
- 系统：`%TEMP%`、回收站、Chrome / Edge 缓存

配置保存在 `%APPDATA%\pure-clean\config.json`。

## 安全说明

- 扫描与删除分离；删除前需二次确认
- Maven 仓库、pnpm store、浏览器缓存等默认不勾选
- 删除失败时会提示文件占用，请关闭相关程序后重试
