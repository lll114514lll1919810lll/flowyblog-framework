/** 把 YYYY-MM-DD 格式化成中文日期，例如 2026-10-07 → 2026年10月7日 */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${year}年${Number(month)}月${Number(day)}日`;
}