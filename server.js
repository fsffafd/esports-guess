const { initDb } = require('./db');
const { app } = require('./api/index.js');
const PORT = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Esports Guessing System running on http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    console.log(`Default admin: admin / admin123`);
  });
});
