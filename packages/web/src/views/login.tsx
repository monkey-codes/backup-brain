import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Brain } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginView() {
  const { signIn, session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error } = await signIn(email, password);
    if (error) {
      setError(error.message);
    }

    setSubmitting(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      {/* Background glow effects */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -right-[10%] -top-[10%] h-[40%] w-[60%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute -bottom-[5%] -left-[10%] h-[30%] w-[50%] rounded-full bg-tertiary/5 blur-[100px]" />
      </div>

      <main className="mx-auto flex w-full max-w-sm flex-col items-center">
        {/* Brand anchor */}
        <div className="mb-12 flex flex-col items-center text-center">
          <div className="relative mb-6 flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-surface-container-low">
            <div className="absolute inset-0 bg-primary/10 opacity-50" />
            <Brain className="relative z-10 h-8 w-8 text-primary" />
          </div>
          <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface">
            Backup Brain
          </h1>
          <p className="mt-2 font-body text-sm tracking-wide text-on-surface-variant">
            Secure your digital consciousness.
          </p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="w-full space-y-8">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Neural ID</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Access Key</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full py-4" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        {/* Footer */}
        <footer className="mt-16 text-center">
          <p className="font-body text-sm text-on-surface-variant">
            New explorer?{" "}
            <span className="font-semibold text-primary">Create Archive</span>
          </p>
        </footer>
      </main>
    </div>
  );
}
