const { DailyReport, Transaction, DailyProduction, Item, Shop, AuditLog } = require('../models');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toISOString().split('T')[0];
};

const createPdfBuffer = (builder) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      builder(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

const ensurePageSpace = (doc, minSpace = 60) => {
  if (doc.y > doc.page.height - minSpace) {
    doc.addPage();
    doc.y = 40;
  }
};

const drawSimpleTable = (doc, headers, rows) => {
  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = tableWidth / headers.length;
  const rowHeight = 18;

  const renderHeader = () => {
    const headerY = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black');

    headers.forEach((header, index) => {
      doc.text(header, startX + index * colWidth, headerY + 3, {
        width: colWidth - 8,
        ellipsis: true,
        lineBreak: false
      });
    });

    doc
      .moveTo(startX, headerY + rowHeight)
      .lineTo(startX + tableWidth, headerY + rowHeight)
      .strokeColor('#D1D5DB')
      .stroke();

    doc.y = headerY + rowHeight + 4;
  };

  renderHeader();

  if (!rows.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#4B5563').text('No data found for selected date range.');
    doc.fillColor('black');
    return;
  }

  doc.font('Helvetica').fontSize(9).fillColor('black');
  rows.forEach((row) => {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      renderHeader();
      doc.font('Helvetica').fontSize(9).fillColor('black');
    }

    const rowY = doc.y;

    row.forEach((cell, index) => {
      doc.text(String(cell ?? ''), startX + index * colWidth, rowY + 2, {
        width: colWidth - 8,
        ellipsis: true,
        lineBreak: false
      });
    });

    doc
      .moveTo(startX, rowY + rowHeight)
      .lineTo(startX + tableWidth, rowY + rowHeight)
      .strokeColor('#E5E7EB')
      .stroke();

    doc.y = rowY + rowHeight;
  });
};

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

    let pdfTitle;
    let headers;
    let rows;

    if (type === 'transactions') {
      const transactions = await Transaction.find({
        date: { $gte: start, $lte: end }
      }).populate('shopId').populate('itemId');

      pdfTitle = 'Transactions Report';
      headers = ['Date', 'Shop', 'Item', 'Taken', 'Sold', 'Returned', 'Waste', 'Price', 'Revenue'];
      rows = transactions.map((t) => [
        formatDate(t.date),
        t.shopId ? t.shopId.name : 'N/A',
        t.itemId ? t.itemId.name : 'N/A',
        t.itemsTaken,
        t.itemsSold,
        t.itemsReturned,
        t.itemsWaste,
        t.pricePerItem,
        t.totalRevenue
      ]);
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

      pdfTitle = 'Summary Report';
      headers = ['Date', 'Taken', 'Sold', 'Returned', 'Waste', 'Revenue'];
      rows = summary.map((s) => [
        s._id,
        s.totalTaken,
        s.totalSold,
        s.totalReturned,
        s.totalWaste,
        s.totalRevenue
      ]);
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

    const pdfBuffer = await createPdfBuffer((doc) => {
      doc.font('Helvetica-Bold').fontSize(16).text(`Yum Yum - ${pdfTitle}`, { align: 'center' });
      doc.moveDown(0.5);
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(`Date Range: ${startDate} to ${endDate}`, { align: 'center' });
      doc.moveDown();
      drawSimpleTable(doc, headers, rows);
    });

    res.header('Content-Type', 'application/pdf');
    res.attachment(`report_${type}_${startDate}_to_${endDate}.pdf`);
    res.send(pdfBuffer);
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
      require('../models/User').find().select('-password').lean(),
      Shop.find().lean(),
      Item.find().lean(),
      Transaction.find().lean(),
      DailyProduction.find().lean(),
      DailyReport.find().lean()
    ]);

    // Log action
    await AuditLog.logAction({
      userId: req.user._id,
      action: 'BACKUP_DATA',
      entityType: 'System',
      description: 'Full system backup created',
      ipAddress: req.ip
    });

    const backupDate = new Date().toISOString().split('T')[0];
    const pdfBuffer = await createPdfBuffer((doc) => {
      doc.font('Helvetica-Bold').fontSize(16).text('Yum Yum - Backup Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10).text(`Generated on: ${backupDate}`, { align: 'center' });
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(12).text('Dataset Summary');
      doc.moveDown(0.5);
      drawSimpleTable(
        doc,
        ['Collection', 'Record Count'],
        [
          ['Users', users.length],
          ['Shops', shops.length],
          ['Items', items.length],
          ['Transactions', transactions.length],
          ['Productions', productions.length],
          ['Reports', reports.length]
        ]
      );

      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(12).text('Transactions Snapshot');
      doc.moveDown(0.5);
      drawSimpleTable(
        doc,
        ['Date', 'Shop ID', 'Item ID', 'Sold', 'Revenue'],
        transactions.slice(0, 200).map((entry) => [
          formatDate(entry.date),
          String(entry.shopId || ''),
          String(entry.itemId || ''),
          entry.itemsSold || 0,
          entry.totalRevenue || 0
        ])
      );
    });

    res.header('Content-Type', 'application/pdf');
    res.attachment(`backup_${backupDate}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating backup',
      error: error.message
    });
  }
};
