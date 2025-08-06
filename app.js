require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const Razorpay = require("razorpay");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const fs = require("fs");
const { log } = require("console");

const app = express();
app.use(express.json());
const port = process.env.PORT 
app.use("/uploads", express.static("uploads"));

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  })
);

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
    return;
  }
  console.log("Connected to MySQL database");
});

// MARK:LOGIN AND SIGNUP

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  const checkUser = "SELECT * FROM customer WHERE email = ?";
  db.query(checkUser, [email], async (err, result) => {
    if (result.length > 0) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO customer (name, email, password) VALUES (?, ?, ?)";
    db.query(sql, [name, email, hashedPassword], (err, result) => {
      if (err) return res.status(500).json({ error: "Registration failed" });
      res.json({ message: "Registration successful" });
    });
  });
});

// Login Endpoint
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM customer WHERE email = ?";
  db.query(sql, [email], async (err, results) => {
    if (err || results.length === 0) {
      return res.status(401).json({ message: "Check email and try again" });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Wrong Password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ message: "Login successful", token });
  });
});

// MARK:TRAINER
app.get("/tusers", (req, res) => {
  db.query("SELECT * FROM trainer", (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(results);
  });
});

// DELETE user by ID
app.delete("/tusers/:id", (req, res) => {
  const id = req.params.id;

  db.query("DELETE FROM trainer WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found!" });
    }

    res.json({ message: "User deleted successfully" });
  });
});

// POST - Add a new user
app.post("/tusers", (req, res) => {
  const { name, age, city, experience, mobile, email } = req.body;

  if (!name || !age || !city || !experience || !mobile || !email) {
    return res.status(400).json({ message: "All fields are required!" });
  }

  // Check if user already exists
  db.query(
    "SELECT * FROM trainer WHERE mobile = ?",
    [mobile],
    (err, results) => {
      if (err) {
        console.error("Database SELECT error:", err); // Debugging
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length > 0) {
        return res
          .status(409)
          .json({ message: "User with this mobile number already exists!" });
      }

      // Insert new user
      const sql =
        "INSERT INTO trainer (name, age, city, experience, mobile, email) VALUES (?, ?, ?, ?, ?, ?)";
      const values = [name, age, city, experience, mobile, email];

      db.query(sql, values, (err, result) => {
        if (err) {
          console.error("Database INSERT error:", err); // Debugging
          return res.status(500).json({ error: "Database error" });
        }

        console.log("User added successfully:", result);
        res.json({ message: "User added successfully", id: result.insertId });
      });
    }
  );
});

// PATCH - Update user by ID
app.patch("/tusers/:id", (req, res) => {
  const id = req.params.id;
  const { name, age, city, experience, mobile, email } = req.body;

  // Fetch the user first
  db.query("SELECT * FROM trainer WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found!" });
    }

    const user = results[0];

    // Update only provided fields
    const updatedUser = {
      name: name || user.name,
      age: age || user.age,
      city: city || user.city,
      experience: experience || user.experience,
      mobile: mobile || user.mobile,

      email: email || user.email,
    };

    db.query(
      "UPDATE trainer SET name=?, age=?, city=?, experience=?, mobile=?,email=? WHERE id=?",
      [
        updatedUser.name,
        updatedUser.age,
        updatedUser.city,
        updatedUser.experience,
        updatedUser.mobile,
        updatedUser.email,
        id,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: "Database error" });

        res.json({ message: "User updated successfully" });
      }
    );
  });
});

// MARK:ATTANDANCE FOR TRAINER
app.get("/trainers", (req, res) => {
  const sql = `
        SELECT t.*, a.check_in_time, a.check_out_time 
        FROM trainer t 
        LEFT JOIN (
            SELECT trainer_id, MAX(check_in_time) AS check_in_time, MAX(check_out_time) AS check_out_time
            FROM attendance 
            GROUP BY trainer_id
        ) a ON t.id = a.trainer_id;
    `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/add-trainer", (req, res) => {
  const { name, age, city, experience, mobile, email } = req.body;

  const insertTrainerSql = `INSERT INTO trainer (name, age, city, experience, mobile, email) VALUES (?, ?, ?, ?, ?, ?)`;

  db.query(
    insertTrainerSql,
    [name, age, city, experience, mobile, email],
    (err, result) => {
      if (err) {
        console.error("Error inserting trainer:", err);
        return res.status(500).json({ error: err.message });
      }

      const trainerId = result.insertId; // Get the inserted trainer's ID
      console.log("Trainer added with ID:", trainerId);

      // Insert a default attendance record with NULL check-in/out
      const insertAttendanceSql = `INSERT INTO attendance (trainer_id, check_in_time, check_out_time) VALUES (?, NULL, NULL)`;
      db.query(insertAttendanceSql, [trainerId], (err) => {
        if (err) {
          console.error("Error inserting attendance record:", err);
          return res.status(500).json({ error: err.message });
        }

        res.json({
          message: "Trainer added with attendance record",
          trainerId,
        });
      });
    }
  );
});

