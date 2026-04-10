import { useEffect, useRef, useState } from 'react';

type DeferredVisibleBlockProps = {
  children: React.ReactNode;
  placeholder?: React.ReactNode;
  forceMount?: boolean;
  rootMargin?: string;
};

export function DeferredVisibleBlock({
  children,
  placeholder = null,
  forceMount = false,
  rootMargin = '900px 0px',
}: DeferredVisibleBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(forceMount);

  useEffect(() => {
    if (forceMount) {
      setMounted(true);
      return undefined;
    }
    if (mounted) return undefined;
    const node = containerRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (!visible) return;
      setMounted(true);
      observer.disconnect();
    }, { rootMargin });

    observer.observe(node);
    return () => observer.disconnect();
  }, [forceMount, mounted, rootMargin]);

  return (
    <div ref={containerRef}>
      {mounted || forceMount ? children : placeholder}
    </div>
  );
}
