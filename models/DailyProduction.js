const mongoose = require('mongoose');

const dailyProductionSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: [true, 'Date is required'],
    index: true
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: [true, 'Item ID is required']
  },
  productionQuantity: {
    type: Number,
    required: [true, 'Production quantity is required'],
    min: [0, 'Production quantity cannot be negative']
  },
  currentAvailableStock: {
    type: Number,
    required: true,
    min: [0, 'Available stock cannot be negative']
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index for unique item per day
dailyProductionSchema.index({ date: 1, itemId: 1 }, { unique: true });

// Static method to get today's production
dailyProductionSchema.statics.getTodayProduction = async function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return await this.find({
    date: { $gte: today, $lt: tomorrow }
  }).populate('itemId');
};

// Static method to get available stock for an item
dailyProductionSchema.statics.getAvailableStock = async function(itemId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const production = await this.findOne({
    date: { $gte: today, $lt: tomorrow },
    itemId
  });

  return production ? production.currentAvailableStock : 0;
};

module.exports = mongoose.model('DailyProduction', dailyProductionSchema);
