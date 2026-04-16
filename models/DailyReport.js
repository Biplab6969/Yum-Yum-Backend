const mongoose = require('mongoose');

const dailyReportSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: [true, 'Date is required'],
    unique: true,
    index: true
  },
  totalProduction: {
    type: Number,
    default: 0,
    min: [0, 'Total production cannot be negative']
  },
  totalSales: {
    type: Number,
    default: 0,
    min: [0, 'Total sales cannot be negative']
  },
  totalRevenue: {
    type: Number,
    default: 0,
    min: [0, 'Total revenue cannot be negative']
  },
  totalWaste: {
    type: Number,
    default: 0,
    min: [0, 'Total waste cannot be negative']
  },
  totalReturned: {
    type: Number,
    default: 0,
    min: [0, 'Total returned cannot be negative']
  },
  totalRemainingStock: {
    type: Number,
    default: 0,
    min: [0, 'Remaining stock cannot be negative']
  },
  shopWiseSummary: [{
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop'
    },
    itemsTaken: { type: Number, default: 0 },
    itemsSold: { type: Number, default: 0 },
    itemsReturned: { type: Number, default: 0 },
    itemsWaste: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
  }],
  itemWiseSummary: [{
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item'
    },
    produced: { type: Number, default: 0 },
    sold: { type: Number, default: 0 },
    returned: { type: Number, default: 0 },
    wasted: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
  }],
  isClosed: {
    type: Boolean,
    default: false
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  closedAt: {
    type: Date
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

// Static method to generate daily report
dailyReportSchema.statics.generateDailyReport = async function(date) {
  const Transaction = require('./Transaction');
  const DailyProduction = require('./DailyProduction');
  const Shop = require('./Shop');
  const Item = require('./Item');

  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  // Get all transactions for the day
  const transactions = await Transaction.find({
    date: { $gte: startDate, $lt: endDate }
  });

  // Get production data
  const productions = await DailyProduction.find({
    date: { $gte: startDate, $lt: endDate }
  });

  // Calculate totals
  let totalProduction = 0;
  let totalSales = 0;
  let totalRevenue = 0;
  let totalWaste = 0;
  let totalReturned = 0;
  let totalRemainingStock = 0;

  // Shop wise summary
  const shopSummaryMap = new Map();
  const itemSummaryMap = new Map();

  // Process productions
  for (const prod of productions) {
    totalProduction += prod.productionQuantity;
    totalRemainingStock += prod.currentAvailableStock;

    if (!itemSummaryMap.has(prod.itemId.toString())) {
      itemSummaryMap.set(prod.itemId.toString(), {
        itemId: prod.itemId,
        produced: 0,
        sold: 0,
        returned: 0,
        wasted: 0,
        remaining: 0,
        revenue: 0
      });
    }
    const itemSum = itemSummaryMap.get(prod.itemId.toString());
    itemSum.produced += prod.productionQuantity;
    itemSum.remaining = prod.currentAvailableStock;
  }

  // Process transactions
  for (const trans of transactions) {
    totalSales += trans.itemsSold;
    totalRevenue += trans.totalRevenue;
    totalWaste += trans.itemsWaste;
    totalReturned += trans.itemsReturned;

    // Shop summary
    const shopKey = trans.shopId.toString();
    if (!shopSummaryMap.has(shopKey)) {
      shopSummaryMap.set(shopKey, {
        shopId: trans.shopId,
        itemsTaken: 0,
        itemsSold: 0,
        itemsReturned: 0,
        itemsWaste: 0,
        revenue: 0
      });
    }
    const shopSum = shopSummaryMap.get(shopKey);
    shopSum.itemsTaken += trans.itemsTaken;
    shopSum.itemsSold += trans.itemsSold;
    shopSum.itemsReturned += trans.itemsReturned;
    shopSum.itemsWaste += trans.itemsWaste;
    shopSum.revenue += trans.totalRevenue;

    // Item summary
    const itemKey = trans.itemId.toString();
    if (!itemSummaryMap.has(itemKey)) {
      itemSummaryMap.set(itemKey, {
        itemId: trans.itemId,
        produced: 0,
        sold: 0,
        returned: 0,
        wasted: 0,
        remaining: 0,
        revenue: 0
      });
    }
    const itemSum = itemSummaryMap.get(itemKey);
    itemSum.sold += trans.itemsSold;
    itemSum.returned += trans.itemsReturned;
    itemSum.wasted += trans.itemsWaste;
    itemSum.revenue += trans.totalRevenue;
  }

  const reportData = {
    date: startDate,
    totalProduction,
    totalSales,
    totalRevenue,
    totalWaste,
    totalReturned,
    totalRemainingStock,
    shopWiseSummary: Array.from(shopSummaryMap.values()),
    itemWiseSummary: Array.from(itemSummaryMap.values())
  };

  // Update or create report
  return await this.findOneAndUpdate(
    { date: startDate },
    reportData,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model('DailyReport', dailyReportSchema);
