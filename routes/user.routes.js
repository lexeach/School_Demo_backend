const express = require("express");

const router = express.Router();

const {
  registerUser,
  loginUser,
  getProfile,
  updateProfile,
  bulkUploadUsers,
} = require("../controllers/user.controller");

const {
  protect,
  adminAuth,
} = require("../middleware/auth");

const excelUpload = require("../middleware/excelUpload");

/**
 * Public Routes
 */

// Register
router.post("/register", registerUser);

// Login
router.post("/login", loginUser);

/**
 * Protected Routes
 */

// Get Logged-in User
router.get("/profile", protect, getProfile);

// Update Profile
router.put("/profile", protect, updateProfile);

/**
 * Admin Routes
 *
 * Import users + one child per row from Excel.
 */
router.post(
  "/bulk-upload",
  protect,
  adminAuth,
  excelUpload.single("file"),
  bulkUploadUsers
);

module.exports = router;
