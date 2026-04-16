const express = require('express');
const router = express.Router();
const { transactionController } = require('../controllers');
const { 
  protect, 
  authorize,
  checkShopAccess,
  takeItemsValidation, 
  updateTransactionValidation,
  bulkTransactionValidation,
  shopIdValidation,
  dateRangeValidation
} = require('../middleware');

router.use(protect);

// Get all shops summary (Admin only)
router.get('/summary', authorize('admin'), dateRangeValidation, transactionController.getAllShopsSummary);

// Take items
router.post('/take', takeItemsValidation, transactionController.takeItems);

// Update transaction (sell, return, waste)
router.put('/update', updateTransactionValidation, transactionController.updateTransaction);

// Bulk update transactions
router.post('/bulk-update', bulkTransactionValidation, transactionController.bulkUpdateTransactions);

// Get shop transactions
router.get('/shop/:shopId', shopIdValidation, transactionController.getShopTransactions);

// Get shop daily summary
router.get('/shop/:shopId/summary', shopIdValidation, transactionController.getShopDailySummary);

// Get shop item transactions
router.get('/shop/:shopId/items', shopIdValidation, dateRangeValidation, transactionController.getShopItemTransactions);

module.exports = router;
