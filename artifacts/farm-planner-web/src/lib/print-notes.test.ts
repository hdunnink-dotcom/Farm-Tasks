import { describe, expect, it } from 'vitest';
import { parsePrintNotes } from './print-notes';

describe('parsePrintNotes', () => {
  it('turns a spray note into headings, lists, steps, a DO NOT box, a quiet WHY and a record line', () => {
    const notes = [
      'GRAPES 15 vines (15 L) + Gary\'s Tiny 3 vines (2 L). Pass 2.',
      '',
      'MIX per 100 L: Microthiol Disperss 200 g. Nothing else.',
      '- Grapes 15 L: 30 g',
      '- Gary\'s Tiny 2 L: 4 g',
      '',
      'Mixing',
      '1. Dissolve the zinc sulphate in a bucket of warm water first',
      '2. Half fill the tank',
      '',
      'WHY',
      '- Apple Mn 12 ppm against 25.',
      '',
      'DO NOT',
      '- No calcium in this tank.',
      '',
      'RECORD in the BioGro diary: litres, grams, batch number.',
    ].join('\n');

    const { blocks, record } = parsePrintNotes(notes);

    expect(blocks).toEqual([
      { kind: 'paragraph', label: 'GRAPES 15', text: ' vines (15 L) + Gary\'s Tiny 3 vines (2 L). Pass 2.' },
      { kind: 'paragraph', label: 'MIX', text: ' per 100 L: Microthiol Disperss 200 g. Nothing else.' },
      { kind: 'list', items: ['Grapes 15 L: 30 g', 'Gary\'s Tiny 2 L: 4 g'] },
      { kind: 'heading', text: 'Mixing' },
      { kind: 'step', number: '1', text: 'Dissolve the zinc sulphate in a bucket of warm water first' },
      { kind: 'step', number: '2', text: 'Half fill the tank' },
      { kind: 'reason', blocks: [{ kind: 'heading', text: 'WHY' }, { kind: 'list', items: ['Apple Mn 12 ppm against 25.'] }] },
      { kind: 'warning', blocks: [{ kind: 'heading', text: 'DO NOT' }, { kind: 'list', items: ['No calcium in this tank.'] }] },
    ]);
    expect(record).toEqual(['RECORD in the BioGro diary: litres, grams, batch number.']);
  });

  it('boxes an inline DO NOT line and keeps PART lines as headings', () => {
    const { blocks } = parsePrintNotes('PART 2: BIOLOGY COVER SPRAY (leaves), evening\nDO NOT: no oil within 21 days, grapes only.');
    expect(blocks).toEqual([
      { kind: 'heading', text: 'PART 2: BIOLOGY COVER SPRAY (leaves), evening' },
      { kind: 'warning', blocks: [{ kind: 'paragraph', label: 'DO NOT', text: ': no oil within 21 days, grapes only.' }] },
    ]);
  });

  it('keeps plain notes and user bullets readable', () => {
    const { blocks, record } = parsePrintNotes('Bring hose key\n\n• Check the valve\n  Then wait for pressure.');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Bring hose key' },
      { kind: 'list', items: ['Check the valve'] },
      { kind: 'paragraph', text: 'Then wait for pressure.' },
    ]);
    expect(record).toEqual([]);
  });
});
