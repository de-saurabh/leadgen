/** The public address of a campaign's form, tagged so leads record where they came from. */
export function formUrl(publicUrl: string, slug: string, source: 'link' | 'qr' | 'embed') {
  return `${publicUrl.replace(/\/+$/, '')}/f/${encodeURIComponent(slug)}?src=${source}`;
}

export function embedSnippet(url: string) {
  return `<iframe src="${url}" title="Contact form" style="width:100%;max-width:480px;height:720px;border:0" loading="lazy"></iframe>`;
}

/** Reminder times are stored in minutes; owners think in hours. */
export function offsetsToText(offsets: readonly number[] | undefined): string {
  return (offsets ?? [180]).map((m) => +(m / 60).toFixed(2)).join(', ');
}

export function textToOffsets(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((part) => Math.round(Number(part) * 60))
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
}
