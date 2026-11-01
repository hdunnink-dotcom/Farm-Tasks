import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import type { FarmTask } from '@workspace/api-client-react';

type Urgency = FarmTask['urgency'];

export const URGENCY_LEVELS: Urgency[] = ['Urgent', 'High', 'Medium', 'Low'];

export const urgencyStyles: Record<Urgency, string> = {
  Urgent: 'bg-[hsl(0_72%_48%/.15)] text-[hsl(0_65%_38%)] border-[hsl(0_65%_48%/.3)]',
  High: 'bg-[hsl(5_61%_49%/.11)] text-[hsl(5_61%_42%)] border-[hsl(5_61%_49%/.22)]',
  Medium: 'bg-[hsl(35_82%_66%/.2)] text-[hsl(26_55%_35%)] border-[hsl(35_62%_56%/.3)]',
  Low: 'bg-[hsl(156_28%_28%/.09)] text-[hsl(156_28%_28%)] border-[hsl(156_28%_28%/.18)]',
};

/** The urgency pill as a button: click it and pick a new urgency from the list. */
export function UrgencySelect({ urgency, taskTitle, onChange }: { urgency: Urgency; taskTitle: string; onChange: (urgency: Urgency) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          // Keep the click on the pill: cards open the editor or start a drag.
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          draggable={false}
          aria-label={`Urgency ${urgency} for ${taskTitle}. Change urgency.`}
          data-testid={`select-urgency-${urgency.toLowerCase()}`}
          className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[.12em] transition-colors hover:brightness-95 ${urgencyStyles[urgency]}`}
        >
          {urgency}<ChevronDown size={10} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} onClick={(event) => event.stopPropagation()} className="z-50 min-w-[130px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 text-sm shadow-lg">
          {URGENCY_LEVELS.map((level) => (
            <DropdownMenu.Item
              key={level}
              onSelect={() => { if (level !== urgency) onChange(level); }}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 outline-none hover:bg-[hsl(var(--muted))] focus:bg-[hsl(var(--muted))]"
            >
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[.12em] ${urgencyStyles[level]}`}>{level}</span>
              {level === urgency && <Check size={14} className="text-[hsl(var(--primary))]" aria-hidden="true" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
