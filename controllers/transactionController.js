const { Transaction, DailyProduction, Item, Shop, AuditLog } = require('../models');
const mongoose = require('mongoose');

// Helper to get date range
const getDateRange = (dateStr) => {
  const date = dateStr ? new Date(dateStr) : new Date();
  date.setHours(0, 0, 0, 0);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  return { startDate: date, endDate: nextDay };
};

// @desc    Get all transactions for a shop (today)
// @route   GET /api/transactions/shop/:shopId
// @access  Private
exports.getShopTransactions = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { date } = req.query;
    const { startDate, endDate } = getDateRange(date);

    const transactions = await Transaction.find({
      shopId,
      date: { $gte: startDate, $lt: endDate }
    }).populate('itemId').populate('shopId');

    // Get all items to include ones without transactions
    const items = await Item.find({ isActive: true });
    
    const transactionData = items.map(item => {
      const trans = transactions.find(t => t.itemId && t.itemId._id.toString() === item._id.toString());
      return {
        itemId: item._id,
        itemName: item.name,
        price: item.price,
        itemsTaken: trans ? trans.itemsTaken : 0,
        itemsSold: trans ? trans.itemsSold : 0,
        itemsReturned: trans ? trans.itemsReturned : 0,
        itemsWaste: trans ? trans.itemsWaste : 0,
        totalRevenue: trans ? trans.totalRevenue : 0,
        transactionId: trans ? trans._id : null,
        remaining: trans ? (trans.itemsTaken - trans.itemsSold - trans.itemsReturned - trans.itemsWaste) : 0
      };
    });

    // Calculate totals
    const totals = transactionData.reduce((acc, item) => ({
      totalTaken: acc.totalTaken + item.itemsTaken,
      totalSold: acc.totalSold + item.itemsSold,
      totalReturned: acc.totalReturned + item.itemsReturned,
      totalWaste: acc.totalWaste + item.itemsWaste,
      totalRevenue: acc.totalRevenue + item.totalRevenue
    }), { totalTaken: 0, totalSold: 0, totalReturned: 0, totalWaste: 0, totalRevenue: 0 });

    res.status(200).json({
      success: true,
      date: startDate,
      data: transactionData,
      totals
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions',
      error: error.message
    });
  }
};

