const express = require('express');
const router = express.Router();
const { productionController } = require('../controllers');
const { 
  protect, 
  authorize, 
  productionValidation, 
  bulkProductionValidation,
  dateParamValidation,
  mongoIdValidation
} = require('../middleware');

router.use(protect);

// Get today's production
router.get('/today', productionController.getTodayProduction);

// Get low stock alerts
router.get('/low-stock', productionController.getLowStockAlerts);

// Get available stock for an item
router.get('/stock/:itemId', mongoIdValidation.map(v => {
  if (v.param) v.param = v.param.replace('id', 'itemId');
  return v;
}), productionController.getAvailableStock);

// Get production by date
router.get('/date/:date', dateParamValidation, productionController.getProductionByDate);

// Admin only routes
router.post('/', authorize('admin'), productionValidation, productionController.addProduction);
router.post('/bulk', authorize('admin'), bulkProductionValidation, productionController.bulkAddProduction);

module.exports = router;
