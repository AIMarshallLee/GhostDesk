(() => {
  const reply = document.getElementById('reply');
  const send = document.getElementById('send');
  let count = 0;
  send.addEventListener('click', () => {
    if (!reply.value.trim()) return;
    document.getElementById('last-reply').textContent = reply.value;
    document.getElementById('sent-count').textContent = String(++count);
    reply.value = '';
  });
})();
