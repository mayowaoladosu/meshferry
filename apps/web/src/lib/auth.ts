import { auth, currentUser } from "@clerk/nextjs/server";

export type Viewer = {
  userId: string;
  orgId: string;
  name: string;
  email?: string;
  isDevelopmentAuth: boolean;
};

export async function getViewer(): Promise<Viewer> {
  if (process.env.CLERK_SECRET_KEY) {
    const session = await auth();
    if (!session.userId) {
      throw new AuthNotConfiguredError("No Clerk session is available.");
    }

    const user = await currentUser();
    return {
      userId: session.userId,
      orgId: session.orgId ?? `org_${session.userId}`,
      name: user?.firstName ?? user?.username ?? "Workspace owner",
      email: user?.primaryEmailAddress?.emailAddress,
      isDevelopmentAuth: false
    };
  }

  if (process.env.MESHFERRY_ALLOW_DEV_AUTH === "true") {
    return developmentViewer();
  }

  throw new AuthNotConfiguredError("Set Clerk keys or MESHFERRY_ALLOW_DEV_AUTH=true for local development.");
}

export function developmentViewer(): Viewer {
  return {
    userId: "user_development",
    orgId: "org_development",
    name: "Development Workspace",
    email: "dev@meshferry.local",
    isDevelopmentAuth: true
  };
}

export class AuthNotConfiguredError extends Error {}
