import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { FieldMark } from '@/components/farm-planner';

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="grain min-h-screen bg-[hsl(var(--background))] px-5 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <Link href="/" className="w-fit rounded-xl bg-[hsl(var(--sidebar))] px-4 py-3" data-testid="link-auth-home">
          <FieldMark />
        </Link>
        <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center py-8">
          {children}
        </div>
      </div>
    </main>
  );
}