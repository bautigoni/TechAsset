import { useEffect } from 'react';
import type { AssistantContext } from '../services/assistantApi';

export function useAssistantContext(context: AssistantContext | null | undefined) {
  const data = JSON.stringify(context?.data || {});
  useEffect(() => {
    if (!context) return;
    window.dispatchEvent(new CustomEvent('techasset:assistant-context', { detail: context }));
    return () => { window.dispatchEvent(new CustomEvent('techasset:assistant-context-clear', { detail: { type: context.type, id: context.id } })); };
  }, [context?.type, context?.id, context?.label, data]);
}
