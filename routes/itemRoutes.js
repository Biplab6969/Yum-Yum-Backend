const express = require('express');
const router = express.Router();
const { itemController } = require('../controllers');
const { protect, authorize, itemValidation, priceValidation, mongoIdValidation } = require('../middleware');

router.use(protect);

// Get all items
router.get('/', itemController.getAllItems);

// Get single item
router.get('/:id', mongoIdValidation, itemController.getItem);

// Admin only routes
router.post('/', authorize('admin'), itemValidation, itemController.createItem);
router.put('/:id', authorize('admin'), mongoIdValidation, itemController.updateItem);
router.patch('/:id/price', authorize('admin'), mongoIdValidation, priceValidation, itemController.updateItemPrice);
router.delete('/:id', authorize('admin'), mongoIdValidation, itemController.deleteItem);

module.exports = router;
