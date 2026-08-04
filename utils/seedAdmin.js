const bcrypt = require("bcryptjs");
const User = require("./models/User");

const seedAdmin = async () => {
  try {
    // Check if admin already exists
    const adminExists = await User.findOne({
      role: "admin",
    });

    if (adminExists) {
      console.log("✅ Admin already exists");
      return;
    }

    // Read from environment variables
    const adminName = process.env.ADMIN_NAME;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // Validate env variables
    if (!adminName || !adminEmail || !adminPassword) {
      console.log("⚠️ Admin environment variables are missing.");
      return;
    }

    // Encrypt password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Create admin
    await User.create({
      name: adminName,
      email: adminEmail,
      password: hashedPassword,
      role: "admin",
      isVerified: true,
      isActive: true,
    });

    console.log("======================================");
    console.log("🎉 Default Admin Created Successfully");
    console.log("Email :", adminEmail);
    console.log("======================================");
  } catch (error) {
    console.error("❌ Admin Seeder Error");
    console.error(error);
  }
};

module.exports = seedAdmin;
