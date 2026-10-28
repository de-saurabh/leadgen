import { WHATSAPP_LIMITS } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Health {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
}

async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  // A 503 still carries a JSON body describing what's down.
  if (res.status !== 200 && res.status !== 503) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Health>;
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 10_000 });

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">LeadGen</h1>
      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>Dashboard ↔ API ↔ Postgres wiring</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <StatusRow label="API" ok={health.isSuccess} pending={health.isPending} />
          <StatusRow label="Database" ok={health.data?.db === 'ok'} pending={health.isPending} />
          <p className="text-muted-foreground">
            Shared package loaded: up to {WHATSAPP_LIMITS.replyButtons.maxButtons} reply buttons and{' '}
            {WHATSAPP_LIMITS.list.maxRows} list rows per WhatsApp message.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function StatusRow({ label, ok, pending }: { label: string; ok: boolean; pending: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      {pending ? (
        <Badge variant="secondary">checking…</Badge>
      ) : ok ? (
        <Badge>up</Badge>
      ) : (
        <Badge variant="destructive">down</Badge>
      )}
    </div>
  );
}
