/** Tiny classnames combiner — filters falsy values, no external dep needed. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
