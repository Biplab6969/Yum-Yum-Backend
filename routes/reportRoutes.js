const express = require('express');
const router = express.Router();
const { reportController } = require('../controllers');
const { protect, authorize, dateParamValidation, dateRangeValidation } = require('../middleware');

router.use(protect);

// Dashboard stats
router.get('/dashboard', reportController.getDashboardStats);

// Daily report
router.get('/daily/:date', dateParamValidation, reportController.getDailyReport);

// Chart data
router.get('/charts/sales', reportController.getSalesChartData);
router.get('/charts/items', dateRangeValidation, reportController.getItemPerformanceChart);
router.get('/charts/shops', authorize('admin'), dateRangeValidation, reportController.getShopComparisonChart);

// Admin only routes
router.get('/profit', authorize('admin'), dateRangeValidation, reportController.getProfitSummary);
router.get('/export', authorize('admin'), reportController.exportReport);
router.post('/close-day', authorize('admin'), reportController.closeDay);
router.get('/audit-logs', authorize('admin'), reportController.getAuditLogs);
router.get('/backup', authorize('admin'), reportController.backupData);

module.exports = router;
