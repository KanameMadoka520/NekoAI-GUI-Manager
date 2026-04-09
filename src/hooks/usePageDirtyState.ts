import { useEffect } from 'react';
import type { PageId } from '../components/layout/Sidebar';
import { useUiStore } from '../stores/uiStore';

export function usePageDirtyState(page: PageId, dirty: boolean, message: string) {
  const setPageDirty = useUiStore((s) => s.setPageDirty);
  const clearPageDirty = useUiStore((s) => s.clearPageDirty);

  useEffect(() => {
    setPageDirty(page, dirty, message);
    return () => clearPageDirty(page);
  }, [page, dirty, message, setPageDirty, clearPageDirty]);
}
