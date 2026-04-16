const express = require('express');
const router = express.Router();
const { shopController } = require('../controllers');
const { protect, authorize, shopValidation, mongoIdValidation } = require('../middleware');

router.use(protect);

// Get all shops
router.get('/', shopController.getAllShops);

// Get single shop
router.get('/:id', mongoIdValidation, shopController.getShop);

// Admin only routes
router.post('/', authorize('admin'), shopValidation, shopController.createShop);
router.put('/:id', authorize('admin'), mongoIdValidation, shopController.updateShop);
router.delete('/:id', authorize('admin'), mongoIdValidation, shopController.deleteShop);

module.exports = router;
