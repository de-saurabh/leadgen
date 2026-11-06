import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMe } from '@/features/session/me';
import { authClient } from '@/lib/auth-client';

export function LoginPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (me.data) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) {
      setError(error.status === 401 ? 'Wrong email or password.' : 'Could not sign in. Try again.');
      setSubmitting(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/', { replace: true });
  }

  return (
    <main className="relative mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="rise flex flex-col items-center gap-3 text-center">
        <span className="bg-aurora flex size-14 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-[0_10px_28px_var(--glow)]">
          L
        </span>
        <h1 className="text-aurora text-3xl font-bold tracking-tight">LeadGen</h1>
        <p className="text-muted-foreground text-sm">
          Turn every enquiry into a WhatsApp conversation.
        </p>
      </div>
      <div className="glass rise rounded-3xl p-6" style={{ '--i': 2 } as React.CSSProperties}>
        <div className="mb-5 flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Sign in</h2>
          <p className="text-muted-foreground text-sm">
            Use the account your administrator created for you.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
