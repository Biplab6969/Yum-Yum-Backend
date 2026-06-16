const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { User } = require('../models');

// Protect routes
exports.protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Check for token in cookies
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // Make sure token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (mongoose.connection.readyState !== 1) {
        req.user = {
          id: decoded.id,
          _id: decoded.id,
          name: decoded.name,
          email: decoded.email,
          role: decoded.role,
          shopId: decoded.shopId || null,
          isActive: true
        };

        return next();
      }

      // Get user from token
      req.user = await User.findById(decoded.id);

      if (!req.user) {
        if (decoded.name && decoded.email && decoded.role) {
          req.user = {
            id: decoded.id,
            _id: decoded.id,
            name: decoded.name,
            email: decoded.email,
            role: decoded.role,
            shopId: decoded.shopId || null,
            isActive: true
          };

          return next();
        }

        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!req.user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`
      });
    }
    next();
  };
};

// Check if user belongs to shop
exports.checkShopAccess = async (req, res, next) => {
  try {
    // Admins can access all shops
    if (req.user.role === 'admin') {
      return next();
    }

    // Sellers can only access their own shop
    const shopId = req.params.shopId || req.body.shopId;
    
    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID is required'
      });
    }

    if (!req.user.shopId || req.user.shopId.toString() !== shopId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this shop'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Authorization error',
      error: error.message
    });
  }
};
