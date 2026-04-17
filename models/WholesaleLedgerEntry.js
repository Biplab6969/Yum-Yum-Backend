const mongoose = require('mongoose');

const wholesaleItemLineSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  itemName: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [0, 'Quantity cannot be negative']
  },
  unitPrice: {
    type: Number,
    required: true,
    min: [0, 'Unit price cannot be negative']
  },
  lineTotal: {
    type: Number,
    required: true,
    min: [0, 'Line total cannot be negative']
  }
}, { _id: false });

const wholesaleLedgerEntrySchema = new mongoose.Schema({
  wholesaleUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WholesaleUser',
    required: true,
    index: true
  },
  entryType: {
    type: String,
    enum: ['SALE', 'PAYMENT', 'ADJUSTMENT'],
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative']
  },
  items: {
    type: [wholesaleItemLineSchema],
    default: []
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'bank', 'card', 'other'],
    default: 'other'
  },
  receiptNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters'],
    default: ''
  },
  isReminderEntry: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

wholesaleLedgerEntrySchema.index({ wholesaleUserId: 1, createdAt: -1 });

module.exports = mongoose.model('WholesaleLedgerEntry', wholesaleLedgerEntrySchema);
