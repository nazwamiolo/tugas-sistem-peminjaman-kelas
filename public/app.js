'use strict';

/** Interaksi UI sederhana: menu mobile, konfirmasi aksi, submit otomatis. */

document.addEventListener('DOMContentLoaded', () => {
  // Toggle sidebar pada layar kecil.
  const toggle = document.getElementById('menuToggle');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.toggle('nav-open');
    });
    // Tutup sidebar saat mengklik area konten.
    document.querySelector('.main')?.addEventListener('click', () => {
      document.body.classList.remove('nav-open');
    });
  }

  // Konfirmasi untuk aksi destruktif (hapus, batalkan, dll).
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // Auto-submit filter (dropdown kalender & laporan).
  document.querySelectorAll('.js-change-submit').forEach((el) => {
    el.addEventListener('change', () => {
      const form = el.closest('form');
      if (form) form.submit();
    });
  });
});
