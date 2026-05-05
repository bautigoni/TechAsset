import { useState } from "react";

// ═══════════════════════════════════════════════════════════════
//  COORDENADAS  (viewBox 0 0 1000 1150)
//
//  Pasillo en L  ─  ancho UNIFORME = 32u
//    ├─ HORIZONTAL: x=108→1000, y=118→150  (entre fila 1 y fila 2)
//    └─ VERTICAL:   x=108→140,  y=118→805  (entre cols 2do/1ero)
//
//  Fila 2 desplazada +20 en Y para abrir el pasillo horizontal.
//  Todo lo que va debajo se desplaza +20.
// ═══════════════════════════════════════════════════════════════
const ROOMS = [
  // ── TOP-LEFT STACK ──
  { id:"room_Banos_1",        label:"Baños",          x:0,   y:0,   w:108, h:118, type:"service",  noClick:true },
  { id:"room_Directores",     label:"Directores",     x:0,   y:118, w:108, h:52,  type:"admin"                  },
  { id:"room_Salita",         label:"Administración", x:0,   y:170, w:108, h:58,  type:"admin"                  },

  // ── FILA 1  (y=0–118) ──
  { id:"room_Preceptoria_2",  label:"Prec. 2",        x:852, y:0,   w:148, h:30,  type:"admin"                  },
  { id:"room_3ero_N",         label:"3ero N",         x:112, y:0,   w:148, h:118, type:"classroom"              },
  { id:"room_5to_N",          label:"5to N",          x:260, y:0,   w:148, h:118, type:"classroom"              },
  { id:"room_5to_F",          label:"5to F",          x:408, y:0,   w:148, h:118, type:"classroom"              },
  { id:"room_5to_S",          label:"5to S",          x:556, y:0,   w:148, h:118, type:"classroom"              },
  { id:"room_Drama",          label:"Drama",          x:704, y:0,   w:148, h:118, type:"classroom"              },
  { id:"room_Musica",         label:"Música",         x:852, y:30,  w:148, h:88,  type:"classroom"              },

  // ── FILA 2  (y=150–260) ──
  { id:"room_3ero_F",         label:"3ero F",         x:112, y:150, w:127, h:110, type:"classroom"              },
  { id:"room_3ero_S",         label:"3ero S",         x:239, y:150, w:127, h:110, type:"classroom"              },
  { id:"room_4to_N",          label:"4to N",          x:366, y:150, w:127, h:110, type:"classroom"              },
  { id:"room_4to_F",          label:"4to F",          x:493, y:150, w:127, h:110, type:"classroom"              },
  { id:"room_4to_S",          label:"4to S",          x:620, y:150, w:127, h:110, type:"classroom"              },
  { id:"room_Arte",           label:"Arte",           x:747, y:150, w:127, h:110, type:"classroom"              },
  { id:"room_Banos_2",        label:"Baños",          x:874, y:150, w:126, h:110, type:"service",  noClick:true },

  // ── HALL + ESCALERA ──
  { id:"room_Hall_Entrada",   label:"Hall\n+ Entrada",x:0,   y:228, w:108, h:232, type:"hall"                   },
  { id:"room_Escalera",       label:"Escalera",       x:140, y:260, w:94,  h:80,  type:"stairs"                 },

  // ── 2DO GRADO ──
  { id:"room_2do_N",          label:"2do N",          x:0,   y:460, w:108, h:115, type:"classroom"              },
  { id:"room_2do_F",          label:"2do F",          x:0,   y:575, w:108, h:115, type:"classroom"              },
  { id:"room_2do_S",          label:"2do S",          x:0,   y:690, w:108, h:115, type:"classroom"              },

  // ── 1ERO GRADO ──
  { id:"room_1ero_N",         label:"1ero N",         x:140, y:460, w:94,  h:115, type:"classroom"              },
  { id:"room_1ero_F",         label:"1ero F",         x:140, y:575, w:94,  h:115, type:"classroom"              },
  { id:"room_1ero_S",         label:"1ero S",         x:140, y:690, w:94,  h:115, type:"classroom"              },

  // ── PASILLOS (noClick) ──
  // L horizontal — 32u alto
  { id:"pasillo_horiz",       label:"",               x:108, y:118, w:892, h:32,  type:"corridor", noClick:true },
  // L vertical — 32u ancho, desde y=118 hasta y=805
  { id:"pasillo_col",         label:"",               x:108, y:118, w:32,  h:687, type:"corridor", noClick:true },
  // Transición escalera → 1ero
  { id:"pasillo_pre1ero",     label:"",               x:140, y:340, w:94,  h:120, type:"corridor", noClick:true },
  // Pasillo entre Zoom y Comedor
  { id:"pasillo_zoom_com",    label:"",               x:502, y:832, w:44,  h:250, type:"corridor", noClick:true },

  // ── PATIO ──
  { id:"room_Patio_Primaria", label:"Patio Primaria", x:234, y:260, w:766, h:572, type:"patio"                  },

  // ── ZONA INFERIOR ──
  { id:"room_Kiosco",         label:"Kiosco",         x:0,   y:832, w:108, h:76,  type:"service",  noClick:true },
  { id:"room_Front",          label:"Front",          x:0,   y:908, w:108, h:84,  type:"service"                },
  { id:"room_Zoom",           label:"Zoom",           x:112, y:892, w:390, h:190, type:"special"                },
  { id:"room_Comedor",        label:"Comedor",        x:546, y:832, w:294, h:250, type:"special",  noClick:true },
  { id:"room_Zoom_exit",      label:"",               x:225, y:1082,w:115, h:60,  type:"special",  noClick:true },
];

