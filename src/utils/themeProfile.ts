/**
 * Perfiles de tema VIEJOS (classic/smart × normal/escalera/centrada/peek).
 *
 * Desde la etapa 1 del rediseño el tema vive en `utils/theme.ts` (oscuro /
 * claro / sistema + densidad + tamaño de texto) y `data-theme-profile` queda
 * fijo en "classic". Esto queda solo para el shell viejo, que todavía recibe
 * `themeProfile` y decide con estas funciones si muestra la nav variante
 * (nunca, con el perfil fijo). Se borra en la etapa 2 junto con ese shell.
 */
export type ThemeProfile = 'classic' | 'classic-stairs' | 'classic-centered' | 'classic-peek' | 'smart' | 'smart-stairs' | 'smart-centered' | 'smart-peek';
export type VariantStyle = 'normal' | 'stairs' | 'centered' | 'centered-peek';

const VARIANT_PROFILES: ThemeProfile[] = ['classic-stairs', 'classic-centered', 'classic-peek', 'smart-stairs', 'smart-centered', 'smart-peek'];

export function hasVariantNav(profile: ThemeProfile): boolean {
  return VARIANT_PROFILES.includes(profile);
}

export function variantStyle(profile: ThemeProfile): VariantStyle {
  if (profile === 'classic-stairs' || profile === 'smart-stairs') return 'stairs';
  if (profile === 'classic-centered' || profile === 'smart-centered') return 'centered';
  if (profile === 'classic-peek' || profile === 'smart-peek') return 'centered-peek';
  return 'normal';
}
