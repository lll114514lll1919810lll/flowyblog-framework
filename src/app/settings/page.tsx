import type { Metadata } from "next";
import { SettingsPanel } from "@/components/settings-panel";

/**
 * 设置：/settings
 *
 * 站点的外观设置，分「稳定」「实验」两区：稳定区是定稿的外观
 * （实底、书本、圆角），实验区是还在试验的想法。开关状态只存在
 * 本机浏览器（见 lib/labs.ts），不影响内容，也不进 URL。
 *
 * 顶栏入口与首页/文章/标签/关于并列；这里取代了原来的 /lab 实验室页。
 */
export const metadata: Metadata = {
  title: "设置",
  description: "站点外观设置：纸面、圆角、字体等，选择只保存在本机。",
};

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="page-hero panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">SETTINGS</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">设置</h1>
        <p className="max-w-xl text-base leading-relaxed text-secondary">
          站点的外观在这里调：已定稿的放在「稳定」，还在试验的放在「实验」。
          选择只保存在你这台设备的浏览器里。
        </p>
      </header>

      <SettingsPanel />
    </div>
  );
}
