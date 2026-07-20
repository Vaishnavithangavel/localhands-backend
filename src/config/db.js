const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQL_ADDON_HOST || 'localhost',
  port: process.env.DB_PORT || process.env.MYSQL_ADDON_PORT || 3306,
  user: process.env.DB_USER || process.env.MYSQL_ADDON_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_ADDON_PASSWORD || 'root123',
  database: process.env.DB_NAME || process.env.MYSQL_ADDON_DB || 'localhands',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

module.exports = pool;
