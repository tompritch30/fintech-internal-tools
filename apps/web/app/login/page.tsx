import { redirect } from "next/navigation";
import { buttonClass } from "@fit/ui";
import { getCurrentUser } from "../../lib/auth.ts";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="login-card stack">
      <h1 className="page-title">Internal tools</h1>
      <p>Sign in with your company account.</p>
      {error ? (
        <p className="error" role="alert">
          Sign-in failed. Please try again.
        </p>
      ) : null}
      <a className={buttonClass("primary")} href="/auth/login">
        Sign in
      </a>
    </main>
  );
}
