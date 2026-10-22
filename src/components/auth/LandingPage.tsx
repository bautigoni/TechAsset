import type { ReactNode } from 'react';
import { CalendarDays, ClipboardCheck, Download, Laptop, ScanLine } from 'lucide-react';
import { Button, Collapse } from '../../ui';
import { dismissInstall, promptInstall, usePwaState } from '../../services/pwa';
import { AuthFrame } from './AuthFrame';
import { PRIVACY_PATH, onPrivacyLinkClick } from './publicRoutes';

const icon = (node: ReactNode) => <span className="landing-icon" aria-hidden="true">{node}</span>;
const ICON = { size: 18, strokeWidth: 1.6 } as const;

// Lo que hace la app, en palabras de todos los días (sin maquetas ni capturas genéricas).
const MODULES: Array<{ title: string; text: string; icon: ReactNode }> = [
  { title: 'Préstamos', text: 'Prestá y devolvé con el lector o tipeando la etiqueta ("touch 34", "D1436"). Se ve quién tiene cada equipo y desde cuándo.', icon: icon(<ScanLine {...ICON} />) },
  { title: 'Equipos e inventario', text: 'Cada equipo con su estado, su historial y su ficha. Inventario TIC, papelera y recorrido de revisión.', icon: icon(<Laptop {...ICON} />) },
  { title: 'Agenda y aulas', text: 'Actividades del día con sus equipos, horarios y recreos, y el estado de cada aula en el plano.', icon: icon(<CalendarDays {...ICON} />) },
  { title: 'Tareas y tickets', text: 'Lo que tiene que hacer el equipo TIC, los pedidos de los docentes y las notas del día para el otro turno.', icon: icon(<ClipboardCheck {...ICON} />) }
];

// Lo que el que entra quiere saber antes de registrarse (todo verificable en el
// código; el detalle está en /privacidad). Antes decía "sin seguimiento de lo
// que hacés", y lo que hacés sí queda firmado con tu nombre para tu sede.
const PRIVACY = [
  'Cada sede ve solo sus datos: los equipos, préstamos y tareas de una sede no se cruzan con los de otra.',
  'Lo que hacés en la app (préstamos, devoluciones, tareas, cambios) queda firmado con tu nombre y lo ve el equipo de tu sede: es el historial de trabajo.',
  'Tu contraseña se guarda cifrada (hash): nadie, ni el administrador, puede leerla.',
  'Tu mail se usa para entrar y para los avisos de la app (invitación, contraseña y los que elijas). No hay publicidad ni herramientas de seguimiento de terceros.',
  'La sesión queda abierta 30 días en este dispositivo. La cerrás cuando quieras desde "Tu cuenta".'
];

export function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const { installable } = usePwaState();
  return (
    <AuthFrame wide action={<Button size="sm" variant="secondary" className="landing-top-login" onClick={onLogin}>Ingresar</Button>}>
      <div className="landing">
        <section className="landing-hero" aria-labelledby="landing-title">
          <h1 id="landing-title">TechAsset</h1>
          <p className="landing-sub">
            La gestión TIC del colegio en un solo lugar: préstamos, equipos, agenda, aulas y tareas del equipo.
          </p>
          <div className="landing-cta">
            <Button variant="primary" onClick={onLogin}>Ingresar</Button>
            <Button variant="secondary" onClick={onRegister}>Tengo un código</Button>
          </div>
          <p className="landing-hint">¿No tenés cuenta? Pedile un código de invitación al Jefe TIC de tu sede.</p>
          {/* Instalar como app (Android/Chrome): en línea, nunca un cartel flotante. */}
          <Collapse open={installable} outerClassName="landing-install-wrap" anchor={false} reveal={false}>
            <div className="ui-status ui-status--info landing-install" role="status">
              <span className="ui-status-icon" aria-hidden="true"><Download size={14} strokeWidth={1.6} /></span>
              <span className="ui-status-msg">Instalá TechAsset en tu celu: se abre como una app, sin el navegador.</span>
              <span className="ui-status-actions">
                <Button size="sm" variant="secondary" onClick={() => void promptInstall()}>Instalar</Button>
                <Button size="sm" variant="ghost" onClick={dismissInstall}>Más tarde</Button>
              </span>
            </div>
          </Collapse>
        </section>

        <section className="landing-section" aria-labelledby="landing-modules">
          <h2 id="landing-modules">Qué podés hacer</h2>
          <ul className="landing-grid">
            {MODULES.map(item => (
              <li key={item.title} className="landing-item">
                {item.icon}
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section" aria-labelledby="landing-privacy">
          <h2 id="landing-privacy">Tus datos</h2>
          <ul className="landing-facts">
            {PRIVACY.map(text => <li key={text}>{text}</li>)}
          </ul>
          <p className="landing-hint">
            Qué datos se guardan, quién los administra, el asistente con IA y cómo pedir la baja:{' '}
            <a className="auth-link auth-link--inline" href={PRIVACY_PATH} onClick={onPrivacyLinkClick}>Privacidad y uso</a>.
          </p>
        </section>
      </div>
    </AuthFrame>
  );
}
