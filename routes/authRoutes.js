const express = require('express');
const router = express.Router();
const { authController } = require('../controllers');
const { protect, authorize, loginValidation, registerValidation, mongoIdValidation } = require('../middleware');

// Public routes
router.post('/login', loginValidation, authController.login);

// Protected routes
router.use(protect);

router.get('/me', authController.getMe);
router.put('/updatepassword', authController.updatePassword);

// Admin only routes
router.post('/register', authorize('admin'), registerValidation, authController.register);
router.get('/users', authorize('admin'), authController.getAllUsers);
router.put('/users/:id', authorize('admin'), mongoIdValidation, authController.updateUser);
router.delete('/users/:id', authorize('admin'), mongoIdValidation, authController.deleteUser);

module.exports = router;
