import { showToast } from "./Toast";

export async function copyText(
  text: string,
  okMessage = "已复制到剪贴板",
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMessage);
    return true;
  } catch {
    showToast("复制失败，请手动选择复制");
    return false;
  }
}
