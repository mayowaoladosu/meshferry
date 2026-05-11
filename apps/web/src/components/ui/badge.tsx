import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Badge({
  children,
  tone = "neutral",
  className
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "teal" | "amber" | "coral" | "violet";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
        tone === "neutral" && "border-[#deded6] bg-white text-[#4f554d]",
        tone === "green" && "border-[#cbe7d4] bg-[#ecf8ef] text-[#2f7d4f]",
        tone === "teal" && "border-[#bfe5e8] bg-[#e8f7f8] text-[#087f8c]",
        tone === "amber" && "border-[#efd9a5] bg-[#fff8e6] text-[#9a6417]",
        tone === "coral" && "border-[#f0c5bb] bg-[#fff0ec] text-[#b34834]",
        tone === "violet" && "border-[#d8cff5] bg-[#f2effd] text-[#5d4bb8]",
        className
      )}
    >
      {children}
    </span>
  );
}
