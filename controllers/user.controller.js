const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const XLSX = require("xlsx");

const User = require("../models/user.model");
const Children = require("../models/child.model");

/**
 * Generate JWT Token
 */
const generateToken = (id, role) => {
  return jwt.sign(
    {
      id,
      role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

/**
 * @desc Register User
 * @route POST /api/users/register
 * @access Public
 */
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, mobile, role } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("Please fill all required fields.");
  }

  const emailRegex =
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  if (!emailRegex.test(email)) {
    res.status(400);
    throw new Error("Invalid email address.");
  }

  if (password.length < 6) {
    res.status(400);
    throw new Error("Password must be at least 6 characters.");
  }

  const normalizedEmail = email.toLowerCase().trim();

  const userExists = await User.findOne({
    email: normalizedEmail,
  });

  if (userExists) {
    res.status(409);
    throw new Error("Email already registered.");
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    mobile,
    role: role || "parent",
  });

  const token = generateToken(user._id, user.role);

  res.status(201).json({
    success: true,
    message: "Registration successful",
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive,
    },
  });
});

/**
 * @desc Login User
 * @route POST /api/users/login
 * @access Public
 */
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and Password are required.");
  }

  const user = await User.findOne({
    email: email.toLowerCase().trim(),
  }).select("+password");

  if (!user) {
    res.status(401);
    throw new Error("Invalid email or password.");
  }

  const isMatch = await user.matchPassword(password);

  if (!isMatch) {
    res.status(401);
    throw new Error("Invalid email or password.");
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error("Your account is disabled.");
  }

  user.lastLogin = new Date();
  await user.save();

  const token = generateToken(user._id, user.role);

  res.status(200).json({
    success: true,
    message: "Login successful",
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive,
      lastLogin: user.lastLogin,
    },
  });
});

/**
 * @desc Get Logged-in User
 * @route GET /api/users/profile
 * @access Private
 */
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }

  res.status(200).json({
    success: true,
    user,
  });
});

/**
 * @desc Update Profile
 * @route PUT /api/users/profile
 * @access Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }

  user.name = req.body.name || user.name;
  user.mobile = req.body.mobile || user.mobile;

  if (req.body.password && req.body.password.length >= 6) {
    user.password = req.body.password;
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
    },
  });
});

/**
 * Normalize Excel column names.
 *
 * Examples:
 * User Name      -> username
 * user_email     -> useremail
 * Child Name     -> childname
 */
const normalizeHeader = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
};

/**
 * Convert Excel row into our expected structure.
 *
 * Supported aliases make the importer more tolerant.
 */
const normalizeImportRow = (row) => {
  const normalized = {};

  Object.keys(row).forEach((key) => {
    normalized[normalizeHeader(key)] = row[key];
  });

  return {
    name:
      normalized.name ||
      normalized.username ||
      normalized.user ||
      normalized.parentname ||
      "",

    email:
      normalized.email ||
      normalized.useremail ||
      normalized.parentemail ||
      "",

    mobile:
      normalized.mobile ||
      normalized.phone ||
      normalized.phonenumber ||
      "",

    password:
      normalized.password ||
      normalized.userpassword ||
      "",

    childName:
      normalized.childname ||
      normalized.studentname ||
      normalized.child ||
      "",

    childAge:
      normalized.childage ||
      normalized.studentage ||
      normalized.age ||
      "",

    childGrade:
      normalized.childgrade ||
      normalized.studentgrade ||
      normalized.grade ||
      normalized.class ||
      "",
  };
};

/**
 * @desc Bulk import users and one child per user from Excel
 * @route POST /api/users/bulk-upload
 * @access Admin
 *
 * Excel columns:
 *
 * name
 * email
 * mobile
 * password
 * childName
 * childAge
 * childGrade
 */
