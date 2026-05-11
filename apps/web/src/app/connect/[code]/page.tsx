import { ApproveTerminalButton } from "@/components/dashboard/approve-terminal";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Badge } from "@/components/ui/badge";
import { getViewer } from "@/lib/auth";
import { getDeviceLinkByCode } from "@/lib/store";
import { CheckCircle2, Clock3, Terminal } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ConnectPage({ params }: { params: Promise<{ code: string }> }) {
  const viewer = await getViewer();
  const { code } = await params;
  const normalizedCode = decodeURIComponent(code).trim().toUpperCase();
  const link = await getDeviceLinkByCode(normalizedCode, viewer.orgId);

  if (!link) notFound();

  return (
    <main className="dashboard-grid">
      <Sidebar />
      <section className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="mesh-panel w-full max-w-2xl p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Badge tone={link.status === "approved" ? "green" : "amber"}>{link.status.replace("_", " ")}</Badge>
            <Link href="/dashboard" className="text-sm font-semibold text-[#087f8c]">
              Back to dashboard
            </Link>
          </div>

          <div className="mb-6 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#e8f7f8] text-[#087f8c]">
              <Terminal size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Approve terminal access</h1>
              <p className="mt-2 text-sm leading-6 text-[#6a6f68]">
                This terminal can connect to your organization only after you approve it here. The CLI will keep
                polling and receives its API token after approval.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-[#deded6] bg-[#fbfbf7] p-4">
              <div className="text-xs uppercase text-[#6a6f68]">Device code</div>
              <div className="mt-2 font-mono text-lg font-bold">{link.code}</div>
            </div>
            <div className="rounded-md border border-[#deded6] bg-[#fbfbf7] p-4">
              <div className="text-xs uppercase text-[#6a6f68]">Terminal</div>
              <div className="mt-2 text-sm font-semibold">{link.deviceName ?? "Not reported yet"}</div>
              <div className="mt-1 text-xs text-[#6a6f68]">{link.platform ?? "Run the connect command first"}</div>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 text-sm text-[#6a6f68]">
            {link.status === "approved" ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
            {link.status === "approved" ? "Terminal has full CLI access." : "Waiting for terminal and approval."}
          </div>

          {link.status === "awaiting_approval" ? (
            <div className="mt-6">
              <ApproveTerminalButton code={link.code} />
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
