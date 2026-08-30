"use client";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { authClient } from "../lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await authClient.signOut();
    queryClient.clear();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      className="flex w-full items-center gap-2 rounded-control px-1.5 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
    >
      <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
      Sign out
    </button>
  );
}
