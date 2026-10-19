// Chunk diferido de la librería: lo pesado (pickers, FileDrop, ColorField) y
// su CSS. Se carga solo cuando una pantalla dibuja uno de estos campos (ver
// ../lazy.tsx); el resto de src/ui no lo arrastra.
import './pickers.css';

export { Calendar, DatePicker, DateField, DateRange, defaultRangePresets } from './DatePicker';
export { TimeField, DateTimeField } from './TimeField';
export { ColorField, DEFAULT_PALETTE, normalizeHex } from './ColorField';
export { FileDrop } from './FileDrop';
