"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Field, Input } from "@sage/ui";
import { authClient } from "../../lib/auth-client";
import { getPublicConfig } from "../../lib/api";
import { AuthShell } from "../../components/auth-shell";

/** Mirrors better-auth's minimum; stated up front rather than after a rejected
 *  submit. */
const MIN_PASSWORD = 8;

export default function SignUpPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [allowSignup, setAllowSignup] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    void getPublicConfig()
      .then((c) => setAllowSignup(c.allowSignup))
      .catch(() => setAllowSignup(true));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { error: authError } = await authClient.signUp.email({ name, email, password });
    setSubmitting(false);
    if (authError) {
      setError(authError.message ?? "Sign-up failed.");
      return;
    }
    queryClient.clear();
    router.push("/");
    router.refresh();
  }

  if (allowSignup === null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!allowSignup) {
    return (
      <AuthShell
        title="Registration closed"
        subtitle="This instance is not accepting new accounts."
      >
        <p className="text-sm text-muted-foreground">
          That is the normal setting for a single-user self-host. Sign in if you already have
          access, or ask whoever runs this instance to set{" "}
          <code className="rounded-badge bg-surface-active px-1 py-0.5 text-xs">
            ALLOW_SIGNUP=true
          </code>
          .
        </p>
        <p className="mt-5 border-t border-hairline pt-4 text-center text-sm text-muted-foreground">
          <Link href="/sign-in" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account per person on this instance."
      footer={
        // Set before the first password is chosen, not after it is forgotten.
        <p>There is no email password reset — keep this password somewhere safe.</p>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Field label="Name" htmlFor="signup-name">
          <Input
            id="signup-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Email" htmlFor="signup-email">
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Password"
          htmlFor="signup-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Sign up"}
        </Button>
        <p className="border-t border-hairline pt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
