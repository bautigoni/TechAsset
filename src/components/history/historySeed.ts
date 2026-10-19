/**
 * "Ver en Historial" desde la ficha de un equipo: deja la búsqueda sembrada y
 * el Historial la toma al montarse (sin sumar estado a App). Se lee en el
 * inicializador del estado y se borra en un efecto (StrictMode llama dos veces
 * al inicializador: leer y borrar ahí perdería la semilla).
 */
let seed = '';

export function setHistorySeed(query: string) {
  seed = query;
}

export function peekHistorySeed() {
  return seed;
}

export function clearHistorySeed() {
  seed = '';
}