app.post("/check-in-out", (req, res) => {
  const { trainer_id } = req.body;

  if (!trainer_id) {
    return res.status(400).json({ error: "Trainer ID is required" });
  }

  // Check the latest attendance record for this trainer
  const checkSql =
    "SELECT * FROM attendance WHERE trainer_id = ? ORDER BY id DESC LIMIT 1";
  db.query(checkSql, [trainer_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length === 0 || results[0].check_out_time) {
      // If no record exists or check-out is done, insert a new check-in
      const insertSql =
        "INSERT INTO attendance (trainer_id, check_in_time) VALUES (?, NOW())";
      db.query(insertSql, [trainer_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Checked In", checkInTime: new Date() });
      });
    } else {
      // If already checked-in, update with check-out time
      const updateSql =
        "UPDATE attendance SET check_out_time = NOW() WHERE id = ?";
      db.query(updateSql, [results[0].id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Checked Out", checkOutTime: new Date() });
      });
    }
  });
});

// MARK:EQUIPMENT

app.get("/equip", (req, res) => {
  db.query("SELECT * FROM equipment", (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(results);
  });
});

// DELETE user by ID
app.delete("/equip/:id", (req, res) => {
  const id = req.params.id;

  db.query("DELETE FROM equipment WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: " Not found!" });
    }

    res.json({ message: "deleted successfully" });
  });
});

// POST - Add a new user
app.post("/equip", (req, res) => {
  const { name, quantity, vendor, price, contact, place } = req.body;

  // Check if all required fields are provided
  if (!name || !quantity || !vendor || !price || !contact || !place) {
    return res.status(400).json({ message: "All fields are required!" });
  }

  // Check if vendor already exists
  // db.query("SELECT * FROM equipment WHERE vendor = ? && name=?", [vendor,name], (err, results) => {
  //     if (err) {
  //         console.error("Database SELECT error:", err.message); // Improved Debugging
  //         return res.status(500).json({ error: "Database error", details: err.message });
  //     }

  //     if (results.length > 0) {
  //         return res.status(409).json({ message: "Vendor already exists!" });
  //     }

  // Insert new equipment data
  const sql =
    "INSERT INTO equipment (name, quantity, vendor, price, contact, place) VALUES (?, ?, ?, ?, ?, ?)";
  const values = [name, quantity, vendor, price, contact, place];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Database INSERT error:", err.message); // Improved Debugging
      return res
        .status(500)
        .json({ error: "Database error", details: err.message });
    }

    console.log("Equipment added successfully:", result);
    res
      .status(201)
      .json({ message: "Equipment added successfully", id: result.insertId });
  });
});

// PATCH - Update user by ID
app.patch("/equip/:id", (req, res) => {
  const id = req.params.id;
  const { name, quantity, vendor, price, contact, place } = req.body;

  // Fetch the user first
  db.query("SELECT * FROM equipment WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found!" });
    }

    const user = results[0];

    // Update only provided fields
    const updatedUser = {
      name: name || user.name,
      quantity: quantity || user.quantity,
      vendor: vendor || user.vendor,
      price: price || user.price,
      contact: contact || user.contact,
      place: place || user.place,
    };

    db.query(
      "UPDATE equipment SET name=?, quantity=?, vendor=?, price=?, contact=?,place=? WHERE id=?",
      [
        updatedUser.name,
        updatedUser.quantity,
        updatedUser.vendor,
        updatedUser.price,
        updatedUser.contact,
        updatedUser.place,
        id,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: "Database error" });

        res.json({ message: "User updated successfully" });
      }
    );
  });
});

