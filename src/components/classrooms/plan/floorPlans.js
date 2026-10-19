/**
 * Geometría de los planos de Estado de aulas (etapa 6b del rediseño Grafito).
 *
 * Reemplaza a los modelos SVG viejos (`models/*.jsx`) por DATOS: un solo
 * renderer (`FloorPlan.tsx`) los dibuja con tokens de color, cada aula es un
 * `<button>` real y el texto se dibuja en HTML (legible a cualquier tamaño).
 *
 * CRÍTICO: el `id` de cada aula (`k: 'room'`) ES el `room_key` de la tabla
 * `classrooms`. No se renombra nunca: renombrar huerfana el historial del aula
 * y el seed del server crea otra fila. `e2e/tests/classrooms.mjs` compara esta
 * lista contra `e2e/fixtures/classroom-room-ids.json` (la de los SVG viejos).
 * El `label` de un aula es el `nombre` que se manda al server: tampoco cambia.
 *
 * Archivo .js plano (sin JSX ni tipos) para que la prueba de IDs lo importe
 * desde node. Tipos en `floorPlans.d.ts`.
 *
 * Coordenadas en las unidades del viewBox original de cada planta.
 * Tipos de ítem (`k`):
 *   room     aula clickeable (id = room_key); `door` opcional { side, at }
 *   block    espacio no clickeable con nombre (baños, dirección, DOE, TIC…)
 *   corridor pasillo / circulación (label opcional)
 *   patio    patio o terraza (borde punteado)
 *   dashed   bloque punteado (staff)
 *   vertical bloque angosto con el texto vertical
 *   stairs   escalera con escalones (`n`, `dir` 'h' | 'v')
 *   bath     baños con artefactos
 *   poly     polígono (`pts`) con el label en (lx, ly)
 */

const room = (id, label, x, y, w, h, door) => ({ k: 'room', id, label, x, y, w, h, ...(door ? { door } : {}) });
const block = (id, label, x, y, w, h) => ({ k: 'block', id, label, x, y, w, h });
const corridor = (id, label, x, y, w, h) => ({ k: 'corridor', id, label, x, y, w, h });
const patio = (id, label, x, y, w, h) => ({ k: 'patio', id, label, x, y, w, h });
const dashed = (id, label, x, y, w, h) => ({ k: 'dashed', id, label, x, y, w, h });
const vertical = (id, label, x, y, w, h) => ({ k: 'vertical', id, label, x, y, w, h });
const stairs = (id, label, x, y, w, h, n, dir) => ({ k: 'stairs', id, label, x, y, w, h, n, dir });
const bath = (id, label, x, y, w, h) => ({ k: 'bath', id, label, x, y, w, h });
const poly = (id, label, pts, lx, ly) => ({ k: 'poly', id, label, pts, lx, ly });
const B = side => ({ side, at: 0.5 });

/* ══ NFPT ══════════════════════════════════════════════════════════════ */

