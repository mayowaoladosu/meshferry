import { AccountActions } from "@/components/dashboard/account-actions";
import { ApproveTerminalButton } from "@/components/dashboard/approve-terminal";
import { ClaimSubdomain } from "@/components/dashboard/claim-subdomain";
import { DeviceConnectPanel } from "@/components/dashboard/device-connect-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { getViewer } from "@/lib/auth";
import { getDashboardState } from "@/lib/store";
import { gatewayHttpUrl } from "@/lib/utils";
import { Activity, Cable, Clock3, Globe2, KeyRound, ListChecks, Network, Server, TimerReset } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const viewer = await getViewer();
  const state = await getDashboardState(viewer);
  const gatewayHost = new URL(gatewayHttpUrl()).host;
  const approvedDevices = state.devices.filter((device) => device.status === "approved").length;
  const awaitingDevices = state.devices.filter((device) => device.status === "awaiting_approval").length;
  const onlineTunnels = state.tunnels.filter((tunnel) => tunnel.status === "online").length;
  const totalRequests = state.tunnels.reduce((total, tunnel) => total + tunnel.requests, 0);
  const totalBytes = state.tunnels.reduce((total, tunnel) => total + tunnel.bytesIn + tunnel.bytesOut, 0);

  return (
    <main className="dashboard-grid">
      <Sidebar />
      <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="teal">Control plane</Badge>
                <Badge tone={viewer.isDevelopmentAuth ? "amber" : "green"}>
                  {viewer.isDevelopmentAuth ? "Development" : "Clerk secured"}
                </Badge>
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-normal text-[#171717]">Tunnel operations</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6a6f68]">
                Manage organization terminals, reserve stable tunnel names, and monitor the edge gateway from one
                dashboard.
              </p>
            </div>
            <AccountActions isDevelopmentAuth={viewer.isDevelopmentAuth} />
          </header>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Active tunnels"
              value={String(onlineTunnels)}
              detail={`${state.tunnels.length} real tunnel records`}
              icon={Cable}
              tone="teal"
            />
            <StatCard
              label="Linked terminals"
              value={String(approvedDevices)}
              detail={`${awaitingDevices} awaiting approval`}
              icon={KeyRound}
              tone="green"
            />
            <StatCard
              label="Reserved names"
              value={String(state.subdomains.length)}
              detail={`Wildcard host ${gatewayHost}`}
              icon={Globe2}
              tone="violet"
            />
            <StatCard
              label="Edge requests"
              value={String(totalRequests)}
              detail={`${formatBytes(totalBytes)} proxied`}
              icon={Activity}
              tone="coral"
            />
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
            <DeviceConnectPanel link={state.activeLink} orgId={state.org.id} />
            <ClaimSubdomain gatewayHost={gatewayHost} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)]">
            <section className="mesh-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#deded6] px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold">Tunnel inventory</h2>
                  <p className="mt-1 text-sm text-[#6a6f68]">HTTP, TCP, and UDP ports share the same agent protocol.</p>
                </div>
                <Network size={19} className="text-[#087f8c]" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="bg-[#f0f5ef] text-xs uppercase text-[#6a6f68]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Protocol</th>
                      <th className="px-5 py-3 font-semibold">Public endpoint</th>
                      <th className="px-5 py-3 font-semibold">Target</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Requests</th>
                      <th className="px-5 py-3 font-semibold">Traffic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.tunnels.length === 0 ? (
                      <tr className="border-t border-[#deded6]">
                        <td className="px-5 py-8 text-center text-sm text-[#6a6f68]" colSpan={6}>
                          No tunnels yet. Approve a terminal and run the CLI command to create the first live record.
                        </td>
                      </tr>
                    ) : null}
                    {state.tunnels.map((tunnel) => (
                      <tr key={tunnel.id} className="border-t border-[#deded6]">
                        <td className="px-5 py-4">
                          <Badge tone={tunnel.protocol === "http" ? "teal" : tunnel.protocol === "tcp" ? "green" : "violet"}>
                            {tunnel.protocol.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-[#4f554d]">
                          {tunnel.subdomain ? `${tunnel.subdomain}.${gatewayHost}` : "assigned port"}
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-[#4f554d]">{tunnel.target}</td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={`status-dot ${tunnel.status === "online" ? "bg-[#2f7d4f]" : "bg-[#d25b45]"}`}
                            />
                            {tunnel.status}
                          </span>
                        </td>
                        <td className="px-5 py-4">{tunnel.requests}</td>
                        <td className="px-5 py-4">{formatBytes(tunnel.bytesIn + tunnel.bytesOut)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mesh-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Terminal approvals</h2>
                  <p className="mt-1 text-sm text-[#6a6f68]">CLI tokens are released only after web approval.</p>
                </div>
                <Server size={19} className="text-[#087f8c]" />
              </div>
              <div className="space-y-3">
                {state.devices.map((device) => (
                  <div key={device.code} className="rounded-md border border-[#deded6] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-sm font-bold">{device.code}</div>
                        <div className="mt-1 text-sm text-[#6a6f68]">{device.deviceName ?? "Waiting for terminal"}</div>
                      </div>
                      <Badge tone={device.status === "approved" ? "green" : device.status === "awaiting_approval" ? "amber" : "neutral"}>
                        {device.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-[#6a6f68]">
                      <Clock3 size={14} />
                      {device.terminalSeenAt ? `Seen ${new Date(device.terminalSeenAt).toLocaleString()}` : "Not connected"}
                    </div>
                    {device.status === "awaiting_approval" ? (
                      <div className="mt-4">
                        <ApproveTerminalButton code={device.code} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </section>

          <section className="mesh-panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#deded6] px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">Request inspector</h2>
                <p className="mt-1 text-sm text-[#6a6f68]">
                  Live gateway events from real proxied HTTP, TCP, and UDP traffic.
                </p>
              </div>
              <ListChecks size={19} className="text-[#087f8c]" />
            </div>
            <div className="divide-y divide-[#deded6]">
              {state.events.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-[#6a6f68]">
                  No edge events yet. Send traffic through a live tunnel to populate the inspector.
                </div>
              ) : null}
              {state.events.map((event) => (
                <div key={event.id} className="grid gap-3 px-5 py-4 md:grid-cols-[150px_minmax(0,1fr)_220px]">
                  <div className="flex items-start gap-2">
                    <Badge tone={event.protocol === "http" ? "teal" : event.protocol === "tcp" ? "green" : "violet"}>
                      {event.protocol.toUpperCase()}
                    </Badge>
                    {event.status ? <Badge tone={statusTone(event.status)}>{event.status}</Badge> : null}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#171717]">{formatEventName(event.eventType)}</span>
                      {event.method ? <span className="font-mono text-xs text-[#6a6f68]">{event.method}</span> : null}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-[#4f554d]">
                      {event.path ?? event.tunnelId ?? "raw socket event"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[#6a6f68] md:justify-end">
                    <span className="inline-flex items-center gap-1">
                      <TimerReset size={14} />
                      {formatDuration(event.durationMs)}
                    </span>
                    <span>{formatBytes(event.bytesIn + event.bytesOut)}</span>
                    <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(value?: number): string {
  if (value === undefined) return "live";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatEventName(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function statusTone(status: number): "green" | "amber" | "coral" {
  if (status < 300) return "green";
  if (status < 500) return "amber";
  return "coral";
}
