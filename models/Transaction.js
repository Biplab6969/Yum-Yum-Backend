const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: [true, 'Shop ID is required']
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: [true, 'Item ID is required']
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
    index: true
  },
  itemsTaken: {
    type: Number,
    default: 0,
    min: [0, 'Items taken cannot be negative']
  },
  itemsSold: {
    type: Number,
    default: 0,
    min: [0, 'Items sold cannot be negative']
  },
  itemsReturned: {
    type: Number,
    default: 0,
    min: [0, 'Items returned cannot be negative']
  },
  itemsWaste: {
    type: Number,
    default: 0,
    min: [0, 'Items waste cannot be negative']
  },
  pricePerItem: {
    type: Number,
    required: true,
    min: [0, 'Price cannot be negative']
  },
  totalRevenue: {
    type: Number,
    default: 0,
    min: [0, 'Revenue cannot be negative']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index for unique shop-item per day
transactionSchema.index({ shopId: 1, itemId: 1, date: 1 }, { unique: true });

// Calculate total revenue before saving
transactionSchema.pre('save', function(next) {
  this.totalRevenue = this.itemsSold * this.pricePerItem;
  next();
});

// Validate that sold + returned + waste <= taken
transactionSchema.pre('save', function(next) {
  const totalUsed = this.itemsSold + this.itemsReturned + this.itemsWaste;
  if (totalUsed > this.itemsTaken) {
    return next(new Error('Total of sold, returned, and waste cannot exceed items taken'));
  }
  next();
});

// Static method to get shop's daily summary
transactionSchema.statics.getShopDailySummary = async function(shopId, date) {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  return await this.aggregate([
    {
      $match: {
        shopId: new mongoose.Types.ObjectId(shopId),
        date: { $gte: startDate, $lt: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalItemsTaken: { $sum: '$itemsTaken' },
        totalItemsSold: { $sum: '$itemsSold' },
        totalItemsReturned: { $sum: '$itemsReturned' },
        totalItemsWaste: { $sum: '$itemsWaste' },
        totalRevenue: { $sum: '$totalRevenue' }
      }
    }
  ]);
};

// Static method to get all shops summary for a date range
transactionSchema.statics.getAllShopsSummary = async function(startDate, endDate) {
  return await this.aggregate([
    {
      $match: {
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }
    },
    {
      $group: {
        _id: '$shopId',
        totalItemsTaken: { $sum: '$itemsTaken' },
        totalItemsSold: { $sum: '$itemsSold' },
        totalItemsReturned: { $sum: '$itemsReturned' },
        totalItemsWaste: { $sum: '$itemsWaste' },
        totalRevenue: { $sum: '$totalRevenue' }
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
        shopId: '$_id',
        shopName: '$shop.name',
        shopNumber: '$shop.shopNumber',
        totalItemsTaken: 1,
        totalItemsSold: 1,
        totalItemsReturned: 1,
        totalItemsWaste: 1,
        totalRevenue: 1
      }
    },
    {
      $sort: { shopNumber: 1 }
    }
  ]);
};

module.exports = mongoose.model('Transaction', transactionSchema);
