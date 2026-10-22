import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AuthUser, SiteInfo } from '../../types';
import { Button } from '../../ui';
import { getPrivacyInfo } from '../../services/authApi';
import { AuthFrame } from './AuthFrame';
import type { PublicPageKind } from './publicRoutes';

type PrivacyInfo = { ai: string; google: boolean; push: boolean; errorReports: boolean };

/**
 * Páginas que se ven con o sin sesión, fuera del shell: "Privacidad y uso" y
 * "Esta página no existe". Todo lo que dice Privacidad sale de cómo funciona
 * el código (rutas, tablas y servicios del server); lo que depende de la
 * configuración de ESTE servidor (IA, Google, push, reporte de errores) se
 * pide a /api/auth/privacy-info. No hay datos legales ni de la institución:
 * no están en el repo.
 */
export function PublicPage({ kind, user, sites, activeSite, onBack }: {
  kind: PublicPageKind;
  user: AuthUser | null;
  sites: SiteInfo[];
  activeSite: string;
  onBack: () => void;
}) {
  useEffect(() => {
    document.title = kind === 'privacy' ? 'Privacidad y uso · TechAsset' : 'Página inexistente · TechAsset';
    window.scrollTo(0, 0);
    return () => { document.title = 'TechAsset'; };
  }, [kind]);
  const backLabel = user ? 'Volver a la app' : 'Volver al inicio';
  return (
    <AuthFrame wide onHome={onBack} hidePrivacyLink={kind === 'privacy'}>
      {kind === 'privacy'
        ? <Privacy user={user} sites={sites} activeSite={activeSite} onBack={onBack} backLabel={backLabel} />
        : <NotFound onBack={onBack} backLabel={user ? 'Ir a la app' : 'Ir al inicio'} />}
    </AuthFrame>
  );
}

