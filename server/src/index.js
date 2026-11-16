require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const orgsRouter  = require('./routes/orgs');
const auditRouter = require('./routes/audit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ───────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(compression());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } }));

// ── API routes ────────────────────────────────────────────────────────────────

app.use('/api/orgs',  orgsRouter);
app.use('/api/audit', auditRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), version: process.env.npm_package_version || '1.0.0' });
});

// ── Serve React build in production ───────────────────────────────────────────

const clientBuild = path.join(__dirname, '../../client/build');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`SFMC Audit App running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
