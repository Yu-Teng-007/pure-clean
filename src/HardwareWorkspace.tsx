import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowsClockwise,
  BatteryCharging,
  BatteryEmpty,
  Cpu,
  Desktop,
  HardDrive,
  HardDrives,
  Memory,
  Monitor,
  Network,
  Circuitry,
  GraphicsCard,
} from "@phosphor-icons/react";
import {
  formatBytes,
  type BatteryInfo,
  type HardwareInfo,
} from "./types";

interface HardwareWorkspaceProps {
  onBack: () => void;
}

function dash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v || "—";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-[12px] text-[var(--color-ink)]/50">{label}</span>
      <span className="min-w-0 text-right font-mono text-[12.5px] text-[var(--color-ink)]/85 break-all">
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ws-list rounded-2xl overflow-hidden">
      <h2 className="px-4 py-2.5 text-[12px] font-semibold text-[var(--color-ink)]/60 border-b border-[var(--color-sand)]/50 flex items-center gap-2">
        <span className="text-[var(--color-sea)]">{icon}</span>
        {title}
      </h2>
      <div className="px-4 py-1 divide-y divide-[var(--color-sand)]/40">{children}</div>
    </section>
  );
}

function batteryLabel(b: BatteryInfo): string {
  if (!b.present) return "台式机 / 无电池";
  const parts: string[] = [];
  if (b.percent != null) parts.push(`${b.percent}%`);
  if (b.charging) parts.push("充电中");
  else if (b.onAc) parts.push("接电源");
  else parts.push("使用电池");
  return parts.join(" · ");
}

function driveLetter(name: string): string {
  const m = name.trim().match(/^([A-Za-z]):/);
  return m ? m[1].toUpperCase() : name.slice(0, 1).toUpperCase() || "?";
}

