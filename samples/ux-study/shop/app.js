document
  .querySelectorAll('[data-dialog]')
  .forEach((b) =>
    b.addEventListener('click', () => document.getElementById(b.dataset.dialog).showModal()),
  );
document
  .querySelectorAll('[data-close]')
  .forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('form[data-message]').forEach((f) =>
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const out = f.querySelector('[role="status"]') || document.querySelector('#status');
    out.textContent = f.dataset.message;
  }),
);
document.querySelectorAll('[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    const q = document.querySelector('#query').value.toLowerCase();
    let count = 0;
    document.querySelectorAll('[data-row]').forEach((row) => {
      row.hidden = !row.textContent.toLowerCase().includes(q);
      if (!row.hidden) count++;
    });
    document.querySelector('#result-count').textContent = count + '개 결과';
  }),
);
document.querySelectorAll('[data-reset]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelector('#query').value = '';
    document.querySelector('[data-filter]').click();
  }),
);
document.querySelectorAll('[data-notice]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelector('#status').textContent = b.dataset.notice;
  }),
);
