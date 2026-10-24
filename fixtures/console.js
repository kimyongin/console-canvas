// A real, independently rendered console page used to exercise source-free capture.
window.consoleDemoActions = 0;
document
  .querySelectorAll('button')
  .forEach((button) => button.addEventListener('click', () => window.consoleDemoActions++));
document.getElementById('customer-filter').addEventListener('submit', (event) => {
  event.preventDefault();
  window.consoleDemoActions++;
});
