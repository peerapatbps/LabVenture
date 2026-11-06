require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./services/db');
const stageMonitor = require('./services/stageMonitor');
const queueWorker = require('./services/queueWorker');
const alarmWatcher = require('./services/alarmWatcher');

const app = express();
const PORT = process.env.PORT || 8889;

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
app.use('/api/chem-lab', require('./routes/chemLab'));
app.use('/api/algae', require('./routes/algae'));
app.use('/api/lab', require('./routes/labChart'));
app.use('/api/test', require('./routes/test'));
app.use('/api/operator', require('./routes/operator'));
app.use('/api/daily-report', require('./routes/dailyReport'));
app.use('/api/pm', require('./routes/pm'));
app.use('/api/testmode', require('./routes/testMode'));   // /config test panel (super admin)
// Event Class — also under /labventure/api: Uroboros pulls LabVenture directly (not via BellBeast proxy)
const eventClassRouter = require('./routes/eventClass');
app.use('/api/eventclass', eventClassRouter);
app.use('/labventure/api/eventclass', eventClassRouter);
// Daily Report auto-run — Uroboros task labventure.dailyreport calls /labventure/api/daily-report/auto-run directly
app.use('/labventure/api/daily-report', require('./routes/dailyReport'));

// Serve static assets from server/pic
app.use('/api/pic', express.static(path.join(__dirname, 'pic')));

// Serve React client in production
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const fs = require('fs');
if (fs.existsSync(CLIENT_DIST)) {
  app.use('/labventure', express.static(CLIENT_DIST, { etag: false }));
  app.get('/labventure/*', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

async function start() {
  await initDb();
  require('./services/scenarioHistory').initScenarioHistory();   // ย้าย scenario_log → scenario_periods (ครั้งแรก) + sync เกณฑ์
  stageMonitor.start();
  queueWorker.start();
  alarmWatcher.start();
  app.listen(PORT, () => {
    console.log(`LabVenture server running on http://localhost:${PORT}`);
    // Deploy machine may be set to พ.ศ. (Buddhist calendar). Server dates use toISOString()/nowTH() = always ค.ศ.;
    // only toLocale*() without a locale would follow the machine — never use it for stored/sent dates.
    const { locale, calendar } = Intl.DateTimeFormat().resolvedOptions();
    if (calendar !== 'gregory')
      console.warn(`[CALENDAR] machine locale ${locale} uses calendar=${calendar} (พ.ศ.) — date strings must use toISOString()/nowTH(), not toLocale*() without a locale`);
    else
      console.log(`[CALENDAR] machine locale ${locale} calendar=gregory (ค.ศ.)`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