export default function HardwareWorkspace({ onBack }: HardwareWorkspaceProps) {
  const [info, setInfo] = useState<HardwareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<HardwareInfo>("get_hardware_info");
      setInfo(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const memPct =
    info && info.memory.totalBytes > 0
      ? Math.min(100, (info.memory.usedBytes / info.memory.totalBytes) * 100)
      : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="px-6 pt-4 pb-3 flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0 flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="btn-press mt-0.5 inline-flex size-9 items-center justify-center rounded-xl border border-[var(--color-sand)]/80 bg-white/55 text-[var(--color-ink)]/70 hover:bg-white/80"
            aria-label="返回"
          >
            <ArrowLeft size={16} weight="bold" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="ws-mode-icon flex size-9 items-center justify-center rounded-xl">
                <Cpu size={18} weight="duotone" />
              </span>
              <div className="min-w-0">
                <h1 className="text-[1.15rem] font-semibold tracking-tight text-[var(--color-ink)]">
                  硬件信息
                </h1>
                <p className="mt-0.5 text-[12px] text-[var(--color-ink)]/55">
                  本机系统与硬件概况
                  {info?.os.hostname ? ` · ${info.os.hostname}` : ""}
                </p>
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)]/80 bg-white/55 px-3 py-2 text-xs font-medium text-[var(--color-ink)]/75 hover:bg-white/80 disabled:opacity-50"
        >
          <ArrowsClockwise
            size={14}
            weight="bold"
            className={loading ? "animate-spin" : ""}
          />
          刷新
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {error && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {loading && !info ? (
          <div className="ws-empty rounded-2xl px-5 py-14 text-center text-[13px] text-[var(--color-ink)]/45">
            正在读取硬件信息…
          </div>
        ) : !info ? (
          <div className="ws-empty rounded-2xl px-5 py-14 text-center text-[13px] text-[var(--color-ink)]/45">
            未能读取硬件信息
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl">
            <Section title="系统" icon={<Desktop size={14} weight="duotone" />}>
              <Row label="系统" value={dash(info.os.productName)} />
              <Row label="版本" value={dash(info.os.displayVersion)} />
              <Row label="Build" value={dash(info.os.build)} />
              <Row label="主机名" value={dash(info.os.hostname)} />
              <Row label="架构" value={dash(info.os.architecture)} />
            </Section>

            <Section title="处理器" icon={<Cpu size={14} weight="duotone" />}>
              <Row label="型号" value={dash(info.cpu.name)} />
              <Row
                label="核心"
                value={`${info.cpu.physicalCores} 物理 / ${info.cpu.logicalCores} 逻辑`}
              />
              <Row
                label="频率"
                value={
                  info.cpu.maxClockMhz != null
                    ? `${info.cpu.maxClockMhz} MHz`
                    : "—"
                }
              />
            </Section>

            <Section title="内存" icon={<Memory size={14} weight="duotone" />}>
              <div className="py-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-[var(--color-ink)]/50">
                    已用 {formatBytes(info.memory.usedBytes)}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--color-ink)]/45">
                    可用 {formatBytes(info.memory.availableBytes)} /{" "}
                    {formatBytes(info.memory.totalBytes)}
                  </span>
                </div>
                <div
                  className="home-disk-track"
                  role="meter"
                  aria-valuenow={Math.round(memPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`内存已用 ${Math.round(memPct)}%`}
                >
                  <div
                    className={`home-disk-fill ${memPct >= 90 ? "home-disk-fill--tight" : ""}`}
                    style={{ width: `${memPct}%` }}
                  />
                </div>
              </div>
            </Section>

            <Section title="主板" icon={<Circuitry size={14} weight="duotone" />}>
              <Row label="制造商" value={dash(info.board.manufacturer)} />
              <Row label="产品" value={dash(info.board.product)} />
              <Row label="BIOS" value={dash(info.board.biosVersion)} />
            </Section>

            <Section title="显卡" icon={<GraphicsCard size={14} weight="duotone" />}>
              {info.gpus.length === 0 ? (
                <p className="py-3 text-[12px] text-[var(--color-ink)]/45">未检测到显卡</p>
              ) : (
                info.gpus.map((g, i) => (
                  <Row key={`${g.name}-${i}`} label={`GPU ${i + 1}`} value={dash(g.name)} />
                ))
              )}
            </Section>

            <Section title="磁盘" icon={<HardDrives size={14} weight="duotone" />}>
              {info.drives.length === 0 ? (
                <p className="py-3 text-[12px] text-[var(--color-ink)]/45">未检测到磁盘</p>
              ) : (
                <ul className="py-2 space-y-3.5">
                  {info.drives.map((drive) => {
                    const used = Math.max(0, drive.totalBytes - drive.freeBytes);
                    const pct =
                      drive.totalBytes > 0
                        ? Math.min(100, (used / drive.totalBytes) * 100)
                        : 0;
                    return (
                      <li key={drive.name}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <span
                              className="home-drive-icon relative flex size-7 shrink-0 items-center justify-center rounded-lg"
                              aria-hidden
                            >
                              <HardDrive size={16} weight="duotone" />
                              <span className="home-drive-letter absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-[4px] font-mono text-[8px] font-bold leading-none">
                                {driveLetter(drive.name)}
                              </span>
                            </span>
                            <span className="truncate text-[13px] font-semibold font-mono tracking-tight">
                              {drive.name}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] font-mono text-[var(--color-ink)]/50">
                            可用 {formatBytes(drive.freeBytes)}
                          </span>
                        </div>
                        <div
                          className="home-disk-track"
                          role="meter"
                          aria-valuenow={Math.round(pct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${drive.name} 已用 ${Math.round(pct)}%`}
                        >
                          <div
                            className={`home-disk-fill ${pct >= 90 ? "home-disk-fill--tight" : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10.5px] font-mono text-[var(--color-ink)]/40">
                          {formatBytes(used)} / {formatBytes(drive.totalBytes)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title="显示器" icon={<Monitor size={14} weight="duotone" />}>
              {info.displays.length === 0 ? (
                <p className="py-3 text-[12px] text-[var(--color-ink)]/45">未检测到显示器</p>
              ) : (
                info.displays.map((d, i) => (
                  <div key={`${d.name}-${i}`} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                        {dash(d.name)}
                      </span>
                      {d.isPrimary && (
                        <span className="rounded-md bg-[var(--color-sea)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-sea)]">
                          主屏
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-ink)]/45">
                      {d.width}×{d.height}
                      {d.refreshHz != null ? ` @ ${d.refreshHz} Hz` : ""}
                    </p>
                  </div>
                ))
              )}
            </Section>

            <Section title="网卡" icon={<Network size={14} weight="duotone" />}>
              {info.networks.length === 0 ? (
                <p className="py-3 text-[12px] text-[var(--color-ink)]/45">未检测到网卡</p>
              ) : (
                info.networks.map((n, i) => (
                  <div key={`${n.name}-${i}`} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                        {dash(n.name)}
                      </span>
                      <span className="rounded-md bg-[var(--color-ink)]/6 px-1.5 py-0.5 text-[10px] text-[var(--color-ink)]/50">
                        {n.adapterType}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          n.operational
                            ? "text-[var(--color-sea)] bg-[var(--color-sea)]/10"
                            : "text-[var(--color-ink)]/45 bg-[var(--color-ink)]/6"
                        }`}
                      >
                        {n.operational ? "已连接" : "未连接"}
                      </span>
                    </div>
                    {n.description && n.description !== n.name && (
                      <p className="mt-0.5 text-[11px] text-[var(--color-ink)]/42 truncate">
                        {n.description}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-ink)]/45">
                      {n.mac || "无 MAC"}
                      {n.ipv4.length > 0 ? ` · ${n.ipv4.join(", ")}` : ""}
                    </p>
                  </div>
                ))
              )}
            </Section>

            <Section
              title="电池"
              icon={
                info.battery.present ? (
                  <BatteryCharging size={14} weight="duotone" />
                ) : (
                  <BatteryEmpty size={14} weight="duotone" />
                )
              }
            >
              <Row label="状态" value={batteryLabel(info.battery)} />
              {info.battery.present && (
                <>
                  <Row
                    label="电源"
                    value={info.battery.onAc ? "交流电源" : "电池供电"}
                  />
                  <Row
                    label="充电"
                    value={info.battery.charging ? "是" : "否"}
                  />
                </>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
