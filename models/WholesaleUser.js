const mongoose = require('mongoose');

const wholesaleUserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [80, 'Name cannot exceed 80 characters']
  },
  companyName: {
    type: String,
    trim: true,
    maxlength: [120, 'Company name cannot exceed 120 characters'],
    default: ''
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    unique: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/, 'Please provide a valid email']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    maxlength: [20, 'Phone cannot exceed 20 characters']
  },
  address: {
    type: String,
    trim: true,
    maxlength: [300, 'Address cannot exceed 300 characters'],
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters'],
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastReminderSentAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

wholesaleUserSchema.index({ name: 1 });
wholesaleUserSchema.index({ isActive: 1 });

module.exports = mongoose.model('WholesaleUser', wholesaleUserSchema);