const NFPT_PLANTA = [
  corridor('pasillo_horiz', '', 108, 118, 892, 32),
  corridor('pasillo_col', '', 108, 118, 32, 687),
  corridor('pasillo_pre1ero', '', 140, 340, 94, 120),
  corridor('pasillo_zoom_com', '', 502, 832, 44, 250),
  patio('room_Patio_Primaria', 'Patio Primaria', 234, 260, 766, 572),
  block('room_Banos_1', 'Baños', 0, 0, 108, 118),
  block('room_Directores', 'Directores', 0, 118, 108, 52),
  block('room_Salita', 'Administración', 0, 170, 108, 58),
  block('room_Preceptoria_2', 'Prec. 2', 852, 0, 148, 30),
  block('room_Drama', 'Drama', 704, 0, 148, 118),
  block('room_Musica', 'Música', 852, 30, 148, 88),
  block('room_Banos_2', 'Baños', 874, 150, 126, 110),
  block('room_Hall_Entrada', 'Hall\n+ entrada', 0, 228, 108, 232),
  stairs('room_Escalera', 'Escalera', 140, 260, 94, 80, 6, 'h'),
  block('room_Kiosco', 'Kiosco', 0, 832, 108, 76),
  block('room_Front', 'Front', 0, 908, 108, 84),
  block('room_Comedor', 'Comedor', 546, 832, 294, 250),
  block('room_Zoom_exit', '', 225, 1082, 115, 60),
  room('room_3ero_N', '3ero N', 112, 0, 148, 118),
  room('room_5to_N', '5to N', 260, 0, 148, 118),
  room('room_5to_F', '5to F', 408, 0, 148, 118),
  room('room_5to_S', '5to S', 556, 0, 148, 118),
  room('room_3ero_F', '3ero F', 112, 150, 127, 110),
  room('room_3ero_S', '3ero S', 239, 150, 127, 110),
  room('room_4to_N', '4to N', 366, 150, 127, 110),
  room('room_4to_F', '4to F', 493, 150, 127, 110),
  room('room_4to_S', '4to S', 620, 150, 127, 110),
  room('room_Arte', 'Arte', 747, 150, 127, 110),
  room('room_2do_N', '2do N', 0, 460, 108, 115),
  room('room_2do_F', '2do F', 0, 575, 108, 115),
  room('room_2do_S', '2do S', 0, 690, 108, 115),
  room('room_1ero_N', '1ero N', 140, 460, 94, 115),
  room('room_1ero_F', '1ero F', 140, 575, 94, 115),
  room('room_1ero_S', '1ero S', 140, 690, 94, 115),
  room('room_Zoom', 'Zoom', 112, 892, 390, 190)
];

// 1er piso (antes FloorMapPrimerPiso.jsx). Los labels de las aulas quedan
// como estaban (PRECEP, LAB, MAKER…): son el `nombre` que conoce el server.
const NFPT_PRIMERO = [
  corridor('', 'Pasillo / circulación', 165, 135, 855, 75),
  block('pp_Banos', 'Baños', 0, 0, 165, 170),
  block('pp_DOE', 'DOE', 0, 240, 165, 135),
  corridor('pp_Escalera', 'Pasillo', 165, 210, 130, 165),
  corridor('pp_Pasillo', 'Pasillo', 605, 210, 60, 165),
  block('pp_TIC', 'Sala TIC', 182, 420, 158, 95),
  room('pp_Direccion', 'Dirección', 0, 170, 165, 70),
  room('pp_2N', '2N', 165, 0, 130, 135),
  room('pp_2F', '2F', 295, 0, 120, 135),
  room('pp_2S', '2S', 415, 0, 120, 135),
  room('pp_Precep', 'PRECEP', 535, 0, 130, 135),
  room('pp_3N', '3N', 665, 0, 120, 135),
  room('pp_5S', '5S', 785, 0, 115, 135),
  room('pp_5F', '5F', 900, 0, 120, 135),
  room('pp_Lab', 'LAB', 295, 210, 120, 165),
  room('pp_Maker', 'MAKER', 415, 210, 120, 165),
  room('pp_SalaProfs', 'SALA\nPROFES', 535, 210, 70, 165),
  room('pp_3F', '3F', 665, 210, 120, 165),
  room('pp_6F', '6F', 785, 210, 115, 165),
  room('pp_6N', '6N', 900, 210, 120, 165),
  room('pp_1F', '1F', 0, 420, 165, 130),
  room('pp_1N', '1N', 0, 550, 165, 130),
  room('pp_6F2', '6F (T)', 0, 680, 165, 150),
  room('pp_1S', '1S', 182, 515, 158, 120),
  room('pp_6S', '6S', 182, 635, 158, 100),
  room('pp_6N2', '6N (T)', 182, 735, 158, 95)
];

// 2do piso: sus IDs NO llevan prefijo (4N, 4F, 4S, 3S).
const NFPT_SEGUNDO = [
  poly('sector_1er_piso', '1er piso', '0,0 980,0 980,230 830,230 830,320 380,320 380,830 0,830', 440, 170),
  poly('escalera_1er_piso', 'Escalera', '700,320 700,430 980,430 980,230 830,230 830,320', 840, 380),
  block('pasillo_precep_1er_piso', 'Pasillo / precep', 980, 140, 190, 90),
  room('4N', '4N', 980, 0, 190, 140),
  room('4F', '4F', 1170, 0, 150, 140),
  room('4S', '4S', 1170, 140, 150, 180),
  room('3S', '3S', 980, 230, 190, 90)
];

