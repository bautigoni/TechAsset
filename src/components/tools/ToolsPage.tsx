import type { Operator } from '../../types';
import { GlifingTool } from './GlifingTool';
import { Credentials365Tool } from './Credentials365Tool';
import { MailSettings } from './MailSettings';

export function ToolsPage({ operator: _operator }: { operator: Operator }) {
  return (
    <section className="view active">
      <div className="tools-page">
        <GlifingTool />
        <Credentials365Tool />
        <MailSettings />
      </div>
    </section>
  );
}
