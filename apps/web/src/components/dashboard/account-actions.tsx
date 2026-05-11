"use client";

import { SignInButton, SignOutButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AccountActions({ isDevelopmentAuth }: { isDevelopmentAuth: boolean }) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  if (!clerkConfigured || isDevelopmentAuth) {
    return <Badge tone="amber">Development auth</Badge>;
  }

  return <ClerkAccountActions />;
}

function ClerkAccountActions() {
  const { isSignedIn } = useAuth();

  if (isSignedIn) {
    return (
      <div className="flex items-center gap-2">
        <SignOutButton>
          <Button variant="secondary">Sign out</Button>
        </SignOutButton>
        <UserButton />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <SignInButton mode="modal">
        <Button variant="secondary">
          <LogIn size={16} />
          Sign in
        </Button>
      </SignInButton>
      <SignUpButton mode="modal">
        <Button>Register</Button>
      </SignUpButton>
    </div>
  );
}
