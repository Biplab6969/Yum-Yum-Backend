const { Item, AuditLog, WholesaleUser, WholesaleLedgerEntry } = require('../models');
const {
  formatCurrency,
  sendWhatsAppMessage
} = require('../services/wholesaleNotificationService');

const toDateRangeForToday = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const generateReceiptNumber = (prefix = 'WS') => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${datePart}-${randomPart}`;
};

const createUniqueReceiptNumber = async (prefix = 'WS', maxAttempts = 10) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateReceiptNumber(prefix);
    const exists = await WholesaleLedgerEntry.exists({ receiptNumber: candidate });
    if (!exists) {
      return candidate;
    }
  }

  throw new Error('Failed to generate unique receipt number');
};

const getWholesaleSummary = async (wholesaleUserId) => {
  const { start, end } = toDateRangeForToday();

  const [allAgg, beforeTodayAgg, todayAgg] = await Promise.all([
    WholesaleLedgerEntry.aggregate([
      { $match: { wholesaleUserId } },
      {
        $group: {
          _id: '$entryType',
          total: { $sum: '$amount' }
        }
      }
    ]),
    WholesaleLedgerEntry.aggregate([
      { $match: { wholesaleUserId, createdAt: { $lt: start } } },
      {
        $group: {
          _id: '$entryType',
          total: { $sum: '$amount' }
        }
      }
    ]),
    WholesaleLedgerEntry.aggregate([
      { $match: { wholesaleUserId, createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: '$entryType',
          total: { $sum: '$amount' }
        }
      }
    ])
  ]);

  const readTotal = (rows, type) => {
    const row = rows.find((entry) => entry._id === type);
    return row ? row.total : 0;
  };

  const totalSales = readTotal(allAgg, 'SALE');
  const totalPayments = readTotal(allAgg, 'PAYMENT');
  const pendingAmount = Math.max(0, totalSales - totalPayments);

  const previousPending = Math.max(0, readTotal(beforeTodayAgg, 'SALE') - readTotal(beforeTodayAgg, 'PAYMENT'));
  const todaySalesAmount = readTotal(todayAgg, 'SALE');
  const todayReceivedAmount = readTotal(todayAgg, 'PAYMENT');

  return {
    totalSales,
    totalPayments,
    pendingAmount,
    previousPending,
    todaySalesAmount,
    todayReceivedAmount,
    todayOutstanding: Math.max(0, todaySalesAmount - todayReceivedAmount)
  };
};

const normalizePhone = (phone) => {
  if (!phone) return '';
  return String(phone).trim();
};

const formatReceiptDate = (dateValue) =>
  new Date(dateValue || Date.now()).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

const createSaleWhatsAppReceiptText = ({ wholesaleUser, saleEntry, summaryAfter }) => {
  const itemLines = saleEntry.items
    .map((line, index) => {
      return `${index + 1}. ${line.itemName} | Qty: ${line.quantity} | Rate: ${formatCurrency(
        line.unitPrice
      )} | Total: ${formatCurrency(line.lineTotal)}`;
    })
    .join('\n');

  const totalAmount = saleEntry.amount;
  const pendingAmount = summaryAfter.pendingAmount;
  const totalMoney = totalAmount + pendingAmount;

  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🍜 YUM YUM MOMO`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Date: ${formatReceiptDate(saleEntry.createdAt)}`,
    `Receipt No: ${saleEntry.receiptNumber}`,
    ``,
    `Customer: ${wholesaleUser.name}`,
    wholesaleUser.companyName ? `Company: ${wholesaleUser.companyName}` : null,
    `Phone: ${wholesaleUser.phone}`,
    ``,
    `────────────────────────`,
    `Items:`,
    itemLines,
    `────────────────────────`,
    ``,
    `Total amount: ${formatCurrency(totalAmount)}`,
    `Pending amount: ${formatCurrency(pendingAmount)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Total: ${formatCurrency(totalMoney)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Thank you for your order! 🙏`
  ]
    .filter(Boolean)
    .join('\n');
};

const createPaymentWhatsAppReceiptText = ({ wholesaleUser, paymentEntry, summaryAfter }) => {
  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🍜 YUM YUM MOMO`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Payment Receipt`,
    `Date: ${formatReceiptDate(paymentEntry.createdAt)}`,
    `Receipt No: ${paymentEntry.receiptNumber}`,
    ``,
    `Customer: ${wholesaleUser.name}`,
    wholesaleUser.companyName ? `Company: ${wholesaleUser.companyName}` : null,
    `Phone: ${wholesaleUser.phone}`,
    ``,
    `────────────────────────`,
    `Amount Received: ${formatCurrency(paymentEntry.amount)}`,
    `Payment Method: ${paymentEntry.paymentMethod}`,
    `Pending amount: ${formatCurrency(summaryAfter.pendingAmount)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Thank you for the payment! 🙏`
  ]
    .filter(Boolean)
    .join('\n');
};

const createReminderWhatsAppText = ({ wholesaleUser, summary, asOfDate }) => {
  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🍜 YUM YUM MOMO`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Pending Amount Reminder`,
    `Date: ${formatReceiptDate(asOfDate)}`,
    ``,
    `Customer: ${wholesaleUser.name}`,
    wholesaleUser.companyName ? `Company: ${wholesaleUser.companyName}` : null,
    `Phone: ${wholesaleUser.phone}`,
    ``,
    `────────────────────────`,
    `Previous Pending: ${formatCurrency(summary.previousPending)}`,
    `Today Sales: ${formatCurrency(summary.todaySalesAmount)}`,
    `Today Received: ${formatCurrency(summary.todayReceivedAmount)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Total Pending: ${formatCurrency(summary.pendingAmount)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Please clear the pending amount soon. Thank you! 🙏`
  ]
    .filter(Boolean)
    .join('\n');
};

// @desc    Create wholesale user
// @route   POST /api/wholesale/users
// @access  Private/Admin
exports.createWholesaleUser = async (req, res) => {
  try {
    const { name, companyName, email, phone, address, notes } = req.body;

    const existing = await WholesaleUser.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Wholesale user with this email already exists'
      });
    }

    const wholesaleUser = await WholesaleUser.create({
      name,
      companyName: companyName || '',
      email: email.toLowerCase(),
      phone: normalizePhone(phone),
      address: address || '',
      notes: notes || ''
    });

    await AuditLog.logAction({
      userId: req.user._id,
      action: 'CREATE_WHOLESALE_USER',
      entityType: 'WholesaleUser',
      entityId: wholesaleUser._id,
      description: `Created wholesale user: ${wholesaleUser.name}`,
      newValue: {
        name: wholesaleUser.name,
        email: wholesaleUser.email,
        phone: wholesaleUser.phone
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Wholesale user created successfully',
      data: wholesaleUser
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating wholesale user',
      error: error.message
    });
  }
};

// @desc    Update wholesale user
// @route   PUT /api/wholesale/users/:id
// @access  Private/Admin
exports.updateWholesaleUser = async (req, res) => {
  try {
    const wholesaleUser = await WholesaleUser.findById(req.params.id);
    if (!wholesaleUser) {
      return res.status(404).json({
        success: false,
        message: 'Wholesale user not found'
      });
    }

    const { name, companyName, email, phone, address, notes, isActive } = req.body;
    const oldValue = {
      name: wholesaleUser.name,
      companyName: wholesaleUser.companyName,
      email: wholesaleUser.email,
      phone: wholesaleUser.phone,
      isActive: wholesaleUser.isActive
    };

    if (name !== undefined) wholesaleUser.name = name;
    if (companyName !== undefined) wholesaleUser.companyName = companyName;
    if (email !== undefined) wholesaleUser.email = String(email).toLowerCase();
    if (phone !== undefined) wholesaleUser.phone = normalizePhone(phone);
    if (address !== undefined) wholesaleUser.address = address;
    if (notes !== undefined) wholesaleUser.notes = notes;
    if (isActive !== undefined) wholesaleUser.isActive = isActive;

    await wholesaleUser.save();

    await AuditLog.logAction({
      userId: req.user._id,
      action: 'UPDATE_WHOLESALE_USER',
      entityType: 'WholesaleUser',
      entityId: wholesaleUser._id,
      description: `Updated wholesale user: ${wholesaleUser.name}`,
      oldValue,
      newValue: {
        name: wholesaleUser.name,
        companyName: wholesaleUser.companyName,
        email: wholesaleUser.email,
        phone: wholesaleUser.phone,
        isActive: wholesaleUser.isActive
      },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Wholesale user updated successfully',
      data: wholesaleUser
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating wholesale user',
      error: error.message
    });
  }
};

// @desc    Get wholesale users with summary
// @route   GET /api/wholesale/users
// @access  Private/Admin
exports.getWholesaleUsers = async (req, res) => {
  try {
    const users = await WholesaleUser.find().sort({ createdAt: -1 });

    const usersWithSummary = await Promise.all(
      users.map(async (user) => {
        const summary = await getWholesaleSummary(user._id);
        return {
          ...user.toObject(),
          summary
        };
      })
    );

    res.status(200).json({
      success: true,
      count: usersWithSummary.length,
      data: usersWithSummary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching wholesale users',
      error: error.message
    });
  }
};

// @desc    Get wholesale user details + ledger
// @route   GET /api/wholesale/users/:id/ledger
// @access  Private/Admin
exports.getWholesaleUserLedger = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    const skip = (page - 1) * limit;

    const wholesaleUser = await WholesaleUser.findById(req.params.id);
    if (!wholesaleUser) {
      return res.status(404).json({
        success: false,
        message: 'Wholesale user not found'
      });
    }

    const [entries, total, summary, items] = await Promise.all([
      WholesaleLedgerEntry.find({ wholesaleUserId: wholesaleUser._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name email'),
      WholesaleLedgerEntry.countDocuments({ wholesaleUserId: wholesaleUser._id }),
      getWholesaleSummary(wholesaleUser._id),
      Item.find({ isActive: true }).sort({ name: 1 })
    ]);

    res.status(200).json({
      success: true,
      data: {
        wholesaleUser,
        summary,
        items,
        ledger: {
          page,
          limit,
          total,
          entries
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching wholesale ledger',
      error: error.message
    });
  }
};

// @desc    Create wholesale sale entry and send receipt
// @route   POST /api/wholesale/users/:id/sales
// @access  Private/Admin
exports.createWholesaleSale = async (req, res) => {
  try {
    const wholesaleUser = await WholesaleUser.findById(req.params.id);
    if (!wholesaleUser) {
      return res.status(404).json({
        success: false,
        message: 'Wholesale user not found'
      });
    }

    const { items: inputItems = [], notes = '' } = req.body;
    const saleLines = inputItems
      .map((line) => ({
        itemId: line.itemId,
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unitPrice || 0)
      }))
      .filter((line) => line.quantity > 0 && line.unitPrice >= 0);

    if (saleLines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item with quantity is required'
      });
    }

    const itemIds = saleLines.map((line) => line.itemId);
    const dbItems = await Item.find({ _id: { $in: itemIds } });
    const itemsById = new Map(dbItems.map((item) => [item._id.toString(), item]));

    const normalizedLines = saleLines.map((line) => {
      const item = itemsById.get(String(line.itemId));
      if (!item) {
        throw new Error(`Item not found for id: ${line.itemId}`);
      }
      return {
        itemId: item._id,
        itemName: item.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: Number((line.quantity * line.unitPrice).toFixed(2))
      };
    });

    const totalAmount = Number(
      normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0).toFixed(2)
    );

    const receiptNumber = await createUniqueReceiptNumber('WS');

    const saleEntry = await WholesaleLedgerEntry.create({
      wholesaleUserId: wholesaleUser._id,
      entryType: 'SALE',
      amount: totalAmount,
      items: normalizedLines,
      receiptNumber,
      notes,
      createdBy: req.user._id
    });

    const summaryAfter = await getWholesaleSummary(wholesaleUser._id);

    let whatsappResult = { sent: false, skipped: true, reason: 'NOT_ATTEMPTED' };

    try {
      whatsappResult = await sendWhatsAppMessage({
        to: wholesaleUser.phone,
        body: createSaleWhatsAppReceiptText({ wholesaleUser, saleEntry, summaryAfter })
      });
    } catch (notificationError) {
      whatsappResult = {
        sent: false,
        reason: notificationError.message || 'WHATSAPP_NOTIFICATION_FAILED'
      };
    }

    await AuditLog.logAction({
      userId: req.user._id,
      action: 'CREATE_WHOLESALE_SALE',
      entityType: 'WholesaleSale',
      entityId: saleEntry._id,
      description: `Created wholesale sale for ${wholesaleUser.name} (${saleEntry.receiptNumber})`,
      newValue: {
        receiptNumber: saleEntry.receiptNumber,
        amount: saleEntry.amount,
        itemCount: saleEntry.items.length
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Wholesale sale saved and receipt processed',
      data: {
        saleEntry,
        summaryAfter,
        notification: {
          whatsapp: whatsappResult
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating wholesale sale',
      error: error.message
    });
  }
};

// @desc    Record wholesale payment
// @route   POST /api/wholesale/users/:id/payments
// @access  Private/Admin
exports.recordWholesalePayment = async (req, res) => {
  try {
    const wholesaleUser = await WholesaleUser.findById(req.params.id);
    if (!wholesaleUser) {
      return res.status(404).json({
        success: false,
        message: 'Wholesale user not found'
      });
    }

    const amount = Number(req.body.amount || 0);
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than zero'
      });
    }

    const paymentMethod = req.body.paymentMethod || 'other';
    const notes = req.body.notes || '';

    const receiptNumber = await createUniqueReceiptNumber('WSP');

    const paymentEntry = await WholesaleLedgerEntry.create({
      wholesaleUserId: wholesaleUser._id,
      entryType: 'PAYMENT',
      amount,
      paymentMethod,
      receiptNumber,
      notes,
      createdBy: req.user._id
    });

    const summaryAfter = await getWholesaleSummary(wholesaleUser._id);

    const whatsappResult = await sendWhatsAppMessage({
      to: wholesaleUser.phone,
      body: createPaymentWhatsAppReceiptText({ wholesaleUser, paymentEntry, summaryAfter })
    });

    await AuditLog.logAction({
      userId: req.user._id,
      action: 'RECORD_WHOLESALE_PAYMENT',
      entityType: 'WholesalePayment',
      entityId: paymentEntry._id,
      description: `Recorded payment for ${wholesaleUser.name} (${paymentEntry.receiptNumber})`,
      newValue: {
        receiptNumber: paymentEntry.receiptNumber,
        amount: paymentEntry.amount,
        paymentMethod: paymentEntry.paymentMethod
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        paymentEntry,
        summaryAfter,
        notification: {
          whatsapp: whatsappResult
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error recording payment',
      error: error.message
    });
  }
};

const shouldSkipReminderToday = (lastReminderSentAt) => {
  if (!lastReminderSentAt) return false;

  const now = new Date();
  const last = new Date(lastReminderSentAt);
  return (
    now.getFullYear() === last.getFullYear() &&
    now.getMonth() === last.getMonth() &&
    now.getDate() === last.getDate()
  );
};

const sendReminderToUser = async (wholesaleUser) => {
  const summary = await getWholesaleSummary(wholesaleUser._id);
  if (summary.pendingAmount <= 0) {
    return { skipped: true, reason: 'NO_PENDING' };
  }

  if (shouldSkipReminderToday(wholesaleUser.lastReminderSentAt)) {
    return { skipped: true, reason: 'ALREADY_SENT_TODAY' };
  }

  const asOfDate = new Date();
  const whatsappResult = await sendWhatsAppMessage({
    to: wholesaleUser.phone,
    body: createReminderWhatsAppText({ wholesaleUser, summary, asOfDate })
  });

  wholesaleUser.lastReminderSentAt = asOfDate;
  await wholesaleUser.save();

  return {
    skipped: false,
    summary,
    whatsappResult
  };
};

// @desc    Trigger daily pending reminders manually
// @route   POST /api/wholesale/reminders/send-daily
// @access  Private/Admin
exports.sendDailyPendingReminders = async (req, res) => {
  try {
    const activeUsers = await WholesaleUser.find({ isActive: true });

    const results = [];
    for (const wholesaleUser of activeUsers) {
      const reminderResult = await sendReminderToUser(wholesaleUser);
      results.push({
        wholesaleUserId: wholesaleUser._id,
        name: wholesaleUser.name,
        ...reminderResult
      });
    }

    await AuditLog.logAction({
      userId: req.user._id,
      action: 'SEND_WHOLESALE_REMINDERS',
      entityType: 'System',
      description: 'Triggered wholesale pending reminder batch',
      newValue: {
        attempted: results.length,
        sent: results.filter((r) => !r.skipped).length
      },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Pending reminder job completed',
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error sending pending reminders',
      error: error.message
    });
  }
};

// Used by cron job
exports.runDailyPendingReminderJob = async () => {
  const activeUsers = await WholesaleUser.find({ isActive: true });
  const results = [];

  for (const wholesaleUser of activeUsers) {
    try {
      const reminderResult = await sendReminderToUser(wholesaleUser);
      results.push({
        wholesaleUserId: wholesaleUser._id,
        name: wholesaleUser.name,
        ...reminderResult
      });
    } catch (error) {
      results.push({
        wholesaleUserId: wholesaleUser._id,
        name: wholesaleUser.name,
        skipped: true,
        reason: error.message
      });
    }
  }

  return results;
};
