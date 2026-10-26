import { twMerge } from 'tailwind-merge';

/** Combines class names and resolves conflicting Tailwind utilities (the later one wins). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return twMerge(classes.filter(Boolean).join(' '));
}
