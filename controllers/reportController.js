const { DailyReport, Transaction, DailyProduction, Item, Shop, AuditLog } = require('../models');
const { Parser } = require('json2csv');
const mongoose = require('mongoose');

// @desc    Get dashboard stats
// @route   GET /api/reports/dashboard
// @access  Private
exports.getDashboardStats = async (req, res) => {
  try {
    // Today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Month's date range
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    // Year's date range
    const yearStart = new Date(today.getFullYear(), 0, 1);
    const yearEnd = new Date(today.getFullYear(), 11, 31, 23, 59, 59);

    // Get today's production
    const todayProduction = await DailyProduction.find({
      date: { $gte: today, $lt: tomorrow }
    }).populate('itemId');

    // Get today's transactions
    const todayTransactions = await Transaction.find({
      date: { $gte: today, $lt: tomorrow }
    });

    // Calculate today's stats
    let todayTotalProduction = 0;
    let todayRemainingStock = 0;
    
    for (const prod of todayProduction) {
      todayTotalProduction += prod.productionQuantity;
      todayRemainingStock += prod.currentAvailableStock;
    }

    const todaySales = todayTransactions.reduce((sum, t) => sum + t.itemsSold, 0);
    const todayRevenue = todayTransactions.reduce((sum, t) => sum + t.totalRevenue, 0);
    const todayWaste = todayTransactions.reduce((sum, t) => sum + t.itemsWaste, 0);

    // Monthly stats
    const monthlyStats = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: monthStart, $lte: monthEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$itemsSold' },
          totalRevenue: { $sum: '$totalRevenue' },
          totalWaste: { $sum: '$itemsWaste' },
          totalReturned: { $sum: '$itemsReturned' }
        }
      }
    ]);

    // Yearly stats
    const yearlyStats = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: yearStart, $lte: yearEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$itemsSold' },
          totalRevenue: { $sum: '$totalRevenue' },
          totalWaste: { $sum: '$itemsWaste' },
          totalReturned: { $sum: '$itemsReturned' }
        }
      }
    ]);

    // Item-wise stock summary for dashboard + low stock alerts
    const items = await Item.find({ isActive: true });
    const stockByItem = [];
    const lowStockItems = [];

    for (const item of items) {
      const prod = todayProduction.find(
        p => p.itemId && p.itemId._id.toString() === item._id.toString()
      );
      const currentStock = prod ? prod.currentAvailableStock : 0;
      const producedToday = prod ? prod.productionQuantity : 0;
      const isLowStock = currentStock <= item.lowStockThreshold;

      stockByItem.push({
        itemId: item._id,
        itemName: item.name,
        remainingStock: currentStock,
        producedToday,
        threshold: item.lowStockThreshold,
        isLowStock
      });

      if (isLowStock) {
        lowStockItems.push({
          itemId: item._id,
          itemName: item.name,
          currentStock,
          threshold: item.lowStockThreshold,
          status: currentStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'
        });
      }
    }

    stockByItem.sort((a, b) => a.itemName.localeCompare(b.itemName));

    res.status(200).json({
      success: true,
      data: {
        today: {
          date: today,
          totalProduction: todayTotalProduction,
          totalSales: todaySales,
          totalRevenue: todayRevenue,
          totalWaste: todayWaste,
          remainingStock: todayRemainingStock,
          stockByItem
        },
        monthly: monthlyStats.length > 0 ? {
          totalSales: monthlyStats[0].totalSales,
          totalRevenue: monthlyStats[0].totalRevenue,
          totalWaste: monthlyStats[0].totalWaste,
          totalReturned: monthlyStats[0].totalReturned
        } : { totalSales: 0, totalRevenue: 0, totalWaste: 0, totalReturned: 0 },
        yearly: yearlyStats.length > 0 ? {
          totalSales: yearlyStats[0].totalSales,
          totalRevenue: yearlyStats[0].totalRevenue,
          totalWaste: yearlyStats[0].totalWaste,
          totalReturned: yearlyStats[0].totalReturned
        } : { totalSales: 0, totalRevenue: 0, totalWaste: 0, totalReturned: 0 },
        lowStockAlerts: lowStockItems
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard stats',
      error: error.message
    });
  }
};

// @desc    Get daily report
// @route   GET /api/reports/daily/:date
// @access  Private
exports.getDailyReport = async (req, res) => {
  try {
    const date = new Date(req.params.date);
    date.setHours(0, 0, 0, 0);

    let report = await DailyReport.findOne({ date })
      .populate('shopWiseSummary.shopId')
      .populate('itemWiseSummary.itemId');

    if (!report) {
      // Generate report on the fly
      report = await DailyReport.generateDailyReport(date);
      await report.populate('shopWiseSummary.shopId');
      await report.populate('itemWiseSummary.itemId');
    }

    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching daily report',
      error: error.message
    });
  }
};

