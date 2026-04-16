const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Item name is required'],
    trim: true,
    unique: true,
    maxlength: [100, 'Item name cannot exceed 100 characters']
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  unit: {
    type: String,
    default: 'piece',
    enum: ['piece', 'plate', 'bottle', 'kg']
  },
  category: {
    type: String,
    default: 'food',
    enum: ['food', 'beverage', 'other']
  },
  lowStockThreshold: {
    type: Number,
    default: 20,
    min: [0, 'Low stock threshold cannot be negative']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Item', itemSchema);