// MARK:MEMBER SERVICE
// GET all users
app.get("/users", (req, res) => {
  db.query("SELECT * FROM userdetails", (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(results);
  });
});

// DELETE user by ID
app.delete("/users/:id", (req, res) => {
  const id = req.params.id;

  db.query("DELETE FROM userdetails WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found!" });
    }

    res.json({ message: "User deleted successfully" });
  });
});

// POST - Add a new user
app.post("/users", (req, res) => {
  const {
    name,
    age,
    address,
    program,
    membership_type,
    gender,
    mobile,
    email,
  } = req.body;

  if (
    !name ||
    !age ||
    !address ||
    !program ||
    !mobile ||
    !gender ||
    !membership_type ||
    !email
  ) {
    return res.status(400).json({ message: "All fields are required!" });
  }

  // Check if user already exists
  db.query(
    "SELECT * FROM userdetails WHERE mobile = ?",
    [mobile],
    (err, results) => {
      if (err) {
        console.error("Database SELECT error:", err); // Debugging
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length > 0) {
        return res
          .status(409)
          .json({ message: "User with this mobile number already exists!" });
      }

      // Insert new user
      const sql =
        "INSERT INTO userdetails (name, age, address, program, mobile,gender, membership_type, email) VALUES (?,?, ?, ?, ?, ?, ?, ?)";
      const values = [
        name,
        age,
        address,
        program,
        mobile,
        gender,
        membership_type,
        email,
      ];

      db.query(sql, values, (err, result) => {
        if (err) {
          console.error("Database INSERT error:", err); // Debugging
          return res.status(500).json({ error: "Database error" });
        }

        console.log("User added successfully:", result);
        res.json({ message: "User added successfully", id: result.insertId });
      });
    }
  );
});

// PATCH - Update user by ID
app.patch("/users/:id", (req, res) => {
  const id = req.params.id;
  const { name, age, address, program, gender, mobile, membershipType, email } =
    req.body;

  // Fetch the user first
  db.query("SELECT * FROM userdetails WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found!" });
    }

    const user = results[0];

    // Update only provided fields
    const updatedUser = {
      name: name || user.name,
      age: age || user.age,
      address: address || user.address,
      program: program || user.program,
      mobile: mobile || user.mobile,
      membershipType: membershipType || user.membershipType,
      email: email || user.email,
      gender: gender || user.gender,
    };

    db.query(
      "UPDATE userdetails SET name=?, age=?, address=?, program=?,gender=?, mobile=?,membership_type=?,email=? WHERE id=?",
      [
        updatedUser.name,
        updatedUser.age,
        updatedUser.address,
        updatedUser.program,
        updatedUser.mobile,
        updatedUser.membershipType,
        updatedUser.email,
        id,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: "Database error" });

        res.json({ message: "User updated successfully" });
      }
    );
  });
});

// MARK:ATTENDANCE FOR MEMBERS  ADMIN

cron.schedule("*/20 * * * *", () => {
  console.log("Cron job executed");
  const sql = `
      
           INSERT INTO client_attendance (client_id, status, date)
           SELECT u.id, 'Absent', CURDATE()
           FROM userdetails u
           WHERE NOT EXISTS (
           SELECT 1 FROM client_attendance a 
           WHERE a.client_id = u.id AND a.date = CURDATE()
       );
       `;

  db.query(sql, (err, results) => {
    if (err) console.error("Manual Test Error:", err.message);
    else console.log("Manual Test Success:", results);
  });
});

app.get("/clients", (req, res) => {
  const sql = `
        SELECT c.*, a.status 
        FROM userdetails c 
        LEFT JOIN client_attendance a 
        ON c.id = a.client_id AND a.date = CURDATE();
    `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});
app.post("/mark-present", (req, res) => {
  const { client_id } = req.body;
  const sql = `
        INSERT INTO client_attendance (client_id, status, date) 
        VALUES (?, 'Present', CURDATE())
        ON DUPLICATE KEY UPDATE status = 'Present';
    `;
  db.query(sql, [client_id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Attendance marked as Present" });
  });
});

