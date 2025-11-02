// Vercel serverless function handler for API routes
const app = require('../uniclub-backend/index');

// Export as Vercel serverless function
module.exports = (req, res) => {
  // Let Express handle the request
  return app(req, res);
};