/* ══ NFND ══════════════════════════════════════════════════════════════ */

const NFND_PLANTA = [
  corridor('', '', 100, 300, 372, 30),
  corridor('', '', 566, 300, 406, 30),
  corridor('', 'Entrada · nivel primario y secundario', 100, 430, 872, 32),
  stairs('', '', 212, 100, 48, 128, 7, 'h'),
  stairs('', '', 428, 232, 40, 92, 6, 'v'),
  stairs('', '', 690, 280, 66, 88, 6, 'h'),
  stairs('', '', 882, 210, 66, 100, 7, 'v'),
  bath('', 'Baños', 212, 236, 150, 96),
  bath('', 'Baños', 476, 194, 148, 122),
  room('nd_pb_2S_EP', '2°S EP', 118, 118, 90, 70, B('bottom')),
  room('nd_pb_2F_EP', '2°F EP', 264, 118, 90, 70, { side: 'bottom', at: 0.4 }),
  room('nd_pb_2N_EP', '2°N EP', 118, 216, 90, 78, B('right')),
  room('nd_pb_1S_EP', '1°S EP', 366, 220, 100, 74, { side: 'left', at: 0.6 }),
  room('nd_pb_1F_EP', '1°F EP', 118, 350, 90, 72, B('top')),
  room('nd_pb_1N_EP', '1°N EP', 214, 350, 92, 72, B('top')),
  room('nd_pb_agora', 'Ágora', 372, 18, 168, 150, B('bottom')),
  room('nd_pb_blooming', 'Blooming', 490, 356, 78, 84, B('top')),
  room('nd_pb_5N_ES', '5°N ES', 566, 92, 96, 66, B('bottom')),
  room('nd_pb_5F_ES', '5°F ES', 680, 92, 100, 66, { side: 'bottom', at: 0.4 }),
  room('nd_pb_5S_ES', '5°S ES', 712, 192, 100, 70, B('left')),
  room('nd_pb_under', 'Under', 820, 146, 152, 96, B('left')),
  room('nd_pb_6N_ES', '6°N ES', 748, 356, 94, 66, B('top')),
  room('nd_pb_6F_ES', '6°F ES', 866, 326, 96, 76, B('top'))
];

const NFND_PRIMERO = [
  corridor('', 'Circulación', 100, 300, 810, 26),
  corridor('', '', 330, 174, 200, 24),
  patio('', 'Terraza', 270, 442, 360, 64),
  stairs('', '', 200, 88, 48, 100, 7, 'h'),
  stairs('', '', 628, 188, 52, 96, 6, 'v'),
  stairs('', '', 842, 270, 50, 84, 6, 'h'),
  stairs('', '', 48, 280, 46, 96, 7, 'v'),
  bath('', 'Baños', 256, 188, 88, 100),
  bath('', 'Baños', 536, 188, 86, 100),
  room('nd_p1_3F_EP', '3°F EP', 100, 100, 94, 72, B('bottom')),
  room('nd_p1_3N_EP', '3°N EP', 252, 100, 94, 72, B('bottom')),
  room('nd_p1_3S_EP', '3°S EP', 100, 200, 94, 68, B('right')),
  room('nd_p1_5N_EP', '5°N EP', 348, 198, 82, 68, B('bottom')),
  room('nd_p1_TICS', 'TICS', 442, 198, 82, 68, B('bottom')),
  room('nd_p1_2N_ES', '2do N ES', 548, 88, 86, 64, B('bottom')),
  room('nd_p1_2F_ES', '2do F ES', 688, 92, 86, 64, { side: 'bottom', at: 0.4 }),
  room('nd_p1_2S_ES', '2do S ES', 716, 188, 86, 66, B('left')),
  room('nd_p1_4N_EP', '4°N EP', 96, 356, 82, 76, B('top')),
  room('nd_p1_4NF_EP', '4°NF EP', 186, 356, 82, 76, B('top')),
  room('nd_p1_4S_EP', '4°S EP', 276, 356, 82, 76, B('top')),
  room('nd_p1_5F_EP', '5°F EP', 366, 356, 82, 76, B('top')),
  room('nd_p1_5S_EP', '5°S EP', 456, 356, 82, 76, B('top')),
  room('nd_p1_1N_ES', '1ro N ES', 584, 356, 82, 76, B('top')),
  room('nd_p1_1F_ES', '1ro F ES', 706, 356, 82, 76, B('top')),
  room('nd_p1_1S_ES', '1ro S ES', 828, 356, 82, 76, B('top'))
];

