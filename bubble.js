// Live self-view for the on-screen camera bubble
navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 480 }, audio: false })
  .then(s => { document.getElementById('v').srcObject = s; })
  .catch(() => {});
