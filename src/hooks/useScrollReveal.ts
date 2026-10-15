import { useEffect } from 'react';

const SELECTOR = '.card, .stat-card, .agenda-card, .task-card, .chart-card';

export function useScrollReveal(deps: unknown[] = []) {
  useEffect(() => {
    // Solo las tarjetas nuevas: las que ya se revelaron no se vuelven a tocar.
    // Antes este efecto corría en cada auto-refresh sobre TODAS las tarjetas.
    const targets = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))
      .filter(target => !target.classList.contains('is-visible'));
    if (!targets.length) return;

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    // Primero TODAS las lecturas y después todas las escrituras. Alternar
    // getBoundingClientRect con classList.add forzaba un layout completo por
    // tarjeta (layout thrashing): ~140 ms del arranque con CPU lenta.
    const limit = window.innerHeight * 1.08;
    const visibleNow = targets.map(target => {
      const rect = target.getBoundingClientRect();
      return rect.top < limit && rect.bottom > -80;
    });
    targets.forEach((target, index) => {
      target.classList.add('scroll-reveal');
      if (visibleNow[index]) target.classList.add('is-visible');
      else observer.observe(target);
    });

    const fallback = window.setTimeout(() => targets.forEach(target => target.classList.add('is-visible')), 900);
    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