function NotFound({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const path = window.location.pathname;
  return (
    <div className="public public--center">
      <p className="public-code" aria-hidden="true">404</p>
      <h1>Esta página no existe</h1>
      <p className="public-lead">
        La dirección <span className="public-path">{path.length > 60 ? `${path.slice(0, 60)}…` : path}</span> no es una pantalla de TechAsset.
        Puede tener un error de tipeo o ser un link viejo.
      </p>
      <Button variant="primary" onClick={onBack}>{backLabel}</Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `priv-${title.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '-')}`;
  return (
    <section className="public-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Privacy({ user, sites, activeSite, onBack, backLabel }: {
  user: AuthUser | null;
  sites: SiteInfo[];
  activeSite: string;
  onBack: () => void;
  backLabel: string;
}) {
  const [info, setInfo] = useState<PrivacyInfo | null>(null);
  const [infoError, setInfoError] = useState(false);
  useEffect(() => {
    let alive = true;
    getPrivacyInfo()
      .then(data => { if (alive) setInfo({ ai: data.ai, google: data.google, push: data.push, errorReports: data.errorReports }); })
      .catch(() => { if (alive) setInfoError(true); });
    return () => { alive = false; };
  }, []);
  const site = sites.find(item => item.siteCode === activeSite) || sites.find(item => item.isDefault) || sites[0];
  const siteLabel = (item: SiteInfo) => (item.nombre && item.nombre !== item.siteCode ? `${item.nombre} (${item.siteCode})` : item.siteCode);

  // Lo que depende de este servidor: mientras llega, una línea reservada (no salta nada).
  const serverLine = (render: (data: PrivacyInfo) => ReactNode) => (
    <p className="public-server public-server--reserve" aria-live="polite">
      {info ? render(info) : infoError ? 'No pudimos consultar cómo está configurado este servidor. Preguntale al equipo TIC de tu sede.' : 'Consultando la configuración de este servidor…'}
    </p>
  );

  return (
    <article className="public">
      <button type="button" className="auth-link public-back" onClick={onBack}>
        <ArrowLeft size={14} strokeWidth={1.6} aria-hidden="true" /> {backLabel}
      </button>
      <h1>Privacidad y uso</h1>
      <p className="public-lead">
        TechAsset es la herramienta del equipo TIC del colegio para préstamos, equipos, agenda, aulas y tareas.
        Acá contamos, según cómo funciona la app, qué datos guarda, para qué y quién los ve. Describe la app;
        no reemplaza las normas de la institución.
      </p>

      <Section title="Quién la administra">
        <p>
          Cada sede la administra su equipo TIC: el Jefe TIC de la sede manda las invitaciones, asigna los roles y puede quitar el acceso.
          Además hay superadministradores, que mantienen el sistema y ven todas las sedes.
          Los datos de una sede no se cruzan con los de otra.
        </p>
        {user && site
          ? <p className="public-server">Tu sede{sites.length > 1 ? ' activa' : ''}: <strong>{siteLabel(site)}</strong>{sites.length > 1 ? `. Tenés acceso a: ${sites.map(siteLabel).join(', ')}.` : '.'}</p>
          : <p className="public-server">Si ya tenés cuenta, tu sede es la del código de invitación con el que te registraste.</p>}
      </Section>

      <Section title="Qué datos tuyos se guardan">
        <ul className="public-list">
          <li><strong>Tu cuenta:</strong> mail, nombre, rol en cada sede, estado de la cuenta, preferencias (tema y avisos) y la fecha de tu último ingreso. La contraseña se guarda cifrada (hash): nadie, ni el administrador, puede leerla.</li>
          <li><strong>Tus sesiones:</strong> cuándo se abrió cada una y cuándo se usó por última vez. Vencen a los 30 días o al cerrar sesión.</li>
          <li><strong>Lo que hacés:</strong> cada préstamo, devolución, tarea, ticket, nota o cambio queda firmado con tu nombre en el historial de la sede. Lo ven las personas de tu sede según su rol, y quien tiene permiso lo puede exportar.</li>
          <li><strong>Datos de otras personas que cargás:</strong> al prestar un equipo se guarda el nombre de quien se lo lleva (docente, alumno u otra persona), su rol y dónde lo usa. Cargá solo lo necesario.</li>
          <li><strong>Avisos:</strong> las notificaciones de la campana y, si activás las notificaciones push, la dirección técnica que da tu navegador para mandártelas.</li>
        </ul>
      </Section>

      <Section title="Cuánto tiempo">
        <p>
          No hay un borrado automático: el historial de préstamos y movimientos queda guardado mientras la sede use TechAsset.
          Si te quitan el acceso, no podés volver a entrar, y lo que firmaste sigue en el historial de la sede (no se borra).
        </p>
      </Section>

      <Section title="Mails que te manda">
        <ul className="public-list">
          <li>La invitación con tu código.</li>
          <li>El aviso de cuenta creada (a vos y a los administradores de tu sede).</li>
          <li>El link para elegir o cambiar tu contraseña, y el aviso cuando la cambiás.</li>
          <li>Si te aprueban, rechazan o desactivan el acceso.</li>
          <li>Solo si activás &quot;Avisos por mail&quot; en Configuración › Notificaciones: los avisos de la campana y las novedades de la app.</li>
        </ul>
        <p>Los mails salen por el servicio de correo que configuró el administrador del sistema.</p>
      </Section>

      <Section title="El asistente y la inteligencia artificial">
        <p>
          Cuando el asistente tiene IA conectada, a ese proveedor le llega: lo que le escribís (y lo anterior de la misma charla), tu nombre, tu rol, la sede,
          lo que tenés abierto en pantalla y los datos de la sede que consulta para responderte (equipos, préstamos y nombres de personas, tareas, agenda).
          Con IA también se arman los resúmenes de tickets y equipos y el diagnóstico de aulas.
          TechAsset no guarda la charla: guarda las acciones que hizo el asistente (por ejemplo, un préstamo), con tu mail, para poder revisarlas y deshacerlas.
        </p>
        {serverLine(data => (data.ai
          ? <>En este servidor el asistente usa IA de <strong>{data.ai}</strong>.</>
          : <>En este servidor el asistente no tiene IA conectada: responde con reglas propias y no manda nada afuera.</>))}
        <p>
          El micrófono usa el dictado de tu navegador: el audio lo procesa el navegador (según cuál, con un servicio en línea de su fabricante; en Chrome, el de Google)
          y a TechAsset llega solo el texto.
        </p>
      </Section>

      <Section title="Cookies y este navegador">
        <ul className="public-list">
          <li><strong>Una cookie de sesión</strong> (solo para esta app, no la puede leer otro sitio ni el código de la página). Dura 30 días o hasta que cerrás sesión.</li>
          <li>Si entrás con Google, hasta dos cookies cortas para validar la vuelta desde Google. Google nos confirma tu mail y tu nombre; tu contraseña de Google no pasa por TechAsset.</li>
          <li>En este navegador quedan tu tema y tamaño de texto, tu nombre y tus sedes para abrir más rápido (12 horas) y los borradores de lo que estés cargando. <strong>Al cerrar sesión se borra lo tuyo</strong> (el tema queda).</li>
        </ul>
        <p>No hay publicidad, ni analítica, ni herramientas de seguimiento de terceros.</p>
        {serverLine(data => (
          <>
            {data.google ? 'En este servidor se puede entrar con Google. ' : 'En este servidor no está activado el ingreso con Google. '}
            {data.errorReports
              ? 'Los errores de la app se reportan a un servicio de monitoreo, sin mails, nombres, cookies ni contenido.'
              : 'El reporte de errores a un servicio externo está apagado.'}
          </>
        ))}
      </Section>

      <Section title="Tu cuenta y la baja">
        <ul className="public-list">
          <li>Tu contraseña la cambiás en Configuración › Cuenta.</li>
          <li>Para corregir tu nombre o tu mail, o para <strong>darte de baja</strong>, pedíselo al Jefe TIC de tu sede (o a un superadministrador). Al quitarte el acceso no podés volver a entrar; lo que firmaste queda en el historial de la sede.</li>
        </ul>
      </Section>

      <div className="public-foot">
        <Button variant="secondary" onClick={onBack}>{backLabel}</Button>
      </div>
    </article>
  );
}
