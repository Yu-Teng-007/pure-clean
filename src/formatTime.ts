/** 解析后端返回的 `YYYY-MM-DD HH:MM:SS UTC` 时间戳 */
export function parseAppTimestamp(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
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
  const rel = formatRelativeTime(raw);
  if (rel !== raw.slice(0, 10) && !rel.includes("-")) {
    return `${rel} · ${raw.slice(0, 16)}`;
  }
  return raw.slice(0, 16);
}

export function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了，注意休息";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}
