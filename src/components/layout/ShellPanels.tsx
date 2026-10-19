/**
 * Lo que se abre bajo demanda en el shell (Ctrl K, franjas y la vista "Más"
 * mobile) viaja en un chunk aparte que se precarga en idle: la primera carga
 * de la app no lo paga.
 */
export { CommandPalette } from './CommandPalette';
export { QuickStrip, NotifStrip, AccountStrip, SitesStrip } from './ShellStrips';
export { MoreView } from './MoreView';export { MobileNav } from './MobileNav';