// ═══════════════════════════════════════════════════════════════
//  ESTILOS POR TIPO
// ═══════════════════════════════════════════════════════════════
const T = {
  classroom:{ fill:"#0d2347", hover:"#142e5e", stroke:"#1e56a0", label:"Aula"          },
  service:  { fill:"#06122a", hover:"#06122a", stroke:"#0e1e3a", label:"Servicios"      },
  admin:    { fill:"#0b2040", hover:"#112a58", stroke:"#1a4a8a", label:"Administración" },
  hall:     { fill:"#081b36", hover:"#0e2650", stroke:"#123472", label:"Hall"           },
  stairs:   { fill:"#132848", hover:"#1a3560", stroke:"#20509a", label:"Escalera"       },
  patio:    { fill:"#030b1a", hover:"#030b1a", stroke:"#091e3c", label:"Patio"          },
  special:  { fill:"#0c2348", hover:"#132d5e", stroke:"#1a4896", label:"Esp. especial"  },
  corridor: { fill:"#010609", hover:"#010609", stroke:"#050e1a", label:"Pasillo"        },
};

// ═══════════════════════════════════════════════════════════════
//  PARÁMETROS DE EQUIPAMIENTO + ESTADOS
// ═══════════════════════════════════════════════════════════════
const PARAMS = [
  { key:"proyector",     label:"Proyector"        },
  { key:"nuc",           label:"NUC"              },
  { key:"monitor",       label:"Monitor"          },
  { key:"teclado_mouse", label:"Teclado / Mouse"  },
];

const STATUSES = [
  { key:"perfecta", label:"Perfecta", color:"#1aaa66", bg:"#0a3d20", border:"#1a6e3a" },
  { key:"bien",     label:"Bien",     color:"#c8a020", bg:"#3a3000", border:"#6e5a1a" },
  { key:"mal",      label:"Mal",      color:"#cc3333", bg:"#3a0a0a", border:"#6e2020" },
];

// Datos iniciales — actualizado el 5 de mayo de 2026
const TODAY = "2026-05-05";
const TODAY_LABEL = "5 de mayo de 2026";

const INITIAL_DATA = (() => {
  const base = {};
  ROOMS.forEach(r => {
    if (r.noClick || r.type === "patio" || r.type === "corridor" || !r.label) return;
    base[r.id] = {
      proyector: "perfecta", nuc: "perfecta", monitor: "perfecta", teclado_mouse: "perfecta",
      lastModified: TODAY,
    };
  });
  // Mezcla realista de la última verificación
  Object.assign(base.room_5to_F   ?? {}, { proyector:"bien",     lastModified:TODAY });
  Object.assign(base.room_4to_N   ?? {}, { nuc:"mal",            teclado_mouse:"bien", lastModified:TODAY });
  Object.assign(base.room_2do_F   ?? {}, { monitor:"bien",       lastModified:TODAY });
  Object.assign(base.room_1ero_S  ?? {}, { nuc:"bien", teclado_mouse:"mal", lastModified:TODAY });
  Object.assign(base.room_Drama   ?? {}, { proyector:"mal",      lastModified:TODAY });
  Object.assign(base.room_3ero_S  ?? {}, { monitor:"mal",        nuc:"bien", lastModified:TODAY });
  return base;
})();

