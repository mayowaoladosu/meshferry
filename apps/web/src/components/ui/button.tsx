import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  children: ReactNode;
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#087f8c]/30 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && "bg-[#087f8c] text-white hover:bg-[#076d78]",
        variant === "secondary" && "border border-[#deded6] bg-white text-[#171717] hover:bg-[#f0f5ef]",
        variant === "ghost" && "text-[#4f554d] hover:bg-[#eef1ea]",
        variant === "danger" && "bg-[#d25b45] text-white hover:bg-[#bd4f3c]",
        className
      )}
      {...props}
    />
  );
}
