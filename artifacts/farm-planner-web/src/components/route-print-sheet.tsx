import type { FarmTask } from '@workspace/api-client-react';
import type { NoteBlock } from '@/lib/print-notes';
import { buildRoutePrint, type RoutePrintGroup } from '@/lib/route-print';

function Priority({ urgency }: { urgency: FarmTask['urgency'] }) {
  return <span className={`route-print-priority is-${urgency.toLowerCase()}`}>{urgency}</span>;
}

function NoteBlocks({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return <p key={index} className="route-print-subheading">{block.text}</p>;
          case 'paragraph':
            return <p key={index}>{block.label ? <><b>{block.label}</b>{block.text}</> : block.text}</p>;
          case 'step':
            return <p key={index} className="route-print-step"><b>{block.number}.</b> {block.text}</p>;
          case 'list':
            return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
          case 'warning':
            return <div key={index} className="route-print-warning"><NoteBlocks blocks={block.blocks} /></div>;
          case 'reason':
            return <div key={index} className="route-print-reason"><NoteBlocks blocks={block.blocks} /></div>;
        }
      })}
    </>
  );
}

/**
 * Compact A4 week print: an overview of every job by day, then each job's
 * instructions once, in two columns, with a write-in strip for BioGro records.
 */
export function RoutePrintSheet({ eyebrow, title, groups, printedFor = '', emptyMessage }: {
  eyebrow: string;
  title: string;
  groups: RoutePrintGroup[];
  /** Left out of the "with" column, e.g. the worker whose route this is. */
  printedFor?: string;
  emptyMessage: string;
}) {
  const { rows, cards, jobCount } = buildRoutePrint(groups, printedFor);
  const printed = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  return (
    <article className="print-planner-sheet route-print" aria-hidden="true" data-testid="route-print-sheet">
      <header>
        <div>
          <p className="route-print-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <p className="route-print-meta">{jobCount} job{jobCount === 1 ? '' : 's'} · {cards.length} with instructions<br />Printed {printed}</p>
      </header>
      {jobCount === 0 ? <p className="route-print-empty">{emptyMessage}</p> : (
        <>
          <h2>Week at a glance</h2>
          <table className="route-print-glance">
            <tbody>
              {rows.map((row, index) => {
                if (row.kind === 'day') return <tr key={index} className="is-day"><th colSpan={6}>{row.label}</th></tr>;
                if (row.kind === 'empty-days') return <tr key={index} className="is-empty"><th colSpan={6}>{row.label} <span>· no work planned</span></th></tr>;
                return (
                  <tr key={index} data-testid={`route-print-row-${row.task.id}`}>
                    <td className="route-print-box"><span /></td>
                    <td className="route-print-time">{row.time || 'Any time'}</td>
                    <td>{row.task.task}{row.span && <span className="route-print-span"> {row.span}</span>}</td>
                    <td><Priority urgency={row.task.urgency} /></td>
                    <td className="route-print-with">{row.others.join(', ')}</td>
                    <td className="route-print-ref">{row.ref !== null && <b>{row.ref}</b>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cards.length > 0 && <p className="route-print-legend">Numbers on the right point to the instructions below. Black label = urgent, boxed = high.</p>}
          {cards.length > 0 && (
            <section className="route-print-instructions">
              <h2>Instructions</h2>
              {cards.map(({ ref, task, when, notes }) => (
                <section key={task.id} className="route-print-card" data-testid={`route-print-card-${task.id}`}>
                  <div className="route-print-card-head">
                    <span className="route-print-number">{ref}</span>
                    <div>
                      <h3>{task.task}</h3>
                      <p>{when}{when && ' '} <Priority urgency={task.urgency} /></p>
                    </div>
                  </div>
                  {task.subtasks?.length > 0 && (
                    <div className="route-print-steps">
                      {task.subtasks.map((step) => <p key={step.id}><span className={step.done ? 'is-done' : ''} />{step.title}</p>)}
                    </div>
                  )}
                  <NoteBlocks blocks={notes.blocks} />
                  {notes.record.length > 0 && (
                    <div className="route-print-record">
                      <p>{notes.record.join(' ')}</p>
                      <p className="route-print-fill">Litres ____ &nbsp; Batch ____ &nbsp; Weather ________ &nbsp; Initials ____</p>
                    </div>
                  )}
                </section>
              ))}
            </section>
          )}
        </>
      )}
    </article>
  );
}