const formatDate = (iso) => {
  if (iso === TODAY) return TODAY_LABEL;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-AR", { day:"numeric", month:"long", year:"numeric" });
  } catch { return iso; }
};

// ═══════════════════════════════════════════════════════════════
export default function FloorPlan() {
  const [selected, setSelected] = useState(null);
  const [hovered,  setHovered]  = useState(null);
  const [data,     setData]     = useState(INITIAL_DATA);

  const sel       = ROOMS.find(r => r.id === selected);
  const canClick  = r => !r.noClick && r.type !== "patio" && r.type !== "corridor" && Boolean(r.label);

  const getFill = r => {
    if (r.id === selected) return "rgba(0,212,255,0.14)";
    if (r.id === hovered && canClick(r)) return T[r.type]?.hover;
    return T[r.type]?.fill;
  };
  const getStroke = r => {
    if (r.id === selected) return "#00d4ff";
    if (r.id === hovered && canClick(r)) return "#3a90d4";
    // tinte sutil según peor estado del aula
    if (data[r.id]) {
      const v = [data[r.id].proyector, data[r.id].nuc, data[r.id].monitor, data[r.id].teclado_mouse];
      if (v.includes("mal"))  return "#8c2828";
      if (v.includes("bien")) return "#8c7a20";
    }
    return T[r.type]?.stroke;
  };
  const getSW     = r => r.id === selected ? 2 : 0.8;
  const getFilter = r => r.id === selected ? "url(#glow)" : "none";

  const updateParam = (roomId, paramKey, statusKey) => {
    setData(prev => ({
      ...prev,
      [roomId]: { ...(prev[roomId] || {}), [paramKey]: statusKey, lastModified: TODAY },
    }));
  };

  const Label = ({ r }) => {
    if (!r.label) return null;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const isPatio = r.type === "patio";
    const raw     = r.label.replace("\n","");
    const fs = isPatio ? 22
      : r.h < 35          ? 7
      : raw.length > 12   ? 8
      : r.w < 90 || r.h < 65 ? 9
      : 12;
    const fill = r.id === selected ? "#00d4ff"
      : isPatio   ? "rgba(40,100,170,0.28)"
      : r.noClick ? "#1e3850"
      : "#5a9ecc";
    const lines  = r.label.split("\n");
    const lh     = fs * 1.3;
    const startY = lines.length > 1 ? cy - lh / 2 : cy;
    return (
      <text x={cx} y={startY} textAnchor="middle" dominantBaseline="middle"
        fontSize={fs} fill={fill}
        fontFamily="'Courier New',Courier,monospace"
        letterSpacing={isPatio ? "2" : "0.3"}
        fontWeight={isPatio ? "bold" : "normal"}
        pointerEvents="none">
        {lines.map((l,i) => <tspan key={i} x={cx} dy={i===0?0:lh}>{l}</tspan>)}
      </text>
    );
  };

  // ────────────────────────────────────────────
  return (
    <div style={{ background:"#030912", minHeight:"100vh", display:"flex", flexDirection:"column", fontFamily:"'Courier New',Courier,monospace", color:"#5a9ecc" }}>

      {/* HEADER */}
      <div style={{ background:"#050e1f", borderBottom:"1px solid #0c2240", padding:"10px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div>
          <div style={{ fontSize:9, color:"#1e4a7a", letterSpacing:"4px" }}>TECHASSET · NFS</div>
          <div style={{ fontSize:16, color:"#b8e0ff", fontWeight:"bold" }}>Escuela Primaria · Planta Baja</div>
        </div>
        <div style={{ fontSize:9, textAlign:"right", lineHeight:1.8 }}>
          <div style={{ color:"#00a8cc" }}>● EN LÍNEA</div>
          <div style={{ color:"#1a3a5c" }}>v1.3 · {TODAY_LABEL}</div>
        </div>
      </div>

      {/* LEYENDA */}
      <div style={{ background:"#040c1c", borderBottom:"1px solid #091c38", padding:"5px 18px", display:"flex", gap:14, flexWrap:"wrap", flexShrink:0 }}>
        {Object.entries(T).filter(([t])=>t!=="corridor").map(([type, cfg])=>(
          <div key={type} style={{ display:"flex", alignItems:"center", gap:5, fontSize:9, color:"#1e4070" }}>
            <div style={{ width:11, height:7, background:cfg.fill, border:`1px solid ${cfg.stroke}`, borderRadius:1 }}/>
            {cfg.label}
          </div>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", gap:14, fontSize:9 }}>
          {STATUSES.map(s => (
            <div key={s.key} style={{ display:"flex", alignItems:"center", gap:5, color:s.color }}>
              <div style={{ width:8, height:8, background:s.bg, border:`1px solid ${s.border}`, borderRadius:"50%" }}/>
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* MAPA */}
      <div style={{ flex:1, padding:"14px 18px", display:"flex", flexDirection:"column", alignItems:"center" }}>
        <svg viewBox="0 0 1000 1150" style={{ width:"100%", maxWidth:820, display:"block" }}>
          <defs>
            <filter id="glow" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <pattern id="pgrid" x="0" y="0" width="38" height="38" patternUnits="userSpaceOnUse">
              <path d="M38 0L0 0 0 38" fill="none" stroke="#071630" strokeWidth="0.5"/>
            </pattern>
            <pattern id="cpat" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
              <line x1="-1" y1="1"  x2="1"  y2="-1" stroke="#071422" strokeWidth="0.7"/>
              <line x1="0"  y1="10" x2="10" y2="0"  stroke="#071422" strokeWidth="0.7"/>
              <line x1="9"  y1="11" x2="11" y2="9"  stroke="#071422" strokeWidth="0.7"/>
            </pattern>
          </defs>

          {/* fondo */}
          <rect x="0" y="0" width="1000" height="1150" fill="#030912"/>

          {/* pisos */}
          <rect x="0"   y="0"    width="1000" height="260" fill="#050e20"/>
          <rect x="0"   y="260"  width="234"  height="572" fill="#050e20"/>
          <rect x="0"   y="832"  width="112"  height="160" fill="#050e20"/>
          <rect x="112" y="832"  width="434"  height="310" fill="#050e20"/>
          <rect x="546" y="832"  width="294"  height="250" fill="#050e20"/>
          <rect x="225" y="1082" width="115"  height="68"  fill="#050e20"/>

          {/* ROOMS */}
          {ROOMS.map(r => (
            <g key={r.id}
              onClick={()=> canClick(r) && setSelected(r.id)}
              onMouseEnter={()=> setHovered(r.id)}
              onMouseLeave={()=> setHovered(null)}
              style={{ cursor: canClick(r) ? "pointer" : "default" }}>
              <rect
                x={r.x+0.5} y={r.y+0.5} width={r.w-1} height={r.h-1} rx={1.5}
                fill={getFill(r)} stroke={getStroke(r)} strokeWidth={getSW(r)}
                filter={getFilter(r)}
              />
              {r.type === "patio"    && <rect x={r.x+0.5} y={r.y+0.5} width={r.w-1} height={r.h-1} fill="url(#pgrid)" pointerEvents="none"/>}
              {r.type === "corridor" && <rect x={r.x+0.5} y={r.y+0.5} width={r.w-1} height={r.h-1} fill="url(#cpat)"  pointerEvents="none"/>}
              <Label r={r}/>
            </g>
          ))}

          {/* escalones */}
          {[0,1,2,3,4,5,6].map(i=>(
            <line key={i} x1={146} y1={272+i*11} x2={228} y2={272+i*11}
              stroke="#152e58" strokeWidth="1" pointerEvents="none"/>
          ))}

          {/* título patio */}
          {!selected && (
            <text x={617} y={546} textAnchor="middle" fontSize={24}
              fill="rgba(15,55,95,0.20)"
              fontFamily="'Courier New',Courier,monospace" fontWeight="bold"
              letterSpacing="2" pointerEvents="none">
              Escuela Primaria · Planta Baja
            </text>
          )}
        </svg>
      </div>

      {/* ═══════════════ MODAL POPUP ═══════════════ */}
      {sel && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position:"fixed", inset:0,
            background:"rgba(2,7,16,0.78)",
            backdropFilter:"blur(4px)",
            WebkitBackdropFilter:"blur(4px)",
            display:"flex", alignItems:"center", justifyContent:"center",
            zIndex:100, padding:16,
            animation:"fadein 0.18s ease-out",
          }}
        >
          <style>{`@keyframes fadein{from{opacity:0}to{opacity:1}}@keyframes scalein{from{transform:scale(0.96);opacity:0}to{transform:scale(1);opacity:1}}`}</style>

          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:"#050e1f",
              border:"1px solid #0c2240",
              boxShadow:"0 0 80px rgba(0,212,255,0.10), 0 8px 40px rgba(0,0,0,0.6)",
              borderRadius:6,
              width:"100%", maxWidth:480,
              animation:"scalein 0.18s ease-out",
              fontFamily:"'Courier New',Courier,monospace",
              maxHeight:"calc(100vh - 32px)",
              overflowY:"auto",
            }}
          >
            {/* header */}
            <div style={{ padding:"18px 20px 14px", borderBottom:"1px solid #0c2240", position:"relative" }}>
              <div style={{ fontSize:9, color:"#1a4070", letterSpacing:"3px" }}>AULA</div>
              <div style={{ fontSize:24, color:"#00d4ff", fontWeight:"bold", lineHeight:1.1, marginTop:4 }}>
                {sel.label.replace("\n"," ")}
              </div>
              <div style={{ fontSize:9, color:"#122840", marginTop:3 }}>{sel.id}</div>

              <button
                onClick={() => setSelected(null)}
                aria-label="cerrar"
                style={{
                  position:"absolute", top:14, right:14,
                  width:28, height:28, padding:0,
                  background:"transparent", border:"1px solid #1a3d70",
                  color:"#3a7ab8", cursor:"pointer",
                  fontSize:14, borderRadius:2, fontFamily:"inherit",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}
              >✕</button>
            </div>

            {/* parámetros */}
            <div style={{ padding:"18px 20px 8px" }}>
              <div style={{ fontSize:9, color:"#1a4070", letterSpacing:"3px", marginBottom:14 }}>EQUIPAMIENTO TÉCNICO</div>

              {PARAMS.map(p => {
                const current = data[sel.id]?.[p.key] || "perfecta";
                return (
                  <div key={p.key} style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:"#7ab8e0", marginBottom:6, letterSpacing:"1px", textTransform:"uppercase" }}>
                      {p.label}
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      {STATUSES.map(s => {
                        const active = current === s.key;
                        return (
                          <button
                            key={s.key}
                            onClick={() => updateParam(sel.id, p.key, s.key)}
                            style={{
                              flex:1, padding:"9px 0",
                              background: active ? s.bg : "#020812",
                              border: `1px solid ${active ? s.border : "#0d2545"}`,
                              color:    active ? s.color : "#1e3a5a",
                              fontSize: 10,
                              fontWeight: active ? "bold" : "normal",
                              letterSpacing:"1.5px",
                              textTransform:"uppercase",
                              cursor:"pointer",
                              fontFamily:"inherit",
                              borderRadius:2,
                              transition:"all 0.12s ease",
                            }}
                          >
                            {active && "● "}{s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* footer */}
            <div style={{ padding:"12px 20px 16px", borderTop:"1px solid #0c2240", display:"flex", justifyContent:"space-between", alignItems:"center", background:"#030a16" }}>
              <div>
                <div style={{ fontSize:8, color:"#1a4070", letterSpacing:"2px" }}>ÚLTIMA MODIFICACIÓN</div>
                <div style={{ fontSize:11, color:"#5a9ecc", marginTop:2 }}>
                  {formatDate(data[sel.id]?.lastModified || TODAY)}
                </div>
              </div>
              <div style={{ fontSize:9, color:"#0e8aa6", letterSpacing:"1.5px" }}>
                ✓ GUARDADO
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
