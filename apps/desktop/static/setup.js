const form = document.getElementById('form');
const input = document.getElementById('server');
const error = document.getElementById('error');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Connecting…';
  const res = await window.setup.connect(input.value);
  if (!res.ok) {
    error.textContent = res.error;
    submit.disabled = false;
    submit.textContent = 'Connect';
  }
});
