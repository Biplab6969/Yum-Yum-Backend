require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');

// Import models
const User = require('../models/User');
const Shop = require('../models/Shop');
const Item = require('../models/Item');
const DailyProduction = require('../models/DailyProduction');
const Transaction = require('../models/Transaction');

// Seed data
const shops = [
  { name: 'Momo Stall 1', shopNumber: 1, location: 'Main Street', contactNumber: '9876543210' },
  { name: 'Momo Stall 2', shopNumber: 2, location: 'Market Area', contactNumber: '9876543211' },
  { name: 'Momo Stall 3', shopNumber: 3, location: 'College Road', contactNumber: '9876543212' },
  { name: 'Momo Stall 4', shopNumber: 4, location: 'Station Area', contactNumber: '9876543213' }
];

const items = [
  { name: 'Veg Momo', price: 60, unit: 'plate', category: 'food', lowStockThreshold: 30 },
  { name: 'Chicken Momo', price: 80, unit: 'plate', category: 'food', lowStockThreshold: 30 },
  { name: 'Chicken 65', price: 120, unit: 'plate', category: 'food', lowStockThreshold: 20 },
  { name: 'Chicken Lollipop', price: 150, unit: 'plate', category: 'food', lowStockThreshold: 20 },
  { name: 'Fish Finger', price: 140, unit: 'plate', category: 'food', lowStockThreshold: 15 },
  { name: 'Chicken Finger', price: 130, unit: 'plate', category: 'food', lowStockThreshold: 15 },
  { name: 'Water Bottle', price: 20, unit: 'bottle', category: 'beverage', lowStockThreshold: 50 }
];

const seedDatabase = async () => {
  try {
    await connectDB();
    
    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Shop.deleteMany({});
    await Item.deleteMany({});
    await DailyProduction.deleteMany({});
    await Transaction.deleteMany({});

    console.log('🏪 Creating shops...');
    const createdShops = await Shop.insertMany(shops);
    console.log(`   ✅ Created ${createdShops.length} shops`);

    console.log('📦 Creating items...');
    const createdItems = await Item.insertMany(items);
    console.log(`   ✅ Created ${createdItems.length} items`);

    console.log('👤 Creating admin user...');
    const adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@yumyum.com',
      password: 'admin123',
      role: 'admin',
      isActive: true
    });
    console.log(`   ✅ Admin created: ${adminUser.email}`);

    console.log('👥 Creating seller users...');
    const sellerUsers = [];
    for (const shop of createdShops) {
      const seller = await User.create({
        name: `Seller Shop ${shop.shopNumber}`,
        email: `seller${shop.shopNumber}@yumyum.com`,
        password: 'seller123',
        role: 'seller',
        shopId: shop._id,
        isActive: true
      });
      sellerUsers.push(seller);
      console.log(`   ✅ Seller created: ${seller.email} (${shop.name})`);
    }

    // Create today's production data
    console.log('📊 Creating sample production data...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const productionData = [
      { itemId: createdItems[0]._id, productionQuantity: 100, currentAvailableStock: 100 }, // Veg Momo
      { itemId: createdItems[1]._id, productionQuantity: 80, currentAvailableStock: 80 },   // Chicken Momo
      { itemId: createdItems[2]._id, productionQuantity: 40, currentAvailableStock: 40 },   // Chicken 65
      { itemId: createdItems[3]._id, productionQuantity: 35, currentAvailableStock: 35 },   // Chicken Lollipop
      { itemId: createdItems[4]._id, productionQuantity: 30, currentAvailableStock: 30 },   // Fish Finger
      { itemId: createdItems[5]._id, productionQuantity: 30, currentAvailableStock: 30 },   // Chicken Finger
      { itemId: createdItems[6]._id, productionQuantity: 100, currentAvailableStock: 100 }  // Water Bottle
    ];

    for (const prod of productionData) {
      await DailyProduction.create({
        date: today,
        itemId: prod.itemId,
        productionQuantity: prod.productionQuantity,
        currentAvailableStock: prod.currentAvailableStock,
        createdBy: adminUser._id
      });
    }
    console.log(`   ✅ Created production data for ${productionData.length} items`);

    console.log('\n' + '═'.repeat(60));
    console.log('🎉 Database seeded successfully!');
    console.log('═'.repeat(60));
    console.log('\n📋 Login Credentials:');
    console.log('─'.repeat(40));
    console.log('ADMIN:');
    console.log('   Email: admin@yumyum.com');
    console.log('   Password: admin123');
    console.log('─'.repeat(40));
    console.log('SELLERS:');
    for (let i = 1; i <= 4; i++) {
      console.log(`   Shop ${i}: seller${i}@yumyum.com / seller123`);
    }
    console.log('─'.repeat(40));
    console.log('\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
