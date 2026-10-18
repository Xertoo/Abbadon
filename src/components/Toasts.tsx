import { Info, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Props {
  toasts: Array<{ id: number; msg: string }>;
}

export function Toasts({ toasts }: Props) {
  return (
    <div className="fixed bottom-28 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast flex items-start gap-2.5 max-w-xs rounded-xl border border-sc-line bg-sc-panel-2/95 backdrop-blur-md px-3.5 py-2.5 shadow-2xl transition-all"
        >
          <Info className="w-4 h-4 text-sc-orange shrink-0 mt-px" />
          <span className="text-[12px] text-sc-muted leading-snug">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export { CheckCircle2, AlertTriangle };