// @desc    Get sales chart data
// @route   GET /api/reports/charts/sales
// @access  Private
exports.getSalesChartData = async (req, res) => {
  try {
    const { period } = req.query; // 'weekly', 'monthly', 'yearly'
    
    let startDate, groupFormat;
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    switch (period) {
      case 'weekly':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
        break;
      case 'yearly':
        startDate = new Date(endDate.getFullYear(), 0, 1);
        groupFormat = { $dateToString: { format: '%Y-%m', date: '$date' } };
        break;
      case 'monthly':
      default:
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
    }

    const salesData = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: groupFormat,
          totalSales: { $sum: '$itemsSold' },
          totalRevenue: { $sum: '$totalRevenue' },
          totalWaste: { $sum: '$itemsWaste' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.status(200).json({
      success: true,
      period,
      data: salesData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching chart data',
      error: error.message
    });
  }
};

// @desc    Get item performance chart
// @route   GET /api/reports/charts/items
// @access  Private
exports.getItemPerformanceChart = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const itemData = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: '$itemId',
          totalSold: { $sum: '$itemsSold' },
          totalRevenue: { $sum: '$totalRevenue' },
          totalWaste: { $sum: '$itemsWaste' }
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
          itemName: '$item.name',
          totalSold: 1,
          totalRevenue: 1,
          totalWaste: 1
        }
      },
      {
        $sort: { totalRevenue: -1 }
      }
    ]);

    res.status(200).json({
      success: true,
      startDate: start,
      endDate: end,
      data: itemData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching item performance',
      error: error.message
    });
  }
};

// @desc    Get shop comparison chart
// @route   GET /api/reports/charts/shops
// @access  Private/Admin
exports.getShopComparisonChart = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const shopData = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: '$shopId',
          totalSold: { $sum: '$itemsSold' },
          totalRevenue: { $sum: '$totalRevenue' },
          totalWaste: { $sum: '$itemsWaste' },
          totalTaken: { $sum: '$itemsTaken' }
        }
      },
      {
        $lookup: {
          from: 'shops',
          localField: '_id',
          foreignField: '_id',
          as: 'shop'
        }
      },
      {
        $unwind: '$shop'
      },
      {
        $project: {
          shopName: '$shop.name',
          shopNumber: '$shop.shopNumber',
          totalSold: 1,
          totalRevenue: 1,
          totalWaste: 1,
          totalTaken: 1
        }
      },
      {
        $sort: { shopNumber: 1 }
      }
    ]);

    res.status(200).json({
      success: true,
      startDate: start,
      endDate: end,
      data: shopData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching shop comparison',
      error: error.message
    });
  }
};

