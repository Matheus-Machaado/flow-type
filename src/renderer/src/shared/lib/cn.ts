/**
 * `cn` — tiny className combiner.
 *
 * Aceita strings, falsy e arrays; concatena com espaço. Pequeno o suficiente
 * pra não justificar deps externas (clsx/tailwind-merge) no MVP do app desktop.
 */
type ClassValue = string | number | false | null | undefined | ClassValue[]

export function cn(...args: ClassValue[]): string {
  const out: string[] = []
  for (const a of args) {
    if (!a) continue
    if (Array.isArray(a)) {
      const inner = cn(...a)
      if (inner) out.push(inner)
    } else {
      out.push(String(a))
    }
  }
  return out.join(' ')
}
