import { useEffect } from 'react';

export function useScrollReveal(deps: unknown[] = []) {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('.card, .stat-card, .agenda-card, .task-card, .chart-card'));
    targets.forEach(target => {
      target.classList.add('scroll-reveal');
    });

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    targets.forEach(target => {
      const rect = target.getBoundingClientRect();
      if (rect.top < window.innerHeight * 1.08 && rect.bottom > -80) {
        target.classList.add('is-visible');
      } else {
        observer.observe(target);
      }
    });
    const fallback = window.setTimeout(() => targets.forEach(target => target.classList.add('is-visible')), 900);
    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, deps);
}