// MARK:ATTENDANCE FOR MEMBERS  CLIENT
app.get("/user/details/mobile/:mobile", async (req, res) => {
  const { mobile } = req.params;

  try {
    const query = "SELECT * FROM userdetails WHERE mobile = ? LIMIT 1";
    db.query(query, [mobile], (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      if (results.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(results[0]);
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/attendance/mobile/:mobile", async (req, res) => {
  const { mobile } = req.params;

  try {
    const query = `
      SELECT c.date, c.status 
      FROM client_attendance c
      JOIN userdetails u ON c.client_id = u.id
      WHERE u.mobile = ?
      ORDER BY c.date DESC
    `;

    db.query(query, [mobile], (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARK:REGISTERATION

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Ensure "uploads" directory exists
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Update your route to handle file uploads
app.post("/register", upload.single("image"), async (req, res) => {
  try {
    console.log("Received Data:", req.body);
    console.log("Uploaded File:", req.file);

    const {
      name,
      gender,
      age,
      mobile,
      email,
      address,
      fitnessGoals,
      medicalConditions,
      membershipType,
      program,
    } = req.body;

    const imagePath = req.file ? req.file.path : null; // Store image path

    const query = `
      INSERT INTO userdetails (name, gender, age, mobile, email, address, fitness_goals, medical_conditions, membership_type, image,program)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
    `;

    const values = [
      name,
      gender,
      age,
      mobile,
      email,
      address,
      JSON.stringify(fitnessGoals || "[]"),
      medicalConditions,
      membershipType,
      imagePath,
      program,
    ];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error("Database Error:", err);
        return res
          .status(500)
          .json({ message: "Database error", error: err.sqlMessage });
      }
      console.log("Insert Success:", result);
      res.status(201).json({ message: "User registered successfully!" });
    });
  } catch (error) {
    console.error("Unexpected Server Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// GET user by mobile number
app.get("/user/:mobile", (req, res) => {
  const mobile = req.params.mobile;

  db.query(
    "SELECT * FROM userdetails WHERE mobile = ?",
    [mobile],
    (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }

      if (result.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      let user = result[0];

      // ✅ Parse fitness_goals JSON string to an array
      try {
        user.fitness_goals = JSON.parse(user.fitness_goals || "[]");
      } catch (error) {
        console.error("Error parsing fitness_goals:", error);
        user.fitness_goals = [];
      }

      res.json(user);
    }
  );
});
// MARK:PAYMENT details for admin
app.post("/api/payment", async (req, res) => {
  const { user_id, amount, transaction_id } = req.body;

  try {
    // Insert the payment into the payment table
    const [result] = await db
      .promise()
      .execute(
        "INSERT INTO payment (user_id, amount, status, transaction_id) VALUES (?, ?, 'Paid', ?)",
        [user_id, amount, transaction_id]
      );

    // Update the userdetails table to mark payment as done
    await db
      .promise()
      .execute(
        "UPDATE userdetails SET is_paid = 1, payment_date = NOW() WHERE id = ?",
        [user_id]
      );

    res
      .status(200)
      .json({ success: true, message: "Payment recorded successfully." });
  } catch (error) {
    console.error("Payment recording error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error recording payment." });
  }
});

app.get("/api/payment-status", async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
          SELECT u.id, u.name, u.email, u.mobile,u.program,u.payment_date, 
                 COALESCE(p.status, 'Due') AS payment_status
          FROM userdetails u
          LEFT JOIN payment p ON u.id = p.user_id
      `);

    if (!Array.isArray(rows)) {
      throw new Error("Invalid data format received from database.");
    }

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching payment status:", error);
    res.status(500).json({ message: "Error retrieving payment status." });
  }
});
// this for transaction history
app.get("/transaction", (req, res) => {
  const sql = `SELECT u.name, u.mobile, p.payment_date FROM payment p JOIN userdetails u ON 
  p.user_id = u.id ORDER BY p.payment_date DESC`;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(results);
  });
});

// MARK:PAYMENT GATEWAY CLIENT

// Schedule to run once every day at 12:00 AM
cron.schedule("0 0 * * *", async () => {
  try {
    console.log("Running payment due check...");

    // Set status to "Due" if more than 30 days have passed since payment_date
    await db.promise().execute(
      `UPDATE payment 
       SET status = 'Due' 
       WHERE DATE_ADD(payment_date, INTERVAL 30 DAY) < NOW()`
    );

    // Optional: update userdetails table too
    await db.promise().execute(
      `UPDATE userdetails 
       SET is_paid = 0 
       WHERE DATE_ADD(payment_date, INTERVAL 30 DAY) < NOW()`
    );

    console.log("Due status updated for expired payments.");
  } catch (error) {
    console.error("Error in cron job:", error);
  }
});

app.get("/api/getUserByMobile/:mobile", (req, res) => {
  const { mobile } = req.params;

  if (!mobile) {
    return res.status(400).json({ message: "Mobile number is required" });
  }

  db.promise()
    .execute("SELECT * FROM userdetails WHERE mobile = ?", [mobile])
    .then(([rows]) => {
      if (rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ user: rows[0] });
    })
    .catch((error) => {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    });
});

app.post("/api/payment", (req, res) => {
  const { user_id, amount, transaction_id } = req.body;

  if (!user_id || !amount || !transaction_id) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Step 1: Check if a payment record already exists for this user in payment table
  db.promise()
    .execute("SELECT id FROM payment WHERE user_id = ?", [user_id])
    .then(([paymentRows]) => {
      if (paymentRows.length > 0) {
        // Step 2: If a record exists, update it
        return db
          .promise()
          .execute(
            "UPDATE payment SET amount = ?, transaction_id = ?, status = ?, payment_date = NOW() WHERE user_id = ?",
            [amount, transaction_id, "Paid", user_id]
          );
      } else {
        // Step 3: If no record exists, insert a new payment record
        // return db
        //   .promise()
        //   .execute(
        //     "INSERT INTO payment (user_id, amount, transaction_id, status, payment_date) VALUES (?, ?, ?, ?, NOW())",
        //     [user_id, amount, transaction_id, "Paid"]
        //   );
        console.log(
          "Payment record already exists for this user. Updating instead."
        );
      }
    })
    .then(() => {
      // Step 4: Update `userdetails` table to mark the user as paid
      return db
        .promise()
        .execute(
          "UPDATE userdetails SET is_paid = 1, payment_date = NOW() WHERE id = ?",
          [user_id]
        );
    })
    .then(() => {
      res.json({ message: "Payment recorded successfully", user_id });
    })
    .catch((error) => {
      console.error("Database Error:", error);
      res.status(500).json({ message: "Database error", error: error.message });
    });
});

// MARK:PAYMENT NOTIFICATION
app.post("/api/send-payment-reminder", (req, res) => {
  const { email, name } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: "Missing email or name" });
  }

  const mailOptions = {
    from: "ribairibai1234567@gmail.com",
    to: email,
    subject: "Payment Reminder - Gym Fees Due",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; border-top:5px solid orange; background-color: #f9f9f9;">
        <h2 style="color: #333; text-align: center;">Hello ${name},</h2>
        <p style="font-size: 16px; color: #555; text-align: justify;">
          This is a reminder that your <strong>gym membership payment</strong> is due.
        </p>
        <p style="font-size: 16px; color: #555; text-align: justify;">
          Please make your payment as soon as possible to continue enjoying our facilities.
        </p>
        <div style="text-align: center; margin-top: 20px;">
          <a href="http://localhost:5173/clientdas/payment"
             style="background-color: #ff4500; color: #fff; padding: 10px 20px; text-decoration: none; font-size: 16px; border-radius: 5px; display: inline-block;">
            Pay Now
          </a>
        </div>
        <p style="font-size: 14px; color: #888; text-align: center; margin-top: 20px;">
          If you have already paid, please ignore this email.
        </p>
        <p style="font-size: 14px; font-weight: bold; text-align: right; color: #333; margin-top: 30px;">
          - Alpha Arena
        </p>
      </div>
    `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
      return res.status(500).json({ error: "Error sending email" });
    }
    console.log("Email sent:", info.response);
    res.json({ message: "Payment reminder sent successfully!" });
  });
});

// MARK: PROGRAM SERVICE
const DATA_FILE = path.join(__dirname, "Program.json");

const readData = () => {
  if (!fs.existsSync(DATA_FILE)) return []; // If file doesn't exist, return an empty array
  const data = fs.readFileSync(DATA_FILE);
  return JSON.parse(data);
};

// Helper function to write JSON file
const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// 🔹 GET all programs
app.get("/programs", (req, res) => {
  const programs = readData();
  res.json(programs);
});

// 🔹 ADD a new program
app.post("/programs", (req, res) => {
  const programs = readData();
  const newProgram = { id: Date.now(), ...req.body };
  programs.push(newProgram);
  writeData(programs);
  res.json(newProgram);
});

// 🔹 UPDATE a program
app.patch("/programs/:id", (req, res) => {
  const programs = readData(); // Function to read data from storage (e.g., a file or DB)
  const programIndex = programs.findIndex((p) => p.id == req.params.id);

  if (programIndex === -1) {
    return res.status(404).json({ error: "Program not found" });
  }

  // Merge only updated fields
  programs[programIndex] = { ...programs[programIndex], ...req.body };
  writeData(programs); // Function to save updated data back to storage

  res.json({ success: true, updatedProgram: programs[programIndex] });
});

// 🔹 DELETE a program
app.delete("/programs/:id", (req, res) => {
  let programs = readData();
  programs = programs.filter((p) => p.id != req.params.id);
  writeData(programs);
  res.json({ message: "Program deleted successfully" });
});

// MARK:ANNOUNCEMENT

app.get("/messages", (req, res) => {
  db.query(
    "SELECT * FROM announcement ORDER BY created_at DESC",
    (err, results) => {
      if (err) return res.status(500).json(err);
      res.json(results);
    }
  );
});

app.post("/messages", (req, res) => {
  const { message } = req.body;
  db.query(
    "INSERT INTO announcement (message) VALUES (?)",
    [message],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ id: result.insertId, message, created_at: new Date() });
    }
  );
});

// Update a message
app.patch("/messages/:id", (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  db.query(
    "UPDATE announcement SET message = ? WHERE id = ?",
    [message, id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Message not found" });
      }
      res.json({ success: true, message: "Message updated successfully" });
    }
  );
});

// Delete a message
app.delete("/messages/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM announcement WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ success: true });
  });
});
// get total count of announcements
app.get("/api/announcements/count", (req, res) => {
  const sql = "SELECT COUNT(*) AS count FROM announcement";
  db.query(sql, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ count: result[0].count });
  });
});

