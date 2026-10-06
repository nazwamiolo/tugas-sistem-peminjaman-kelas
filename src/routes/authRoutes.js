'use strict';

/** Route autentikasi: login, registrasi, logout. */

const express = require('express');
const bcrypt = require('bcryptjs');
const { setFlash } = require('../auth');
const { validateRegistration, validateLogin } = require('../validators');

module.exports = function createAuthRoutes(db) {
  const router = express.Router();

  const homeFor = (role) => (role === 'admin' ? '/admin' : '/dashboard');

  router.get('/', (req, res) => {
    if (!req.user) return res.redirect('/login');
    return res.redirect(homeFor(req.user.role));
  });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect(homeFor(req.user.role));
    return res.render('auth/login', { title: 'Login', body: {}, errors: [] });
  });

  router.post('/login', (req, res) => {
    const { errors, data } = validateLogin(req.body);
    if (errors.length) {
      return res.status(400).render('auth/login', { title: 'Login', body: req.body, errors });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email);
    if (!user || !bcrypt.compareSync(data.password, user.password)) {
      return res.status(401).render('auth/login', {
        title: 'Login',
        body: req.body,
        errors: ['Email atau password salah.']
      });
    }
    req.session.userId = user.id;
    setFlash(req, 'success', `Selamat datang, ${user.name}.`);
    return res.redirect(homeFor(user.role));
  });

  router.get('/register', (req, res) => {
    if (req.user) return res.redirect(homeFor(req.user.role));
    return res.render('auth/register', { title: 'Registrasi', body: {}, errors: [] });
  });

  router.post('/register', (req, res) => {
    const { errors, data } = validateRegistration(db, req.body);
    if (errors.length) {
      return res.status(400).render('auth/register', { title: 'Registrasi', body: req.body, errors });
    }
    const info = db.prepare(
      'INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)'
    ).run(data.name, data.email, bcrypt.hashSync(data.password, 10), data.role, data.phone || null);

    req.session.userId = Number(info.lastInsertRowid);
    setFlash(req, 'success', 'Registrasi berhasil. Selamat datang!');
    return res.redirect(homeFor(data.role));
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  return router;
};
