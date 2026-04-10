import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

export type VirtualListScrollAlign = 'start' | 'center' | 'end';

export type VirtualListHandle = {
  scrollToIndex: (index: number, align?: VirtualListScrollAlign, behavior?: ScrollBehavior) => void;
  scrollToOffset: (offset: number, behavior?: ScrollBehavior) => void;
};

type VirtualListProps<T> = {
  items: T[];
  itemHeight: number;
  overscan?: number;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  empty?: React.ReactNode;
  getKey: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
};

function VirtualListInner<T>(
  {
    items,
    itemHeight,
    overscan = 6,
    containerClassName,
    containerStyle,
    empty,
    getKey,
    renderItem,
  }: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateSize = () => setViewportHeight(el.clientHeight);
    updateSize();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const maxOffset = Math.max(items.length * itemHeight - viewportHeight, 0);
    if (scrollTop > maxOffset) {
      setScrollTop(maxOffset);
      containerRef.current?.scrollTo({ top: maxOffset, behavior: 'auto' });
    }
  }, [items.length, itemHeight, viewportHeight, scrollTop]);

  useImperativeHandle(ref, () => ({
    scrollToIndex(index, align = 'center', behavior = 'auto') {
      const el = containerRef.current;
      if (!el) return;
      const safeIndex = Math.max(0, Math.min(index, items.length - 1));
      const itemTop = safeIndex * itemHeight;
      const itemBottom = itemTop + itemHeight;
      let nextOffset = itemTop;

      if (align === 'center') {
        nextOffset = itemTop - Math.max((el.clientHeight - itemHeight) / 2, 0);
      } else if (align === 'end') {
        nextOffset = itemBottom - el.clientHeight;
      }

      const maxOffset = Math.max(items.length * itemHeight - el.clientHeight, 0);
      const clamped = Math.max(0, Math.min(nextOffset, maxOffset));
      el.scrollTo({ top: clamped, behavior });
      setScrollTop(clamped);
    },
    scrollToOffset(offset, behavior = 'auto') {
      const el = containerRef.current;
      if (!el) return;
      const maxOffset = Math.max(items.length * itemHeight - el.clientHeight, 0);
      const clamped = Math.max(0, Math.min(offset, maxOffset));
      el.scrollTo({ top: clamped, behavior });
      setScrollTop(clamped);
    },
  }), [items.length, itemHeight]);

  const { startIndex, visibleItems, totalHeight } = useMemo(() => {
    const safeViewportHeight = viewportHeight || itemHeight;
    const baseStart = Math.max(Math.floor(scrollTop / itemHeight) - overscan, 0);
    const visibleCount = Math.ceil(safeViewportHeight / itemHeight) + overscan * 2;
    const baseEnd = Math.min(items.length, baseStart + visibleCount);

    return {
      startIndex: baseStart,
      visibleItems: items.slice(baseStart, baseEnd),
      totalHeight: items.length * itemHeight,
    };
  }, [items, itemHeight, overscan, scrollTop, viewportHeight]);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      style={{ overflowY: 'auto', position: 'relative', ...containerStyle }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {items.length === 0 ? (
        empty
      ) : (
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleItems.map((item, offset) => {
            const index = startIndex + offset;
            return (
              <div
                key={getKey(item, index)}
                style={{
                  position: 'absolute',
                  top: index * itemHeight,
                  left: 0,
                  right: 0,
                  height: itemHeight,
                }}
              >
                {renderItem(item, index)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListHandle> },
) => React.ReactElement;
