const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Shop name is required'],
    trim: true,
    maxlength: [100, 'Shop name cannot exceed 100 characters']
  },
  shopNumber: {
    type: Number,
    required: [true, 'Shop number is required'],
    unique: true,
    min: [1, 'Shop number must be at least 1'],
    max: [100, 'Shop number cannot exceed 100']
  },
  location: {
    type: String,
    trim: true,
    default: ''
  },
  contactNumber: {
    type: String,
    trim: true,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Virtual for getting shop display name
shopSchema.virtual('displayName').get(function() {
  return `Shop ${this.shopNumber} - ${this.name}`;
});

// Ensure virtuals are included in JSON output
shopSchema.set('toJSON', { virtuals: true });
shopSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Shop', shopSchema);
