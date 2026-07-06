import { useEffect, useState } from 'react';

const SCREENS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    content: (
      <div className="demo-dash">
        <div className="demo-bar">
          <div className="demo-search" />
          <div className="demo-avatar" />
        </div>
        <div className="demo-kpis">
          <div className="demo-card" style={{ borderLeftColor: '#3b82f6' }}>
            <span className="demo-card-label">Dispositivos</span>
            <span className="demo-card-value">342</span>
          </div>
          <div className="demo-card" style={{ borderLeftColor: '#22c55e' }}>
            <span className="demo-card-label">Disponibles</span>
            <span className="demo-card-value">218</span>
          </div>
          <div className="demo-card" style={{ borderLeftColor: '#f59e0b' }}>
            <span className="demo-card-label">Prestados</span>
            <span className="demo-card-value">97</span>
          </div>
          <div className="demo-card" style={{ borderLeftColor: '#ef4444' }}>
            <span className="demo-card-label">Con falla</span>
            <span className="demo-card-value">27</span>
          </div>
        </div>
        <div className="demo-list">
          <div className="demo-list-row"><span>D-1436</span><span>Touch 34</span><span className="demo-badge ok">Disponible</span></div>
          <div className="demo-list-row"><span>D-0891</span><span>Notebook 12</span><span className="demo-badge warn">Prestado</span></div>
          <div className="demo-list-row"><span>D-2104</span><span>iPad 7</span><span className="demo-badge ok">Disponible</span></div>
          <div className="demo-list-row"><span>D-0573</span><span>PLANI 5</span><span className="demo-badge ok">Disponible</span></div>
        </div>
      </div>
    ),
  },
  {
    id: 'classrooms',
    label: 'Aulas',
    content: (
      <div className="demo-classrooms">
        <div className="demo-bar">
          <div className="demo-floor-tabs">
            <span className="active">Planta baja</span>
            <span>1er piso</span>
            <span>2do piso</span>
          </div>
        </div>
        <div className="demo-floorplan">
          <div className="demo-room" style={{ borderColor: '#22c55e' }}>Aula 1<div className="demo-room-status ok" /></div>
          <div className="demo-room" style={{ borderColor: '#22c55e' }}>Aula 2<div className="demo-room-status ok" /></div>
          <div className="demo-room" style={{ borderColor: '#f59e0b' }}>Aula 3<div className="demo-room-status warn" /></div>
          <div className="demo-room" style={{ borderColor: '#ef4444' }}>Aula 4<div className="demo-room-status err" /></div>
          <div className="demo-room" style={{ borderColor: '#22c55e' }}>Aula 5<div className="demo-room-status ok" /></div>
          <div className="demo-room" style={{ borderColor: '#22c55e' }}>Aula 6<div className="demo-room-status ok" /></div>
        </div>
      </div>
    ),
  },
  {
    id: 'loans',
    label: 'Préstamos',
    content: (
      <div className="demo-loans">
        <div className="demo-bar">
          <div className="demo-tag-input" />
        </div>
        <div className="demo-loan-layout">
          <div className="demo-scanned">
            <div className="demo-scanned-header">Equipos escaneados</div>
            <div className="demo-list-row"><span>D-0891</span><span>Notebook 12</span><span className="demo-badge ok">OK</span></div>
            <div className="demo-list-row"><span>D-2104</span><span>iPad 7</span><span className="demo-badge ok">OK</span></div>
          </div>
          <div className="demo-loan-form">
            <div className="demo-field" />
            <div className="demo-field short" />
            <div className="demo-field" />
            <div className="demo-submit-btn">Prestar</div>
          </div>
        </div>
      </div>
    ),
  },
];

export function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSlide(i => (i + 1) % SCREENS.length), 4500);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="landing">
      <div className="landing-bg-orb" aria-hidden="true" />
      <header className="landing-nav">
        <img src="/techasset-logo.svg" alt="TechAsset" className="landing-logo" />
        <button type="button" className="landing-nav-login" onClick={onLogin}>Iniciar sesión</button>
      </header>

      <section className="landing-hero">
        <h1>
          TechAsset
        </h1>
        <p className="landing-sub">
          Una plataforma para la gestión TIC de tu colegio.
          Préstamos, inventario, aulas y tareas del equipo, en un solo lugar.
        </p>
        <div className="landing-cta">
          <button type="button" className="landing-btn-primary" onClick={onLogin}>Ingresar</button>
          <button type="button" className="landing-btn-ghost" onClick={onRegister}>Crear cuenta</button>
        </div>
      </section>

      <section className="landing-demo" aria-label="Cómo funciona TechAsset">
        <div className="landing-demo-frame">
          <div className="landing-demo-top">
            <span className="landing-demo-dot" style={{ background: '#ef4444' }} />
            <span className="landing-demo-dot" style={{ background: '#f59e0b' }} />
            <span className="landing-demo-dot" style={{ background: '#22c55e' }} />
            <div className="landing-demo-tabs">
              {SCREENS.map((s, i) => (
                <button key={s.id} type="button" className={i === slide ? 'active' : ''} onClick={() => setSlide(i)}>{s.label}</button>
              ))}
            </div>
          </div>
          <div className="landing-demo-screen" key={slide} style={{ animation: 'demo-enter .4s cubic-bezier(.22,1,.36,1) both' }}>
            {SCREENS[slide].content}
          </div>
        </div>
      </section>

      <footer className="landing-foot">
        <span>TechAsset</span>
        <span>Cada sede ve solo sus datos.</span>
      </footer>
    </main>
  );
}
