import type { SiteInfo } from '../../types';

export function TenantLogo({ site, className = '', fallback = '/favicon.png' }: { site?: Partial<SiteInfo> | null; className?: string; fallback?: string }) {
  const src = site?.logo || fallback;
  const label = site?.nombre || site?.siteCode || 'TechAsset';
  return <img className={className} src={src} alt={label} onError={event => { event.currentTarget.src = fallback; }} />;
}
