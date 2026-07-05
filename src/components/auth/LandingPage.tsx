// Landing pública: puerta de entrada al login. Estética editorial sobria,
// solo tipografía y espacio — sin iconos decorativos.
export function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <main className="landing">
      <header className="landing-nav">
        <span className="landing-wordmark">TechAsset</span>
        <button type="button" className="landing-nav-login" onClick={onLogin}>Iniciar sesión</button>
      </header>

      <section className="landing-hero">
        <p className="landing-eyebrow">Gestión TIC multi-sede</p>
        <h1>
          La operación tecnológica
          <br />
          de tu colegio, en orden.
        </h1>
        <p className="landing-sub">
          Préstamos, inventario, agenda y estado de aulas en un solo lugar.
          Trazable por sede, sin planillas desincronizadas.
        </p>
        <div className="landing-cta">
          <button type="button" className="landing-btn-primary" onClick={onLogin}>Ingresar</button>
          <button type="button" className="landing-btn-ghost" onClick={onRegister}>Crear cuenta</button>
        </div>
      </section>

      <section className="landing-grid" aria-label="Qué resuelve TechAsset">
        <article>
          <span>01</span>
          <h2>Préstamos y dispositivos</h2>
          <p>Cada equipo con historial completo: quién lo tiene, dónde y desde cuándo. Escaneo por lote y devoluciones en segundos.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Agenda y tareas del equipo</h2>
          <p>La operación diaria del equipo TIC coordinada: actividades por curso, tareas con responsables y cierre del día automático.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Aulas e inventario</h2>
          <p>Plano real de cada piso con el estado del equipamiento por aula, y el stock maker siempre al día.</p>
        </article>
      </section>

      <footer className="landing-foot">
        <span>TechAsset</span>
        <span>Cada sede ve solo sus datos.</span>
      </footer>
    </main>
  );
}
