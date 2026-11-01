import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { embedSnippet, formUrl } from './helpers';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be blocked; the text is selectable in the box.
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

export function ShareDialog({
  publicUrl,
  slug,
  campaignName,
}: {
  publicUrl: string;
  slug: string;
  campaignName: string;
}) {
  const link = formUrl(publicUrl, slug, 'link');
  const qrTarget = formUrl(publicUrl, slug, 'qr');
  const embed = embedSnippet(formUrl(publicUrl, slug, 'embed'));
  const [qr, setQr] = useState<string | null>(null);
  const local = /localhost|127\.0\.0\.1/.test(publicUrl);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(qrTarget, { width: 512, margin: 2 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [qrTarget]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Share</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share “{campaignName}”</DialogTitle>
          <DialogDescription>
            Each way of sharing is tagged, so you can see which one brings in leads.
          </DialogDescription>
        </DialogHeader>
        {local && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-950">
            These links point at <strong>{publicUrl}</strong>, which only works on this computer.
            Set <code>BETTER_AUTH_URL</code> to your public address (for example your ngrok URL)
            before sharing with anyone else.
          </p>
        )}
        <Section title="Link">
          <div className="flex items-center gap-2">
            <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 text-xs">
              {link}
            </code>
            <CopyButton text={link} label="Copy" />
          </div>
        </Section>
        <Section title="QR code">
          {qr ? (
            <div className="flex items-center gap-4">
              <img
                src={qr}
                alt={`QR code for ${campaignName}`}
                className="size-32 rounded border"
              />
              <Button asChild size="sm" variant="outline">
                <a href={qr} download={`${slug}-qr.png`}>
                  Download PNG
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Making the QR code…</p>
          )}
        </Section>
        <Section title="Embed on a website">
          <Textarea readOnly rows={4} value={embed} className="font-mono text-xs" />
          <CopyButton text={embed} label="Copy code" />
        </Section>
      </DialogContent>
    </Dialog>
  );
}
