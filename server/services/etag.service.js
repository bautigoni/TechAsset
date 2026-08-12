import crypto from 'node:crypto';

/**
 * Responde con ETag calculado sobre el CONTENIDO, no sobre el cuerpo completo.
 *
 * El ETag automático de Express no servía para el auto-refresh: respuestas como
 * /api/devices incluyen `loadedAt` y los tiempos de la consulta, que cambian en
 * cada request, así que el hash nunca coincidía y el navegador se bajaba el
 * JSON entero cada 15 segundos. Acá se hashea solo lo que importa (los items),
 * y si no cambió se devuelve 304 sin cuerpo.
 */
export function sendWithEtag(req, res, payload, contentForHash) {
  const source = contentForHash === undefined ? payload : contentForHash;
  const etag = `W/"${crypto.createHash('sha1').update(JSON.stringify(source)).digest('base64')}"`;
  res.set('ETag', etag);
  const sent = req.headers['if-none-match'];
  // El navegador puede mandar varios ETags separados por coma.
  if (sent && sent.split(',').some(value => value.trim() === etag)) {
    res.status(304).end();
    return true;
  }
  res.json(payload);
  return false;
}
