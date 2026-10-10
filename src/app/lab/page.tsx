import type { Metadata } from "next";
import { LabPanel } from "@/components/lab-panel";

/**
 * 实验室：/lab
 *
 * 放一些还没定稿的外观想法，用开关的形式让读者自己试。
 * 每个实验都只改外观、默认全关，关掉后站点回到默认样子。
 *
 * 入口只放在底栏（见 site-chrome.tsx），不进主导航：
 * 它是给愿意折腾的人的暗门，不是站点的主要去处。
 */
export const metadata: Metadata = {
  title: "实验室",
  description: "还在试验中的外观开关，可随时打开和关闭。",
};

export default function LabPage() {
  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="page-hero panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">LAB</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">实验室</h1>
        <p className="max-w-xl text-base leading-relaxed text-secondary">
          这里放一些还没定稿的想法，不止外观，开关就在下面。还会有更多的实验功能，随时可能修改或取消。
        </p>
      </header>

      <LabPanel />
    </div>
  );
}
