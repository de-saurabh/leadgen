const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

const STYLES = `
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;background:#fafaf9}
  main{max-width:30rem;margin:0 auto;padding:1.25rem 1rem 3rem}
  h1{font-size:1.5rem;line-height:1.25;margin:.5rem 0 1.25rem}
  label,legend{display:block;font-weight:600;margin:0 0 .35rem}
  .field{margin:0 0 1.1rem;border:0;padding:0}
  input[type=text],input[type=tel],input[type=email],input[type=number],input[type=date],select,textarea{
    width:100%;padding:.65rem .75rem;font:inherit;border:1px solid #d6d3d1;border-radius:.5rem;background:#fff}
  textarea{min-height:5.5rem}
  .choice{display:flex;gap:.6rem;align-items:center;font-weight:400;margin:.3rem 0}
  .hint{color:#78716c;font-size:.875rem;margin:.25rem 0 0}
  .error{color:#b91c1c;font-size:.875rem;margin:.25rem 0 0}
  .banner{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:.75rem;border-radius:.5rem;margin:0 0 1.25rem}
  button,.button{display:block;width:100%;text-align:center;text-decoration:none;font:inherit;font-weight:600;
    padding:.8rem 1rem;border:0;border-radius:.5rem;background:#16a34a;color:#fff;cursor:pointer}
  .hp{position:absolute;left:-9999px;height:0;overflow:hidden}
  .muted{color:#57534e}
`;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