//   MARK:FORGETPASSWORD

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "sokkanathan90@gmail.com", // Your email
    pass: "hgho qufx xjhv kxqd", // Your email password (use App Password if 2FA enabled)
  },
});

// Function to generate OTP
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Send OTP to Email
app.post("/api/auth/send-otp", (req, res) => {
  const { email } = req.body;
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60000); // 10 mins expiry

  db.execute(
    "INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, ?)",
    [email, otp, expiresAt],
    (err) => {
      if (err)
        return res.status(500).json({ message: "Error storing OTP", err });

      // Send OTP via email
      transporter.sendMail(
        {
          from: process.env.EMAIL_USER,
          to: email,
          subject: "Password Reset OTP",
          text: `Your OTP for password reset is: ${otp}. It will expire in 10 minutes.`,
        },
        (error) => {
          if (error)
            return res
              .status(500)
              .json({ message: "Error sending email", error });

          res.json({ message: "OTP sent successfully" });
        }
      );
    }
  );
});

// 📌 2️⃣ Verify OTP
app.post("/api/auth/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  db.execute(
    "SELECT * FROM password_resets WHERE email = ? AND otp = ?",
    [email, otp],
    (err, results) => {
      if (err)
        return res.status(500).json({ message: "Error verifying OTP", err });

      if (
        results.length === 0 ||
        new Date(results[0].expires_at) < new Date()
      ) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      res.json({ message: "OTP verified successfully" });
    }
  );
});

// 📌 3️⃣ Reset Password
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email and new password are required" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Check if the email exists in the users table
    db.execute(
      "SELECT * FROM customer WHERE email = ?",
      [email],
      (err, results) => {
        if (err) {
          console.error("Database error:", err);
          return res
            .status(500)
            .json({ message: "Database error", error: err });
        }
        if (results.length === 0) {
          return res.status(404).json({ message: "Email not found" });
        }

        // Update the password
        db.execute(
          "UPDATE customer SET password = ? WHERE email = ?",
          [hashedPassword, email],
          (updateErr) => {
            if (updateErr) {
              console.error("Update error:", updateErr);
              return res
                .status(500)
                .json({ message: "Error updating password", error: updateErr });
            }

            // Delete OTP record
            db.execute("DELETE FROM password_resets WHERE email = ?", [email]);

            res.json({ message: "Password reset successfully" });
          }
        );
      }
    );
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});

app.listen(port, () => {
  console.log(`Running on port ${port}`);
});
