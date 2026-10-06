'use strict';

/** Perakit aplikasi Express: middleware, sesi, route, dan penanganan error. */

const path = require('path');
const express = require('express');
const session = require('express-session');

const { loadUser } = require('./auth');
const { formatDate, formatTime, splitFacilities, statusClass, todayStr } = require('./utils');
const createAuthRoutes = require('./routes/authRoutes');
const createUserRoutes = require('./routes/userRoutes');
const createAdminRoutes = require('./routes/adminRoutes');

function createApp({ db, secret = 'sipk-dev-secret' }) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

  app.use(session({
    name: 'sipk.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
  }));

  app.use(loadUser(db));
  app.use((req, res, next) => {
    res.locals.today = todayStr();
    next();
  });

  // Helper template
  app.locals.fmtDate = formatDate;
  app.locals.fmtTime = formatTime;
  app.locals.facs = splitFacilities;
  app.locals.badgeClass = statusClass;

  app.use(createAuthRoutes(db));
  app.use(createUserRoutes(db));
  app.use(createAdminRoutes(db));

  // 404
  app.use((req, res) => {
    res.status(404).render('error', {
      title: 'Halaman Tidak Ditemukan',
      message: 'Halaman yang Anda cari tidak ditemukan.'
    });
  });

  // 500
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).render('error', {
      title: 'Kesalahan Server',
      message: 'Terjadi kesalahan pada server. Silakan coba lagi.'
    });
  });

  return app;
}

module.exports = createApp;
