const path = require('path');
const { pathToFileURL } = require('url');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const serverEntry = path.join(__dirname, '..', 'server', 'index.js');

import(pathToFileURL(serverEntry).href).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
