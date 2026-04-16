const { protect, authorize, checkShopAccess } = require('./auth');
const { errorHandler, notFound } = require('./errorHandler');
const validators = require('./validators');

module.exports = {
  protect,
  authorize,
  checkShopAccess,
  errorHandler,
  notFound,
  ...validators
};
