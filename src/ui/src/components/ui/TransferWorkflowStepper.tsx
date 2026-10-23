import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export type WorkflowStep = { key: string; label: string };

/**
 * Horizontal (vertical on small screens) stepper showing progress of a
 * transfer record (a Transcript or an Evaluation) through its real,
 * schema-backed status values.
 *
 * `currentStatus` is matched against `steps[].key`. An unrecognised status
 * falls back to treating every step as pending, rather than guessing.
 */
export function TransferWorkflowStepper({
  currentStatus,
  steps,
  className,
}: {
  currentStatus: string;
  steps: WorkflowStep[];
  className?: string;
}) {
  const currentIndex = steps.findIndex((s) => s.key === currentStatus);

  return (
    <div className={cn('w-full', className)}>
      <ol className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-0">
        {steps.map((step, i) => {
          const isDone = currentIndex >= 0 && i < currentIndex;
          const isCurrent = i === currentIndex;
          const isPending = currentIndex < 0 || i > currentIndex;

          return (
            <li key={step.key} className="flex-1 flex sm:flex-col items-start sm:items-center">
              <div className="flex sm:flex-col items-center sm:w-full">
                <div className="flex items-center sm:w-full">
                  {/* connector before (hidden for first step) */}
                  <div
                    className={cn(
                      'hidden sm:block h-0.5 flex-1',
                      i === 0 ? 'opacity-0' : isDone || isCurrent ? 'bg-brand-800' : 'bg-gray-200',
                    )}
                  />
                  <div
                    className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-full border-2 shrink-0 text-xs font-semibold transition-colors',
                      isDone && 'bg-brand-800 border-brand-800 text-white',
                      isCurrent && 'border-brand-800 text-brand-800 bg-brand-50',
                      isPending && !isCurrent && 'border-gray-300 text-gray-400 bg-white',
                    )}
                  >
                    {isDone ? <Check size={16} /> : i + 1}
                  </div>
                  {/* connector after (hidden for last step) */}
                  <div
                    className={cn(
                      'hidden sm:block h-0.5 flex-1',
                      i === steps.length - 1 ? 'opacity-0' : isDone ? 'bg-brand-800' : 'bg-gray-200',
                    )}
                  />
                </div>
                <span
                  className={cn(
                    'ml-3 sm:ml-0 sm:mt-2 text-xs font-medium text-center',
                    isCurrent ? 'text-brand-800' : isDone ? 'text-gray-700' : 'text-gray-400',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {/* vertical connector for mobile layout */}
              {i !== steps.length - 1 && (
                <div
                  className={cn(
                    'sm:hidden w-0.5 ml-4 h-4',
                    isDone ? 'bg-brand-800' : 'bg-gray-200',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Canonical Evaluations.Status pipeline (see migrations/004, CK_Eval_Status). */
export const EVALUATION_STEPS: WorkflowStep[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'in_progress', label: 'In Review' },
  { key: 'decided', label: 'Decided' },
  { key: 'posted', label: 'Posted' },
];

/** Canonical Transcripts.Status pipeline (see migrations/004, CK_Trans_Status). */
export const TRANSCRIPT_STEPS: WorkflowStep[] = [
  { key: 'received', label: 'Received' },
  { key: 'processing', label: 'Under Review' },
  { key: 'complete', label: 'Complete' },
];

/** Returns "Step X of N" for a status within a given step list, or null if unknown. */
export function stepProgressLabel(currentStatus: string, steps: WorkflowStep[]): string | null {
  const idx = steps.findIndex((s) => s.key === currentStatus);
  if (idx < 0) return null;
  return `Step ${idx + 1} of ${steps.length}`;
}