// @desc    Generate and download report
// @route   GET /api/reports/export
// @access  Private/Admin
exports.exportReport = async (req, res) => {
  try {
    const { startDate, endDate, type } = req.query;
    
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    let data, fields;

    if (type === 'transactions') {
      const transactions = await Transaction.find({
        date: { $gte: start, $lte: end }
      }).populate('shopId').populate('itemId');

      data = transactions.map(t => ({
        Date: t.date.toISOString().split('T')[0],
        Shop: t.shopId ? t.shopId.name : 'N/A',
        Item: t.itemId ? t.itemId.name : 'N/A',
        'Items Taken': t.itemsTaken,
        'Items Sold': t.itemsSold,
        'Items Returned': t.itemsReturned,
        'Items Waste': t.itemsWaste,
        'Price Per Item': t.pricePerItem,
        'Total Revenue': t.totalRevenue
      }));

      fields = ['Date', 'Shop', 'Item', 'Items Taken', 'Items Sold', 'Items Returned', 'Items Waste', 'Price Per Item', 'Total Revenue'];
    } else if (type === 'summary') {
      const summary = await Transaction.aggregate([
        {
          $match: { date: { $gte: start, $lte: end } }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            totalTaken: { $sum: '$itemsTaken' },
            totalSold: { $sum: '$itemsSold' },
            totalReturned: { $sum: '$itemsReturned' },
            totalWaste: { $sum: '$itemsWaste' },
            totalRevenue: { $sum: '$totalRevenue' }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      data = summary.map(s => ({
        Date: s._id,
        'Total Taken': s.totalTaken,
        'Total Sold': s.totalSold,
        'Total Returned': s.totalReturned,
        'Total Waste': s.totalWaste,
        'Total Revenue': s.totalRevenue
      }));

      fields = ['Date', 'Total Taken', 'Total Sold', 'Total Returned', 'Total Waste', 'Total Revenue'];
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid report type'
      });
    }

    // Log export action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'EXPORT_REPORT',
      entityType: 'System',
      description: `Exported ${type} report from ${startDate} to ${endDate}`,
      ipAddress: req.ip
    });

    const parser = new Parser({ fields });
    const csv = parser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment(`report_${type}_${startDate}_to_${endDate}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting report',
      error: error.message
    });
  }
};

// @desc    Close day and generate final report
// @route   POST /api/reports/close-day
// @access  Private/Admin
exports.closeDay = async (req, res) => {
  try {
    const { date, notes } = req.body;
    
    const reportDate = date ? new Date(date) : new Date();
    reportDate.setHours(0, 0, 0, 0);

    // Check if already closed
    const existingReport = await DailyReport.findOne({ date: reportDate, isClosed: true });
    if (existingReport) {
      return res.status(400).json({
        success: false,
        message: 'Day already closed'
      });
    }

    // Generate report
    const report = await DailyReport.generateDailyReport(reportDate);
    report.isClosed = true;
    report.closedBy = req.user._id;
    report.closedAt = new Date();
    report.notes = notes || '';
    await report.save();

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'CLOSE_DAY',
      entityType: 'DailyReport',
      entityId: report._id,
      description: `Closed day for ${reportDate.toISOString().split('T')[0]}`,
      newValue: { totalRevenue: report.totalRevenue, totalSales: report.totalSales },
      ipAddress: req.ip
    });

    await report.populate('shopWiseSummary.shopId');
    await report.populate('itemWiseSummary.itemId');

    res.status(200).json({
      success: true,
      message: 'Day closed successfully',
      data: report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error closing day',
      error: error.message
    });
  }
};

// @desc    Get profit summary
// @route   GET /api/reports/profit
// @access  Private/Admin
exports.getProfitSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    // Get revenue
    const revenueData = await Transaction.aggregate([
      {
        $match: { date: { $gte: start, $lte: end } }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalRevenue' },
          totalSold: { $sum: '$itemsSold' },
          totalWaste: { $sum: '$itemsWaste' }
        }
      }
    ]);

    // Get waste value (items wasted * price)
    const wasteData = await Transaction.aggregate([
      {
        $match: { date: { $gte: start, $lte: end } }
      },
      {
        $group: {
          _id: null,
          totalWasteValue: { $sum: { $multiply: ['$itemsWaste', '$pricePerItem'] } }
        }
      }
    ]);

    const revenue = revenueData.length > 0 ? revenueData[0] : { totalRevenue: 0, totalSold: 0, totalWaste: 0 };
    const wasteValue = wasteData.length > 0 ? wasteData[0].totalWasteValue : 0;

    res.status(200).json({
      success: true,
      startDate: start,
      endDate: end,
      data: {
        totalRevenue: revenue.totalRevenue,
        totalSold: revenue.totalSold,
        totalWaste: revenue.totalWaste,
        wasteValue: wasteValue,
        netRevenue: revenue.totalRevenue - wasteValue
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching profit summary',
      error: error.message
    });
  }
};

// @desc    Get audit logs
// @route   GET /api/reports/audit-logs
// @access  Private/Admin
exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, userId } = req.query;
    
    const query = {};
    if (action) query.action = action;
    if (userId) query.userId = userId;

    const logs = await AuditLog.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await AuditLog.countDocuments(query);

    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: logs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching audit logs',
      error: error.message
    });
  }
};

// @desc    Backup data
// @route   GET /api/reports/backup
// @access  Private/Admin
exports.backupData = async (req, res) => {
  try {
    const [users, shops, items, transactions, productions, reports] = await Promise.all([
      require('../models/User').find().select('-password'),
      Shop.find(),
      Item.find(),
      Transaction.find(),
      DailyProduction.find(),
      DailyReport.find()
    ]);

    const backup = {
      timestamp: new Date(),
      data: {
        users,
        shops,
        items,
        transactions,
        productions,
        reports
      }
    };

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'BACKUP_DATA',
      entityType: 'System',
      description: 'Full system backup created',
      ipAddress: req.ip
    });

    res.header('Content-Type', 'application/json');
    res.attachment(`backup_${new Date().toISOString().split('T')[0]}.json`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating backup',
      error: error.message
    });
  }
};
