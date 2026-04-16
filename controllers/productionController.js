const { DailyProduction, Item, AuditLog } = require('../models');

// Helper to get date range for today
const getTodayRange = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
};

// @desc    Get today's production
// @route   GET /api/production/today
// @access  Private
exports.getTodayProduction = async (req, res) => {
  try {
    const { today, tomorrow } = getTodayRange();

    const productions = await DailyProduction.find({
      date: { $gte: today, $lt: tomorrow }
    }).populate('itemId').populate('createdBy', 'name');

    // Get all items for reference
    const items = await Item.find({ isActive: true });

    // Map production data with item details
    const productionData = items.map(item => {
      const prod = productions.find(p => p.itemId && p.itemId._id.toString() === item._id.toString());
      return {
        itemId: item._id,
        itemName: item.name,
        price: item.price,
        productionQuantity: prod ? prod.productionQuantity : 0,
        currentAvailableStock: prod ? prod.currentAvailableStock : 0,
        lowStockThreshold: item.lowStockThreshold,
        isLowStock: prod ? prod.currentAvailableStock <= item.lowStockThreshold : true,
        productionId: prod ? prod._id : null,
        lastUpdated: prod ? prod.updatedAt : null
      };
    });

    res.status(200).json({
      success: true,
      date: today,
      data: productionData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching production data',
      error: error.message
    });
  }
};

// @desc    Get production by date
// @route   GET /api/production/date/:date
// @access  Private
exports.getProductionByDate = async (req, res) => {
  try {
    const date = new Date(req.params.date);
    date.setHours(0, 0, 0, 0);
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const productions = await DailyProduction.find({
      date: { $gte: date, $lt: nextDay }
    }).populate('itemId').populate('createdBy', 'name');

    res.status(200).json({
      success: true,
      date: date,
      count: productions.length,
      data: productions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching production data',
      error: error.message
    });
  }
};

// @desc    Add/Update daily production
// @route   POST /api/production
// @access  Private/Admin
exports.addProduction = async (req, res) => {
  try {
    const { itemId, productionQuantity, notes } = req.body;

    if (!itemId || productionQuantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Item ID and production quantity are required'
      });
    }

    if (productionQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Production quantity cannot be negative'
      });
    }

    // Verify item exists
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    const { today, tomorrow } = getTodayRange();

    // Check if production already exists for today
    let production = await DailyProduction.findOne({
      date: { $gte: today, $lt: tomorrow },
      itemId
    });

    if (production) {
      // Update existing production
      const oldQuantity = production.productionQuantity;
      const difference = productionQuantity - oldQuantity;
      
      production.productionQuantity = productionQuantity;
      production.currentAvailableStock += difference;
      production.notes = notes || production.notes;
      
      // Ensure stock doesn't go negative
      if (production.currentAvailableStock < 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot reduce production below items already distributed'
        });
      }
      
      await production.save();

      // Log action
      await AuditLog.logAction({
        userId: req.user._id,
        action: 'UPDATE_PRODUCTION',
        entityType: 'DailyProduction',
        entityId: production._id,
        description: `Updated production for ${item.name}: ${oldQuantity} → ${productionQuantity}`,
        oldValue: { quantity: oldQuantity },
        newValue: { quantity: productionQuantity },
        ipAddress: req.ip
      });
    } else {
      // Create new production
      production = await DailyProduction.create({
        date: today,
        itemId,
        productionQuantity,
        currentAvailableStock: productionQuantity,
        notes,
        createdBy: req.user._id
      });

      // Log action
      await AuditLog.logAction({
        userId: req.user._id,
        action: 'CREATE_PRODUCTION',
        entityType: 'DailyProduction',
        entityId: production._id,
        description: `Added production for ${item.name}: ${productionQuantity} units`,
        newValue: { quantity: productionQuantity },
        ipAddress: req.ip
      });
    }

    // Populate and return
    await production.populate('itemId');

    res.status(200).json({
      success: true,
      message: 'Production updated successfully',
      data: {
        ...production.toObject(),
        itemName: item.name,
        price: item.price
      }
    });
  } catch (error) {
    console.error('Add production error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding production',
      error: error.message
    });
  }
};

// @desc    Bulk add production
// @route   POST /api/production/bulk
// @access  Private/Admin
exports.bulkAddProduction = async (req, res) => {
  try {
    const { productions } = req.body;

    if (!productions || !Array.isArray(productions)) {
      return res.status(400).json({
        success: false,
        message: 'Productions array is required'
      });
    }

    const { today, tomorrow } = getTodayRange();
    const results = [];

    for (const prod of productions) {
      const { itemId, productionQuantity, notes } = prod;

      if (!itemId || productionQuantity === undefined || productionQuantity < 0) {
        results.push({ itemId, success: false, message: 'Invalid data' });
        continue;
      }

      const item = await Item.findById(itemId);
      if (!item) {
        results.push({ itemId, success: false, message: 'Item not found' });
        continue;
      }

      let production = await DailyProduction.findOne({
        date: { $gte: today, $lt: tomorrow },
        itemId
      });

      if (production) {
        const difference = productionQuantity - production.productionQuantity;
        production.productionQuantity = productionQuantity;
        production.currentAvailableStock += difference;
        production.notes = notes || production.notes;
        
        if (production.currentAvailableStock < 0) {
          results.push({ 
            itemId, 
            itemName: item.name,
            success: false, 
            message: 'Cannot reduce below distributed amount' 
          });
          continue;
        }
        
        await production.save();
      } else {
        production = await DailyProduction.create({
          date: today,
          itemId,
          productionQuantity,
          currentAvailableStock: productionQuantity,
          notes,
          createdBy: req.user._id
        });
      }

      results.push({
        itemId,
        itemName: item.name,
        success: true,
        productionQuantity,
        currentAvailableStock: production.currentAvailableStock
      });
    }

    res.status(200).json({
      success: true,
      message: 'Bulk production update completed',
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error in bulk production update',
      error: error.message
    });
  }
};

// @desc    Get available stock for an item
// @route   GET /api/production/stock/:itemId
// @access  Private
exports.getAvailableStock = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { today, tomorrow } = getTodayRange();

    const production = await DailyProduction.findOne({
      date: { $gte: today, $lt: tomorrow },
      itemId
    }).populate('itemId');

    if (!production) {
      return res.status(200).json({
        success: true,
        data: {
          itemId,
          availableStock: 0,
          productionQuantity: 0
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        itemId,
        itemName: production.itemId.name,
        availableStock: production.currentAvailableStock,
        productionQuantity: production.productionQuantity
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock',
      error: error.message
    });
  }
};

// @desc    Get low stock alerts
// @route   GET /api/production/low-stock
// @access  Private
exports.getLowStockAlerts = async (req, res) => {
  try {
    const { today, tomorrow } = getTodayRange();

    const productions = await DailyProduction.find({
      date: { $gte: today, $lt: tomorrow }
    }).populate('itemId');

    const items = await Item.find({ isActive: true });

    const lowStockItems = [];

    for (const item of items) {
      const prod = productions.find(p => p.itemId && p.itemId._id.toString() === item._id.toString());
      const currentStock = prod ? prod.currentAvailableStock : 0;
      
      if (currentStock <= item.lowStockThreshold) {
        lowStockItems.push({
          itemId: item._id,
          itemName: item.name,
          currentStock,
          threshold: item.lowStockThreshold,
          status: currentStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'
        });
      }
    }

    res.status(200).json({
      success: true,
      count: lowStockItems.length,
      data: lowStockItems
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching low stock alerts',
      error: error.message
    });
  }
};
