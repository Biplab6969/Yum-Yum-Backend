const express = require('express');
const router = express.Router();
const { wholesaleController } = require('../controllers');
const { protect, authorize, mongoIdValidation } = require('../middleware');

router.use(protect, authorize('admin'));

router.post('/users', wholesaleController.createWholesaleUser);
router.get('/users', wholesaleController.getWholesaleUsers);
router.put('/users/:id', mongoIdValidation, wholesaleController.updateWholesaleUser);
router.get('/users/:id/ledger', mongoIdValidation, wholesaleController.getWholesaleUserLedger);
router.post('/users/:id/sales', mongoIdValidation, wholesaleController.createWholesaleSale);
router.post('/users/:id/payments', mongoIdValidation, wholesaleController.recordWholesalePayment);

router.post('/reminders/send-daily', wholesaleController.sendDailyPendingReminders);

module.exports = router;
