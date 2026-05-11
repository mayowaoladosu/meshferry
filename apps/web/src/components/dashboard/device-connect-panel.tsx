import type { DeviceLink } from "@/lib/store";
import { gatewayWebSocketUrl } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { Badge } from "@/components/ui/badge";
import { Terminal, ShieldCheck, TimerReset } from "lucide-react";

export function DeviceConnectPanel({
  link,
  orgId
}: {
  link: DeviceLink;
  orgId: string;
}) {
  const command = `meshferry connect --code ${link.code}`;
  const tunnelCommand = `meshferry tunnel http 3000 --subdomain api-dev --org ${orgId}`;

  return (
    <section className="mesh-panel p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Terminal size={18} className="text-[#087f8c]" />
              <h2 className="text-lg font-bold text-[#171717]">Terminal organization link</h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-[#6a6f68]">
              Register in the dashboard first, run the terminal link command, then approve the terminal here before
              the CLI receives a tunnel token.
            </p>
          </div>
          <Badge tone={link.status === "awaiting_approval" ? "amber" : "teal"}>{link.status.replace("_", " ")}</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border border-[#deded6] bg-[#fbfbf7] p-4">
            <ShieldCheck size={18} className="mb-3 text-[#2f7d4f]" />
            <div className="text-sm font-semibold">1. Link code</div>
            <div className="mt-2 font-mono text-lg font-bold">{link.code}</div>
          </div>
          <div className="rounded-md border border-[#deded6] bg-[#fbfbf7] p-4">
            <Terminal size={18} className="mb-3 text-[#087f8c]" />
            <div className="text-sm font-semibold">2. Gateway</div>
            <div className="mt-2 break-all font-mono text-sm text-[#4f554d]">{gatewayWebSocketUrl()}</div>
          </div>
          <div className="rounded-md border border-[#deded6] bg-[#fbfbf7] p-4">
            <TimerReset size={18} className="mb-3 text-[#b7791f]" />
            <div className="text-sm font-semibold">3. Approval window</div>
            <div className="mt-2 text-sm text-[#4f554d]">15 minutes from issue time</div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-[#171717]">Run in your terminal</div>
          <div className="mesh-command flex items-center justify-between gap-3 p-3">
            <code>{command}</code>
            <CopyButton value={command} />
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-[#171717]">Start an HTTP tunnel after approval</div>
          <div className="mesh-command flex items-center justify-between gap-3 p-3">
            <code>{tunnelCommand}</code>
            <CopyButton value={tunnelCommand} />
          </div>
        </div>
      </div>
    </section>
  );
}
