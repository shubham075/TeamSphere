const params = new URLSearchParams(location.search);
document.getElementById('server').textContent = params.get('server') ?? '';
document.getElementById('detail').textContent = params.get('error') ?? '';
document.getElementById('retry').addEventListener('click', () => window.setup.retry());
document.getElementById('change').addEventListener('click', () => window.setup.changeServer());

// Retry automatically every 15 seconds, and as soon as the network comes back.
setInterval(() => window.setup.retry(), 15000);
window.addEventListener('online', () => window.setup.retry());
