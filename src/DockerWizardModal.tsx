import { useState } from "react";
import { Package, X } from "@phosphor-icons/react";
import { showToast } from "./Toast";

interface DockerWizardModalProps {
  open: boolean;
  onClose: () => void;
  onJumpClean: () => void;
}

export default function DockerWizardModal({
  open,
  onClose,
  onJumpClean,
}: DockerWizardModalProps) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const steps = [
    {
      title: "了解 Docker 磁盘占用",
      body: "Docker 镜像、容器与构建缓存常占用数 GB 至数十 GB。净界可列出 WSL/Docker 数据目录，并引导执行 docker system prune。",
    },
    {
      title: "安全清理建议",
      body: "建议先在 Docker Desktop 查看磁盘用量，再清理未使用的镜像与停止的容器。生产环境容器请勿盲目 prune。",
    },
    {
      title: "在净界中处理",
      body: "前往「Docker / WSL」场景清理，可勾选 docker system prune 特殊项。",
    },
  ];

  const current = steps[step]!;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
          <div className="flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--color-sea)]/12 text-[var(--color-sea)]">
              <Package size={22} weight="duotone" />
            </span>
            <div>
              <h3 className="text-base font-semibold">Docker 清理向导</h3>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink)]/45">
                步骤 {step + 1} / {steps.length}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-lg p-1.5 text-[var(--color-ink)]/45 hover:bg-[var(--color-mist)]"
            aria-label="关闭"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="px-5 pb-5">
          <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
            {current.title}
          </h4>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-ink)]/62">
            {current.body}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="btn-press rounded-xl border border-[var(--color-sand)] px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
              >
                上一步
              </button>
            )}
            {step < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="btn-press rounded-xl bg-[var(--color-sea)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                下一步
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  showToast("已跳转到 Docker/WSL 场景清理");
                  onJumpClean();
                  onClose();
                }}
                className="btn-press rounded-xl bg-[var(--color-sea)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                去场景清理
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
