// Express 4 no atrapa los errores de handlers `async`: si la base tardaba o
// fallaba dentro de uno sin try/catch (login, invitaciones, procedimientos…), el
// request quedaba colgado hasta que el navegador o Caddy se rendían, y en Node 20
// el rechazo sin atrapar mataba el proceso. Acá cualquier promesa rechazada de un
// handler va a next(error), igual que un error síncrono (lo mismo que hace el
// paquete express-async-errors). Se importa una vez desde app.js.
import Layer from 'express/lib/router/layer.js';

if (!Layer.prototype.__asyncErrorsPatched) {
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === 'function') result.then(undefined, next);
    } catch (error) {
      next(error);
    }
  };
  Layer.prototype.__asyncErrorsPatched = true;
}
