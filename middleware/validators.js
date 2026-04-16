const { validationResult, body, param, query } = require('express-validator');

// Validation result handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: errors.array()
    });
  }
  next();
};

// Auth validations
const loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  validate
];

const registerValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: 50 })
    .withMessage('Name cannot exceed 50 characters'),
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('role')
    .optional()
    .isIn(['admin', 'seller'])
    .withMessage('Role must be admin or seller'),
  validate
];

// Item validations
const itemValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Item name is required')
    .isLength({ max: 100 })
    .withMessage('Item name cannot exceed 100 characters'),
  body('price')
    .isNumeric()
    .withMessage('Price must be a number')
    .custom(value => value >= 0)
    .withMessage('Price cannot be negative'),
  body('lowStockThreshold')
    .optional()
    .isNumeric()
    .withMessage('Low stock threshold must be a number'),
  validate
];

const priceValidation = [
  body('price')
    .isNumeric()
    .withMessage('Price must be a number')
    .custom(value => value >= 0)
    .withMessage('Price cannot be negative'),
  validate
];

// Shop validations
const shopValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Shop name is required')
    .isLength({ max: 100 })
    .withMessage('Shop name cannot exceed 100 characters'),
  body('shopNumber')
    .isInt({ min: 1, max: 100 })
    .withMessage('Shop number must be between 1 and 100'),
  validate
];

// Production validations
const productionValidation = [
  body('itemId')
    .notEmpty()
    .withMessage('Item ID is required')
    .isMongoId()
    .withMessage('Invalid Item ID'),
  body('productionQuantity')
    .isInt({ min: 0 })
    .withMessage('Production quantity must be a non-negative integer'),
  validate
];

const bulkProductionValidation = [
  body('productions')
    .isArray({ min: 1 })
    .withMessage('Productions array is required'),
  body('productions.*.itemId')
    .notEmpty()
    .withMessage('Item ID is required')
    .isMongoId()
    .withMessage('Invalid Item ID'),
  body('productions.*.productionQuantity')
    .isInt({ min: 0 })
    .withMessage('Production quantity must be a non-negative integer'),
  validate
];

// Transaction validations
const takeItemsValidation = [
  body('shopId')
    .notEmpty()
    .withMessage('Shop ID is required')
    .isMongoId()
    .withMessage('Invalid Shop ID'),
  body('itemId')
    .notEmpty()
    .withMessage('Item ID is required')
    .isMongoId()
    .withMessage('Invalid Item ID'),
  body('quantity')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
  validate
];

const updateTransactionValidation = [
  body('shopId')
    .notEmpty()
    .withMessage('Shop ID is required')
    .isMongoId()
    .withMessage('Invalid Shop ID'),
  body('itemId')
    .notEmpty()
    .withMessage('Item ID is required')
    .isMongoId()
    .withMessage('Invalid Item ID'),
  body('itemsSold')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Items sold must be a non-negative integer'),
  body('itemsReturned')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Items returned must be a non-negative integer'),
  body('itemsWaste')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Items waste must be a non-negative integer'),
  validate
];

const bulkTransactionValidation = [
  body('shopId')
    .notEmpty()
    .withMessage('Shop ID is required')
    .isMongoId()
    .withMessage('Invalid Shop ID'),
  body('transactions')
    .isArray({ min: 1 })
    .withMessage('Transactions array is required'),
  validate
];

// Date validations
const dateParamValidation = [
  param('date')
    .notEmpty()
    .withMessage('Date is required')
    .isISO8601()
    .withMessage('Invalid date format'),
  validate
];

const dateRangeValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
  validate
];

// MongoDB ID validation
const mongoIdValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid ID format'),
  validate
];

const shopIdValidation = [
  param('shopId')
    .isMongoId()
    .withMessage('Invalid Shop ID format'),
  validate
];

module.exports = {
  validate,
  loginValidation,
  registerValidation,
  itemValidation,
  priceValidation,
  shopValidation,
  productionValidation,
  bulkProductionValidation,
  takeItemsValidation,
  updateTransactionValidation,
  bulkTransactionValidation,
  dateParamValidation,
  dateRangeValidation,
  mongoIdValidation,
  shopIdValidation
};