const NFND_SEGUNDO = [
  corridor('', 'Circulación', 100, 326, 832, 26),
  patio('', 'Terraza', 270, 464, 360, 62),
  stairs('', '', 200, 128, 48, 94, 7, 'h'),
  stairs('', '', 638, 206, 52, 100, 6, 'v'),
  stairs('', '', 850, 300, 50, 84, 6, 'h'),
  stairs('', '', 48, 300, 46, 96, 7, 'v'),
  bath('', 'Baños', 250, 206, 92, 100),
  bath('', 'Baños', 540, 206, 90, 110),
  block('nd_p2_dirEP', 'Dir. EP', 250, 142, 70, 56),
  block('nd_p2_TICs2', 'TICs', 330, 142, 80, 56),
  dashed('nd_p2_staffEP', 'Staff EP', 286, 378, 80, 78),
  vertical('nd_p2_dirSec', 'Dirección Secundaria', 382, 378, 40, 78),
  dashed('nd_p2_staffES', 'Staff ES', 848, 378, 84, 78),
  room('nd_p2_TICS', 'TICS', 100, 150, 88, 64, B('bottom')),
  room('nd_p2_6S_EP', '6°S EP', 100, 230, 88, 68, B('right')),
  room('nd_p2_lab', 'Laboratorio', 360, 206, 166, 112, B('bottom')),
  room('nd_p2_4N_ES', '4to N ES', 548, 120, 86, 64, B('bottom')),
  room('nd_p2_4F_ES', '4to F ES', 704, 120, 86, 66, { side: 'bottom', at: 0.4 }),
  room('nd_p2_4S_ES', '4to S ES', 716, 222, 86, 68, B('left')),
  room('nd_p2_6N_EP', '6°N EP', 96, 378, 84, 78, B('top')),
  room('nd_p2_6F_EP', '6°F EP', 190, 378, 84, 78, B('top')),
  room('nd_p2_3N_ES', '3ro N ES', 476, 378, 84, 78, B('top')),
  room('nd_p2_3F_ES', '3ro F ES', 600, 378, 84, 78, B('top')),
  room('nd_p2_3S_ES', '3ro S ES', 724, 378, 84, 78, B('top'))
];

const NFND_INICIAL = [
  corridor('nd_ini_corr_h', '', 20, 165, 1100, 22),
  stairs('nd_ini_esc', 'Escalera', 30, 200, 95, 115, 6, 'v'),
  block('nd_ini_dirStaff', 'Dir. Staff NI', 1020, 40, 100, 115),
  block('nd_ini_recepcion', 'Recepción / Dir. NI', 430, 200, 130, 115),
  room('nd_ini_K1y2', 'K 1y2', 30, 40, 110, 115),
  room('nd_ini_K2F', 'K2 F', 145, 40, 110, 115),
  room('nd_ini_K2N', 'K2 N', 260, 40, 110, 115),
  room('nd_ini_SUM', 'SUM', 375, 40, 110, 115),
  room('nd_ini_K3Taller', 'K3 Taller', 560, 40, 110, 115),
  room('nd_ini_K4N', 'K4 N', 675, 40, 110, 115),
  room('nd_ini_K4F', 'K4 F', 790, 40, 110, 115),
  room('nd_ini_K4S', 'K4 S', 905, 40, 110, 115),
  room('nd_ini_K3N', 'K3 N', 145, 200, 110, 115),
  room('nd_ini_K3F', 'K3 F', 260, 200, 110, 115),
  room('nd_ini_K5S', 'K5 S', 675, 200, 110, 115),
  room('nd_ini_K5F', 'K5 F', 790, 200, 110, 115),
  room('nd_ini_K5N', 'K5 N', 905, 200, 110, 115)
];