// @desc    Create/Update transaction (Take items)
// @route   POST /api/transactions/take
// @access  Private
exports.takeItems = async (req, res) => {
  try {
    const { shopId, itemId, quantity } = req.body;

    if (!shopId || !itemId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID, Item ID, and quantity are required'
      });
    }

    if (quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity cannot be negative'
      });
    }

    // Verify shop and item exist
    const [shop, item] = await Promise.all([
      Shop.findById(shopId),
      Item.findById(itemId)
    ]);

    if (!shop || !item) {
      return res.status(404).json({
        success: false,
        message: 'Shop or Item not found'
      });
    }

    const { startDate, endDate } = getDateRange();

    // Get current production stock
    const production = await DailyProduction.findOne({
      date: { $gte: startDate, $lt: endDate },
      itemId
    });

    if (!production) {
      return res.status(400).json({
        success: false,
        message: 'No production data for this item today'
      });
    }

    // Get existing transaction
    let transaction = await Transaction.findOne({
      shopId,
      itemId,
      date: { $gte: startDate, $lt: endDate }
    });

    const previousTaken = transaction ? transaction.itemsTaken : 0;
    const additionalQuantity = quantity - previousTaken;

    // Check if enough stock available
    if (additionalQuantity > production.currentAvailableStock) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${production.currentAvailableStock}`,
        availableStock: production.currentAvailableStock
      });
    }

    // Update production stock
    production.currentAvailableStock -= additionalQuantity;
    await production.save();

    if (transaction) {
      // Update existing transaction
      transaction.itemsTaken = quantity;
      transaction.pricePerItem = item.price;
      transaction.updatedBy = req.user._id;
      await transaction.save();
    } else {
      // Create new transaction
      transaction = await Transaction.create({
        shopId,
        itemId,
        date: startDate,
        itemsTaken: quantity,
        pricePerItem: item.price,
        createdBy: req.user._id
      });
    }

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'CREATE_TRANSACTION',
      entityType: 'Transaction',
      entityId: transaction._id,
      description: `${shop.name} took ${quantity} ${item.name}`,
      newValue: { shopId, itemId, quantity },
      ipAddress: req.ip
    });

    await transaction.populate(['itemId', 'shopId']);

    res.status(200).json({
      success: true,
      message: 'Items taken successfully',
      data: transaction,
      remainingCentralStock: production.currentAvailableStock
    });
  } catch (error) {
    console.error('Take items error:', error);
    res.status(500).json({
      success: false,
      message: 'Error taking items',
      error: error.message
    });
  }
};

// @desc    Update transaction (Sell, Return, Waste)
// @route   PUT /api/transactions/update
// @access  Private
exports.updateTransaction = async (req, res) => {
  try {
    const { shopId, itemId, itemsSold, itemsReturned, itemsWaste } = req.body;

    if (!shopId || !itemId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID and Item ID are required'
      });
    }

    const { startDate, endDate } = getDateRange();

    // Find existing transaction
    let transaction = await Transaction.findOne({
      shopId,
      itemId,
      date: { $gte: startDate, $lt: endDate }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'No items taken for this item today. Take items first.'
      });
    }

    const item = await Item.findById(itemId);
    const shop = await Shop.findById(shopId);

    // Calculate values
    const newSold = itemsSold !== undefined ? itemsSold : transaction.itemsSold;
    const newReturned = itemsReturned !== undefined ? itemsReturned : transaction.itemsReturned;
    const newWaste = itemsWaste !== undefined ? itemsWaste : transaction.itemsWaste;

    // Validate totals
    const totalUsed = newSold + newReturned + newWaste;
    if (totalUsed > transaction.itemsTaken) {
      return res.status(400).json({
        success: false,
        message: `Total of sold (${newSold}), returned (${newReturned}), and waste (${newWaste}) cannot exceed items taken (${transaction.itemsTaken})`
      });
    }

    // Validate non-negative values
    if (newSold < 0 || newReturned < 0 || newWaste < 0) {
      return res.status(400).json({
        success: false,
        message: 'Values cannot be negative'
      });
    }

    const oldReturned = transaction.itemsReturned;
    const returnDifference = newReturned - oldReturned;

    // Update transaction
    transaction.itemsSold = newSold;
    transaction.itemsReturned = newReturned;
    transaction.itemsWaste = newWaste;
    transaction.pricePerItem = item.price;
    transaction.updatedBy = req.user._id;
    await transaction.save();

    // Update central stock for returns
    if (returnDifference !== 0) {
      const production = await DailyProduction.findOne({
        date: { $gte: startDate, $lt: endDate },
        itemId
      });

      if (production) {
        production.currentAvailableStock += returnDifference;
        await production.save();
      }
    }

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'UPDATE_TRANSACTION',
      entityType: 'Transaction',
      entityId: transaction._id,
      description: `${shop.name} updated ${item.name}: Sold=${newSold}, Returned=${newReturned}, Waste=${newWaste}`,
      newValue: { itemsSold: newSold, itemsReturned: newReturned, itemsWaste: newWaste },
      ipAddress: req.ip
    });

    await transaction.populate(['itemId', 'shopId']);

    res.status(200).json({
      success: true,
      message: 'Transaction updated successfully',
      data: transaction
    });
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating transaction',
      error: error.message
    });
  }
};

// @desc    Get all shops transactions summary (Admin)
// @route   GET /api/transactions/summary
// @access  Private/Admin
exports.getAllShopsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);
    
    const end = endDate ? new Date(endDate) : new Date(start);
    end.setHours(23, 59, 59, 999);

    const summary = await Transaction.getAllShopsSummary(start, end);

    res.status(200).json({
      success: true,
      startDate: start,
      endDate: end,
      data: summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching summary',
      error: error.message
    });
  }
};

// @desc    Get shop's daily summary
// @route   GET /api/transactions/shop/:shopId/summary
// @access  Private
exports.getShopDailySummary = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { date } = req.query;
    
    const queryDate = date ? new Date(date) : new Date();
    queryDate.setHours(0, 0, 0, 0);

    const summary = await Transaction.getShopDailySummary(shopId, queryDate);

    res.status(200).json({
      success: true,
      date: queryDate,
      data: summary.length > 0 ? summary[0] : {
        totalItemsTaken: 0,
        totalItemsSold: 0,
        totalItemsReturned: 0,
        totalItemsWaste: 0,
        totalRevenue: 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching shop summary',
      error: error.message
    });
  }
};

// @desc    Get item-wise transactions for a shop
// @route   GET /api/transactions/shop/:shopId/items
// @access  Private
exports.getShopItemTransactions = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);
    
    const end = endDate ? new Date(endDate) : new Date(start);
    end.setHours(23, 59, 59, 999);

    const transactions = await Transaction.aggregate([
      {
        $match: {
          shopId: new mongoose.Types.ObjectId(shopId),
          date: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: '$itemId',
          totalTaken: { $sum: '$itemsTaken' },
          totalSold: { $sum: '$itemsSold' },
          totalReturned: { $sum: '$itemsReturned' },
          totalWaste: { $sum: '$itemsWaste' },
          totalRevenue: { $sum: '$totalRevenue' }
        }
      },
      {
        $lookup: {
          from: 'items',
          localField: '_id',
          foreignField: '_id',
          as: 'item'
        }
      },
      {
        $unwind: '$item'
      },
      {
        $project: {
          itemId: '$_id',
          itemName: '$item.name',
          price: '$item.price',
          totalTaken: 1,
          totalSold: 1,
          totalReturned: 1,
          totalWaste: 1,
          totalRevenue: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      startDate: start,
      endDate: end,
      data: transactions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching item transactions',
      error: error.message
    });
  }
};

// @desc    Bulk update transactions
// @route   POST /api/transactions/bulk-update
// @access  Private
exports.bulkUpdateTransactions = async (req, res) => {
  try {
    const { shopId, transactions } = req.body;

    if (!shopId || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID and transactions array are required'
      });
    }

    const { startDate, endDate } = getDateRange();
    const results = [];

    for (const trans of transactions) {
      const { itemId, itemsTaken, itemsSold, itemsReturned, itemsWaste } = trans;

      try {
        const item = await Item.findById(itemId);
        if (!item) {
          results.push({ itemId, success: false, message: 'Item not found' });
          continue;
        }

        // Find or create transaction
        let transaction = await Transaction.findOne({
          shopId,
          itemId,
          date: { $gte: startDate, $lt: endDate }
        });

        // Handle items taken
        if (itemsTaken !== undefined && itemsTaken > 0) {
          const production = await DailyProduction.findOne({
            date: { $gte: startDate, $lt: endDate },
            itemId
          });

          if (!production) {
            results.push({ itemId, itemName: item.name, success: false, message: 'No production data' });
            continue;
          }

          const previousTaken = transaction ? transaction.itemsTaken : 0;
          const additionalQuantity = itemsTaken - previousTaken;

          if (additionalQuantity > production.currentAvailableStock) {
            results.push({ 
              itemId, 
              itemName: item.name, 
              success: false, 
              message: `Insufficient stock. Available: ${production.currentAvailableStock}` 
            });
            continue;
          }

          production.currentAvailableStock -= additionalQuantity;
          await production.save();

          if (transaction) {
            transaction.itemsTaken = itemsTaken;
          } else {
            transaction = new Transaction({
              shopId,
              itemId,
              date: startDate,
              itemsTaken,
              pricePerItem: item.price,
              createdBy: req.user._id
            });
          }
        }

        if (transaction) {
          // Update sold/returned/waste if provided
          if (itemsSold !== undefined) transaction.itemsSold = itemsSold;
          if (itemsReturned !== undefined) {
            const oldReturned = transaction.itemsReturned;
            const returnDiff = itemsReturned - oldReturned;
            
            if (returnDiff !== 0) {
              const production = await DailyProduction.findOne({
                date: { $gte: startDate, $lt: endDate },
                itemId
              });
              if (production) {
                production.currentAvailableStock += returnDiff;
                await production.save();
              }
            }
            
            transaction.itemsReturned = itemsReturned;
          }
          if (itemsWaste !== undefined) transaction.itemsWaste = itemsWaste;

          // Validate
          const totalUsed = transaction.itemsSold + transaction.itemsReturned + transaction.itemsWaste;
          if (totalUsed > transaction.itemsTaken) {
            results.push({ 
              itemId, 
              itemName: item.name, 
              success: false, 
              message: 'Total usage exceeds items taken' 
            });
            continue;
          }

          transaction.pricePerItem = item.price;
          transaction.updatedBy = req.user._id;
          await transaction.save();

          results.push({
            itemId,
            itemName: item.name,
            success: true,
            data: {
              itemsTaken: transaction.itemsTaken,
              itemsSold: transaction.itemsSold,
              itemsReturned: transaction.itemsReturned,
              itemsWaste: transaction.itemsWaste,
              totalRevenue: transaction.totalRevenue
            }
          });
        } else {
          results.push({ itemId, itemName: item.name, success: false, message: 'No items taken' });
        }
      } catch (err) {
        results.push({ itemId, success: false, message: err.message });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Bulk update completed',
      data: results
    });
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error in bulk update',
      error: error.message
    });
  }
};
