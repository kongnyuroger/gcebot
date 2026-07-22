import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The standard shadcn/ui helper: clsx resolves conditional classes, twMerge
// then resolves conflicts between them (e.g. a caller's "p-2" overriding a
// component's own default "p-4") by Tailwind rule, not just string order.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
