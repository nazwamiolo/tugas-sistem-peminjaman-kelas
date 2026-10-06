'use strict';

/** Autentikasi, sesi, role-based access control, dan flash message. */

function setFlash(req, type, message) {
  if (req.session) req.session.flash = { type, message };
}

/** Muat user dari sesi ke req.user & res.locals.user, konsumsi flash message. */
function loadUser(db) {
  return (req, res, next) => {
    res.locals.user = null;
    res.locals.flash = null;
    if (req.session && req.session.userId) {
      const u = db.prepare('SELECT id, name, email, role, phone FROM users WHERE id = ?').get(req.session.userId);
      if (u) {
        req.user = u;
        res.locals.user = u;
      } else {
        delete req.session.userId;
      }
    }
    if (req.session && req.session.flash) {
      res.locals.flash = req.session.flash;
      delete req.session.flash;
    }
    next();
  };
}

/** Wajib login. */
function requireAuth(req, res, next) {
  if (!req.user) {
    setFlash(req, 'error', 'Silakan login terlebih dahulu.');
    return res.redirect('/login');
  }
  next();
}

/** Wajib login dengan role tertentu (role-based access). */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      setFlash(req, 'error', 'Silakan login terlebih dahulu.');
      return res.redirect('/login');
    }
    if (req.user.role !== role) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki akses ke halaman tersebut.',
        user: req.user
      });
    }
    next();
  };
}

module.exports = { setFlash, loadUser, requireAuth, requireRole };
