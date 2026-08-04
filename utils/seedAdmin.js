const User = require("../models/user.model");

const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: "admin" });

    if (adminExists) {
      console.log("✅ Admin already exists");
      return;
    }

    const adminName = process.env.ADMIN_NAME;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminName || !adminEmail || !adminPassword) {
      console.log("⚠️ Admin environment variables are missing.");
      return;
    }

    await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPassword, // plain password
      role: "admin",
      isVerified: true,
      isActive: true,
    });

    console.log("==================================");
    console.log("🎉 Default Admin Created");
    console.log("Email:", adminEmail);
    console.log("==================================");
  } catch (err) {
    console.error("❌ Seed Admin Error:", err);
  }
};

module.exports = seedAdmin;
