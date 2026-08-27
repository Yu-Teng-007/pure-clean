/** 解析后端返回的本地时间 `YYYY-MM-DD HH:MM:SS`（兼容旧版 `… UTC`） */
export function parseAppTimestamp(raw: string): Date | null {
  const trimmed = raw.trim();
  const legacyUtc = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC$/,
  );
  if (legacyUtc) {
    const [, y, mo, d, h, mi, s] = legacyUtc.map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  }
  const local = trimmed.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!local) return null;
  const [, y, mo, d, h, mi, s] = local.map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

export function formatRelativeTime(raw: string): string {
  const date = parseAppTimestamp(raw);
  if (!date) return raw;

  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  if (day < 30) return `${Math.floor(day / 7)} 周前`;
  return raw.slice(0, 10);
}

export function formatFriendlyTimestamp(raw: string): string {
  const date = parseAppTimestamp(raw);
  const localLabel = date
    ? date.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : raw.slice(0, 16);
  const rel = formatRelativeTime(raw);
  if (rel !== raw.slice(0, 10) && !rel.includes("-")) {
    return `${rel} · ${localLabel}`;
  }
  return localLabel;
}

export function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了，注意休息";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}
