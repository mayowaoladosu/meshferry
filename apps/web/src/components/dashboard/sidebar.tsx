import { Activity, Cable, CreditCard, Gauge, KeyRound, Network, Settings, Waypoints } from "lucide-react";

const navigation = [
  { label: "Overview", icon: Gauge },
  { label: "Tunnels", icon: Cable },
  { label: "Terminal Link", icon: KeyRound },
  { label: "Domains", icon: Network },
  { label: "Traffic", icon: Activity },
  { label: "Billing", icon: CreditCard },
  { label: "Settings", icon: Settings }
];

export function Sidebar() {
  return (
    <aside className="hidden border-r border-[#deded6] bg-[#fbfbf7]/82 px-5 py-6 lg:block">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#111513] text-white">
          <Waypoints size={21} />
        </div>
        <div>
          <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#6a6f68]">Meshferry</div>
          <div className="text-xs text-[#6a6f68]">Tunnel Console</div>
        </div>
      </div>

      <nav className="space-y-1">
        {navigation.map((item, index) => {
          const Icon = item.icon;
          return (
            <a
              key={item.label}
              href="#"
              className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium ${
                index === 0 ? "bg-[#e8f7f8] text-[#087f8c]" : "text-[#4f554d] hover:bg-[#eef1ea]"
              }`}
            >
              <Icon size={17} />
              {item.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
