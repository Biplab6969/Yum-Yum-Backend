const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'LOGIN',
      'LOGOUT',
      'CREATE_PRODUCTION',
      'UPDATE_PRODUCTION',
      'CREATE_TRANSACTION',
      'UPDATE_TRANSACTION',
      'UPDATE_ITEM_PRICE',
      'CREATE_USER',
      'UPDATE_USER',
      'DELETE_USER',
      'CREATE_SHOP',
      'UPDATE_SHOP',
      'CLOSE_DAY',
      'EXPORT_REPORT',
      'BACKUP_DATA',
      'RESTORE_DATA'
    ]
  },
  entityType: {
    type: String,
    enum: ['User', 'Shop', 'Item', 'Transaction', 'DailyProduction', 'DailyReport', 'System']
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId
  },
  description: {
    type: String,
    required: true
  },
  oldValue: {
    type: mongoose.Schema.Types.Mixed
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
}, {
  timestamps: true
});

// Index for faster queries
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

// Static method to log action
auditLogSchema.statics.logAction = async function(data) {
  try {
    return await this.create(data);
  } catch (error) {
    console.error('Audit log error:', error);
  }
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
