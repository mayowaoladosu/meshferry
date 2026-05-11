"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function ApproveTerminalButton({ code }: { code: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(undefined);
          setMessage(undefined);
          startTransition(async () => {
            const response = await fetch("/api/devices/confirm", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code })
            });
            const body = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(body.message ?? "Could not approve terminal.");
              return;
            }
            setMessage("Terminal approved. The CLI will receive its token on the next poll.");
            router.refresh();
          });
        }}
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
        Approve terminal
      </Button>
      {message ? <p className="text-sm font-medium text-[#2f7d4f]">{message}</p> : null}
      {error ? <p className="text-sm font-medium text-[#b34834]">{error}</p> : null}
    </div>
  );
}
