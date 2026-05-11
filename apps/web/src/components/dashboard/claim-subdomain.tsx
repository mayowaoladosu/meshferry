"use client";

import { normalizeSubdomain } from "@meshferry/core";
import { Globe2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ClaimSubdomain({ gatewayHost }: { gatewayHost: string }) {
  const [value, setValue] = useState("api-dev");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const normalized = normalizeSubdomain(value);

  return (
    <section className="mesh-panel p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-bold">
            <Globe2 size={18} className="text-[#087f8c]" />
            Reserve subdomain
          </div>
          <p className="mt-1 text-sm text-[#6a6f68]">Claim a stable URL before you start a tunnel.</p>
        </div>
        <Badge tone="teal">HTTP</Badge>
      </div>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(undefined);
          setMessage(undefined);
          startTransition(async () => {
            const response = await fetch("/api/subdomains/claim", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ slug: value })
            });
            const body = (await response.json()) as { message?: string; reservation?: { slug: string } };
            if (!response.ok) {
              setError(body.message ?? "Could not claim subdomain.");
              return;
            }
            setMessage(`${body.reservation?.slug ?? normalized} is reserved.`);
          });
        }}
      >
        <div className="flex min-w-0 items-center rounded-md border border-[#deded6] bg-white focus-within:ring-2 focus-within:ring-[#087f8c]/20">
          <input
            className="min-w-0 flex-1 rounded-md bg-transparent px-3 py-2.5 text-sm outline-none"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="Subdomain"
          />
          <span className="border-l border-[#deded6] px-3 text-sm text-[#6a6f68]">.{gatewayHost}</span>
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Globe2 size={16} />}
          Claim subdomain
        </Button>
      </form>

      {message ? <p className="mt-3 text-sm font-medium text-[#2f7d4f]">{message}</p> : null}
      {error ? <p className="mt-3 text-sm font-medium text-[#b34834]">{error}</p> : null}
    </section>
  );
}
