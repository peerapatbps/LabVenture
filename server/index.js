require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/data', require('./routes/data'));
app.use('/api/write', require('./routes/write'));
app.use('/api/config', require('./routes/config'));
app.use('/api/scenarios', require('./routes/scenarios'));
app.use('/api/car', require('./routes/car'));
app.use('/api/car-admin', require('./routes/carAdmin'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/line/webhook', require('./routes/linewebhook'));
app.use('/api/aquadat', require('./routes/aquadatProcess'));
app.use('/api/chem-intake', require('./routes/chemIntake'));
app.use('/api/algae', require('./routes/algae'));

// Serve React client in production
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const fs = require('fs');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    }
  });
}

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`LabVenture server running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
