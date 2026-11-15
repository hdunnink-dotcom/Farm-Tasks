/**
 * Turns a task's plain-text notes into printable blocks: capital-letter
 * headings (MIX PER 100 L, PART 1: ...), lists, numbered steps, a boxed
 * DO NOT section, a quieter WHY section, and the RECORD lines, which the
 * print sheet shows as a write-in strip.
 */
export type NoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; label?: string; text: string }
  | { kind: 'step'; number: string; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'warning'; blocks: NoteBlock[] }
  | { kind: 'reason'; blocks: NoteBlock[] };

export interface PrintNotes {
  blocks: NoteBlock[];
  record: string[];
}

const CAPS_LABEL = /^([A-Z][A-Z0-9]*(?:[ +&/-]+[A-Z0-9][A-Z0-9]*)*)(?=:|\s|$)/;
const LIST_ITEM = /^[-•]\s+/;
const STEP = /^(\d+)\.\s+(.*)$/;

/** A short line in capitals, such as WHY or MIXING ORDER (text in brackets is ignored). */
function isCapsHeading(line: string): boolean {
  const letters = line.replace(/\([^)]*\)/g, '').replace(/[^A-Za-z]/g, '');
  return line.length <= 48 && letters.length >= 2 && letters === letters.toUpperCase();
}

export function parsePrintNotes(notes: string): PrintNotes {
  const lines = notes.split('\n').map((line) => line.trim());
  const blocks: NoteBlock[] = [];
  const record: string[] = [];
  let section: { kind: 'warning' | 'reason'; blocks: NoteBlock[] } | null = null;
  let list: string[] | null = null;
  const target = () => section?.blocks ?? blocks;
  const closeList = () => { list = null; };
  const closeSection = () => {
    closeList();
    if (section) blocks.push(section);
    section = null;
  };

  lines.forEach((line, index) => {
    const next = lines[index + 1] ?? '';
    if (!line) {
      closeSection();
      return;
    }
    if (line.startsWith('RECORD')) {
      closeSection();
      record.push(line);
      return;
    }
    if (line.startsWith('DO NOT')) {
      closeSection();
      section = { kind: 'warning', blocks: [] };
    } else if (line.startsWith('WHY') || line.toLowerCase().startsWith('why:')) {
      closeSection();
      section = { kind: 'reason', blocks: [] };
    }
    if (LIST_ITEM.test(line)) {
      if (!list) {
        list = [];
        target().push({ kind: 'list', items: list });
      }
      list.push(line.replace(LIST_ITEM, ''));
      return;
    }
    closeList();
    const step = line.match(STEP);
    if (step) {
      target().push({ kind: 'step', number: step[1], text: step[2] });
      return;
    }
    const introducesList = line.length <= 40 && !line.endsWith('.') && (LIST_ITEM.test(next) || STEP.test(next));
    if (line.startsWith('PART ') || isCapsHeading(line) || introducesList) {
      target().push({ kind: 'heading', text: line });
      return;
    }
    const label = line.match(CAPS_LABEL)?.[1];
    if (label && label.replace(/[^A-Z]/g, '').length >= 2) {
      target().push({ kind: 'paragraph', label, text: line.slice(label.length) });
    } else {
      target().push({ kind: 'paragraph', text: line });
    }
  });
  closeSection();
  return { blocks, record };
}
