const { Shop, AuditLog } = require('../models');

// @desc    Get all shops
// @route   GET /api/shops
// @access  Private
exports.getAllShops = async (req, res) => {
  try {
    const shops = await Shop.find({ isActive: true }).sort({ shopNumber: 1 });

    res.status(200).json({
      success: true,
      count: shops.length,
      data: shops
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching shops',
      error: error.message
    });
  }
};

// @desc    Get single shop
// @route   GET /api/shops/:id
// @access  Private
exports.getShop = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found'
      });
    }

    res.status(200).json({
      success: true,
      data: shop
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching shop',
      error: error.message
    });
  }
};

// @desc    Create shop
// @route   POST /api/shops
// @access  Private/Admin
exports.createShop = async (req, res) => {
  try {
    const { name, shopNumber, location, contactNumber } = req.body;

    // Check if shop number exists
    const existingShop = await Shop.findOne({ shopNumber });
    if (existingShop) {
      return res.status(400).json({
        success: false,
        message: 'Shop with this number already exists'
      });
    }

    const shop = await Shop.create({
      name,
      shopNumber,
      location,
      contactNumber
    });

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'CREATE_SHOP',
      entityType: 'Shop',
      entityId: shop._id,
      description: `Created new shop: ${shop.name} (Shop ${shop.shopNumber})`,
      newValue: { name: shop.name, shopNumber: shop.shopNumber },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Shop created successfully',
      data: shop
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating shop',
      error: error.message
    });
  }
};

// @desc    Update shop
// @route   PUT /api/shops/:id
// @access  Private/Admin
exports.updateShop = async (req, res) => {
  try {
    const { name, location, contactNumber, isActive } = req.body;

    let shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found'
      });
    }

    const oldValue = { name: shop.name, location: shop.location, isActive: shop.isActive };

    shop = await Shop.findByIdAndUpdate(
      req.params.id,
      { name, location, contactNumber, isActive },
      { new: true, runValidators: true }
    );

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'UPDATE_SHOP',
      entityType: 'Shop',
      entityId: shop._id,
      description: `Updated shop: ${shop.name}`,
      oldValue,
      newValue: { name: shop.name, location: shop.location, isActive: shop.isActive },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Shop updated successfully',
      data: shop
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating shop',
      error: error.message
    });
  }
};

// @desc    Delete shop
// @route   DELETE /api/shops/:id
// @access  Private/Admin
exports.deleteShop = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found'
      });
    }

    // Soft delete - just deactivate
    shop.isActive = false;
    await shop.save();

    res.status(200).json({
      success: true,
      message: 'Shop deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting shop',
      error: error.message
    });
  }
};