const bulkUploadUsers = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please upload an Excel file.",
    });
  }

  let workbook;

  try {
    workbook = XLSX.read(req.file.buffer, {
      type: "buffer",
      cellDates: true,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Unable to read the Excel file.",
    });
  }

  if (!workbook.SheetNames.length) {
    return res.status(400).json({
      success: false,
      message: "The Excel file does not contain any worksheet.",
    });
  }

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
  });

  if (!rawRows.length) {
    return res.status(400).json({
      success: false,
      message: "The Excel sheet is empty.",
    });
  }

  const results = {
    totalRows: rawRows.length,
    usersCreated: 0,
    existingUsersUsed: 0,
    childrenCreated: 0,
    childrenSkipped: 0,
    failed: 0,
    errors: [],
  };

  for (let index = 0; index < rawRows.length; index++) {
    const rowNumber = index + 2;

    try {
      const row = normalizeImportRow(rawRows[index]);

      const name = String(row.name || "").trim();
      const email = String(row.email || "").trim().toLowerCase();
      const mobile = String(row.mobile || "").trim();
      const password = String(row.password || "").trim();
      const childName = String(row.childName || "").trim();
      const childGrade = String(row.childGrade || "").trim();

      const ageValue = String(row.childAge || "").trim();
      const childAge = Number(ageValue);

      /**
       * Validate parent
       */
      if (!name) {
        throw new Error("User name is required.");
      }

      if (!email) {
        throw new Error("User email is required.");
      }

      const emailRegex =
        /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

      if (!emailRegex.test(email)) {
        throw new Error("Invalid email address.");
      }

      /**
       * Password is required only when creating
       * a completely new user.
       */
      let user = await User.findOne({ email });

      if (!user) {
        if (!password) {
          throw new Error(
            "Password is required when creating a new user."
          );
        }

        if (password.length < 6) {
          throw new Error(
            "Password must contain at least 6 characters."
          );
        }

        user = await User.create({
          name,
          email,
          mobile,
          password,
          role: "parent",
          isActive: true,
        });

        results.usersCreated += 1;
      } else {
        results.existingUsersUsed += 1;

        /**
         * Do not overwrite existing credentials.
         * We only update missing/basic profile information.
         */
        let shouldSave = false;

        if (!user.name && name) {
          user.name = name;
          shouldSave = true;
        }

        if (!user.mobile && mobile) {
          user.mobile = mobile;
          shouldSave = true;
        }

        if (shouldSave) {
          await user.save();
        }

        /**
         * Do not attach imported children to admin accounts.
         */
        if (user.role === "admin") {
          throw new Error(
            "The email belongs to an admin account."
          );
        }
      }

      /**
       * Validate child
       */
      if (!childName) {
        throw new Error("Child name is required.");
      }

      if (!ageValue || !Number.isFinite(childAge) || childAge < 0) {
        throw new Error("Child age must be a valid number.");
      }

      if (!childGrade) {
        throw new Error("Child grade is required.");
      }

      /**
       * Check if this child already exists for this parent.
       */
      const existingChild = await Children.findOne({
        owner: user._id,
        name: childName,
      });

      if (existingChild) {
        results.childrenSkipped += 1;

        results.errors.push({
          row: rowNumber,
          email,
          message:
            "Child already exists for this user. User was not duplicated.",
        });

        continue;
      }

      /**
       * Create one child linked to the imported user.
       */
      await Children.create({
        name: childName,
        age: childAge,
        grade: childGrade,
        parent: String(user._id),
        owner: user._id,
        isDeleted: false,
      });

      results.childrenCreated += 1;
    } catch (error) {
      results.failed += 1;

      results.errors.push({
        row: rowNumber,
        message: error.message || "Unable to import this row.",
      });
    }
  }

  return res.status(200).json({
    success: true,
    message: "Bulk user import completed.",
    data: results,
  });
});

module.exports = {
  registerUser,
  loginUser,
  getProfile,
  updateProfile,
  bulkUploadUsers,
};
