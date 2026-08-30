"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Field, Input } from "@sage/ui";
import { authClient } from "../../lib/auth-client";
import { getPublicConfig } from "../../lib/api";
import { AuthShell } from "../../components/auth-shell";

export default function SignInPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [allowSignup, setAllowSignup] = React.useState(true);

  React.useEffect(() => {
    void getPublicConfig()
      .then((c) => {
        setAllowSignup(c.allowSignup);
        // Nobody has claimed this instance yet, so there is no account to sign
        // in to. Greeting the very first visitor with "Welcome back" and a
        // sign-in form, with registration as a small link underneath, was the
        // first screen a self-hoster saw after `docker compose up`.
        if (c.allowSignup && !c.hasAccounts) router.replace("/sign-up");
      })
      .catch(() => setAllowSignup(true));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { error: authError } = await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (authError) {
      setError(authError.message ?? "Invalid email or password.");
      return;
    }
    queryClient.clear();
    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your portfolio."
      footer={
        <>
          {/* Sage has no email capability at all, by design — the self-hoster
              owns the database. Saying so turns a dead end into a next step;
              staying silent leaves a locked-out user with nothing to try. */}
          <p>
            Forgotten your password? There is no email reset — whoever runs this instance can set a
            new one.
          </p>
          {!allowSignup && (
            // Otherwise the sign-up link simply vanishes and a new user cannot
            // tell a locked-down instance from a broken page.
            <p className="mt-2">Registration is closed on this instance.</p>
          )}
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Field label="Email" htmlFor="signin-email">
          <Input
            id="signin-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="signin-password">
          <Input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        {allowSignup && (
          <p className="border-t border-hairline pt-4 text-center text-sm text-muted-foreground">
            No account yet?{" "}
            <Link href="/sign-up" className="text-primary underline">
              Sign up
            </Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