const NFND_ARTES = [
  corridor('nd_art_corr_v', '', 400, 30, 20, 590),
  room('nd_art_SUM', 'SUM', 40, 300, 340, 300),
  room('nd_art_music', 'Música', 435, 30, 210, 115),
  room('nd_art_arte', 'Arte', 435, 160, 175, 105),
  room('nd_art_esceno', 'Escenografía', 435, 280, 175, 105),
  room('nd_art_blooming', 'Blooming Inicial', 435, 400, 175, 100),
  room('nd_art_drama', 'Drama', 435, 515, 175, 105)
];

/**
 * Plantas por sede. `piso` es el texto que guarda la base (los de NFPT y NFND
 * no coinciden: "Segundo piso" vs "2do piso", "Artes"); tiene que seguir
 * alineado con el server (`classrooms.routes.js`).
 */
export const FLOOR_PLANS = {
  NFPT: [
    { key: 'planta', label: 'Planta baja', piso: 'Planta baja', caption: 'Escuela Primaria', width: 1000, height: 1150, outline: [], items: NFPT_PLANTA },
    { key: 'primero', label: '1er piso', piso: '1er piso', caption: 'Secundaria', width: 1020, height: 830, outline: ['0,0 1020,0 1020,375 0,375', '0,420 340,420 340,830 0,830'], items: NFPT_PRIMERO },
    { key: 'segundo', label: 'Segundo piso', piso: 'Segundo piso', caption: 'Secundaria', width: 1320, height: 830, outline: [], items: NFPT_SEGUNDO },
    { key: 'inicial', label: 'Nivel inicial', piso: 'Nivel inicial', disabled: true }
  ],
  NFND: [
    { key: 'planta', label: 'Planta baja', piso: 'Planta baja', caption: 'Bloque 3 · Primaria y Secundaria', width: 1024, height: 560, outline: ['100,108 356,108 356,14 556,14 556,108 984,108 984,462 100,462'], items: NFND_PLANTA },
    { key: 'primero', label: '1er piso', piso: '1er piso', caption: 'Bloque 3 · Primaria y Secundaria', width: 1024, height: 560, outline: ['88,172 88,434 926,434 926,72 534,72 534,172', '88,92 358,92 358,188 88,188'], items: NFND_PRIMERO },
    { key: 'segundo', label: '2do piso', piso: '2do piso', caption: 'Bloque 3 · Primaria y Secundaria', width: 1024, height: 560, outline: ['88,182 88,456 932,456 932,100 534,100 534,182', '88,120 420,120 420,210 88,210'], items: NFND_SEGUNDO },
    { key: 'inicial', label: 'Nivel inicial', piso: 'Nivel inicial', caption: 'Nivel inicial', width: 1140, height: 345, outline: [], items: NFND_INICIAL },
    { key: 'artes', label: 'SUM / Artes', piso: 'Artes', caption: 'Edificio SUM / Artes', width: 680, height: 640, outline: [], items: NFND_ARTES }
  ]
};

/** Nombre del aula como lo conoce el server (el label sin saltos de línea). */
export function roomName(item) {
  return String(item.label || '').replace(/\n/g, ' ');
}

/** Aulas clickeables de una planta, en orden de lectura (arriba-abajo, izquierda-derecha). */
export function roomsOf(floor) {
  if (!floor || !floor.items) return [];
  return floor.items
    .filter(item => item.k === 'room')
    .map(item => ({ roomKey: item.id, nombre: roomName(item), item }))
    .sort((a, b) => (a.item.y - b.item.y) || (a.item.x - b.item.x));
}
