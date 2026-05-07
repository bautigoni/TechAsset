import { QuickAccess } from './QuickAccess';

export function QuickAccessPage({ operator, consultationMode }: { operator: string; consultationMode: boolean }) {
  return (
    <section className="view active">
      <div className="tools-page">
        <QuickAccess operator={operator} consultationMode={consultationMode} />
      </div>
    </section>
  );
}
