const { Item, AuditLog } = require('../models');

// @desc    Get all items
// @route   GET /api/items
// @access  Private
exports.getAllItems = async (req, res) => {
  try {
    const items = await Item.find({ isActive: true }).sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: items.length,
      data: items
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching items',
      error: error.message
    });
  }
};

// @desc    Get single item
// @route   GET /api/items/:id
// @access  Private
exports.getItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    res.status(200).json({
      success: true,
      data: item
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching item',
      error: error.message
    });
  }
};

// @desc    Create item
// @route   POST /api/items
// @access  Private/Admin
exports.createItem = async (req, res) => {
  try {
    const { name, price, unit, category, lowStockThreshold } = req.body;

    // Check if item exists
    const existingItem = await Item.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: 'Item with this name already exists'
      });
    }

    const item = await Item.create({
      name,
      price,
      unit: unit || 'piece',
      category: category || 'food',
      lowStockThreshold: lowStockThreshold || 20
    });

    res.status(201).json({
      success: true,
      message: 'Item created successfully',
      data: item
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating item',
      error: error.message
    });
  }
};

// @desc    Update item
// @route   PUT /api/items/:id
// @access  Private/Admin
exports.updateItem = async (req, res) => {
  try {
    const { name, price, unit, category, lowStockThreshold, isActive } = req.body;

    let item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    const oldPrice = item.price;

    item = await Item.findByIdAndUpdate(
      req.params.id,
      { name, price, unit, category, lowStockThreshold, isActive },
      { new: true, runValidators: true }
    );

    // Log price change if price was updated
    if (price && price !== oldPrice) {
      await AuditLog.logAction({
        userId: req.user._id,
        action: 'UPDATE_ITEM_PRICE',
        entityType: 'Item',
        entityId: item._id,
        description: `Updated price for ${item.name}: ₹${oldPrice} → ₹${price}`,
        oldValue: { price: oldPrice },
        newValue: { price: item.price },
        ipAddress: req.ip
      });
    }

    res.status(200).json({
      success: true,
      message: 'Item updated successfully',
      data: item
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating item',
      error: error.message
    });
  }
};

// @desc    Delete item
// @route   DELETE /api/items/:id
// @access  Private/Admin
exports.deleteItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Soft delete
    item.isActive = false;
    await item.save();

    res.status(200).json({
      success: true,
      message: 'Item deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting item',
      error: error.message
    });
  }
};

// @desc    Update item price
// @route   PATCH /api/items/:id/price
// @access  Private/Admin
exports.updateItemPrice = async (req, res) => {
  try {
    const { price } = req.body;

    if (price === undefined || price < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid price is required'
      });
    }

    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    const oldPrice = item.price;
    item.price = price;
    await item.save();

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'UPDATE_ITEM_PRICE',
      entityType: 'Item',
      entityId: item._id,
      description: `Updated price for ${item.name}: ₹${oldPrice} → ₹${price}`,
      oldValue: { price: oldPrice },
      newValue: { price: item.price },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Price updated successfully',
      data: item
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating price',
      error: error.message
    });
  }
};
