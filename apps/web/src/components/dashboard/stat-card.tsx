import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "teal" | "green" | "coral" | "violet";
}) {
  const colors = {
    teal: "bg-[#e8f7f8] text-[#087f8c]",
    green: "bg-[#ecf8ef] text-[#2f7d4f]",
    coral: "bg-[#fff0ec] text-[#d25b45]",
    violet: "bg-[#f2effd] text-[#6f5bd7]"
  };

  return (
    <section className="mesh-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-[#6a6f68]">{label}</div>
          <div className="mt-2 text-2xl font-bold text-[#171717]">{value}</div>
          <div className="mt-1 text-sm text-[#6a6f68]">{detail}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${colors[tone]}`}>
          <Icon size={19} />
        </div>
      </div>
    </section>
  );
}
