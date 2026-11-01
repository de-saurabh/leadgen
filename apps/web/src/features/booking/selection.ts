/** `ids` with `id` added or removed, without duplicates. */
export function toggled(ids: readonly string[], id: string, on: boolean): string[] {
  const without = ids.filter((x) => x !== id);
  return on ? [...without, id] : without;
}
