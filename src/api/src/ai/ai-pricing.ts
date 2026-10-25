export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** USD per million tokens. Estimates only — override by editing here when list prices change. */
const PRICES: { prefix: string; in: number; out: number }[] = [
  { prefix: 'claude-haiku', in: 1, out: 5 },
  { prefix: 'claude-sonnet', in: 3, out: 15 },
  { prefix: 'claude-opus', in: 5, out: 25 },
];
const FALLBACK = { in: 5, out: 25 };

/** Cache reads bill at 0.1x input, cache writes at 1.25x input. */
export function estimateCostUsd(model: string | null | undefined, u: TokenUsage): number {
  const p = PRICES.find((x) => (model ?? '').startsWith(x.prefix)) ?? FALLBACK;
  const usd = (u.input * p.in + u.cacheWrite * p.in * 1.25 + u.cacheRead * p.in * 0.1 + u.output * p.out) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Rough chars->tokens estimate used only for "tokens saved" accounting and previews. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
