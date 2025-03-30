import express from 'express';
import { pool } from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { sendResetEmail } from '../Services/emailService.js'


dotenv.config();
const resetpassword = express.Router();

resetpassword.post("/forgot-password", async (req, res) => {
    let { email } = req.body;
    let connection;

    try {
        // Get a connection from the pool
        connection = await pool.getConnection();

        // Step 1: Find the user by email
        const sql = "SELECT user_id, email FROM Users WHERE email = ?";
        const [rows] = await connection.execute(sql, [email]);

        const user = rows[0];
        if (!user) {
            // Always respond with success to avoid email enumeration
            return res.status(200).json({ message: "If email exists, a reset link has been sent." });
        }

        // Step 3: Generate JWT token
        const token = jwt.sign(
            {
                email: user.email,
                purpose: "password_reset"
            },
            process.env.PASSWORD_RESET_KEY,
            { expiresIn: "1h" }
        );

        console.log("TO: ", user.email);
        console.log("FROM: ", process.env.SMTP_USER);

        // Step 4: Build reset link (token + id)
        const resetLink = `http://reset.tidibe.xyz/index.html?token=${token}&email=${user.email}`;

        // Step 5: Send email
        await sendResetEmail(user.email, resetLink);

        return res.status(200).json({ message: "If email exists, reset link has been sent." });

    } catch (error) {
        console.error("Error in forgot-password:", error);
        return res.status(500).json({ message: "Server error" });
    } finally {
        if (connection) connection.release();
    }

});


resetpassword.post("/reset-password", async (req, res) => {

    const { token, email, newPassword } = req.body;
    let connection;

    try {
        if (!token || !email || !newPassword) {
            return res.status(400).json({ message: "Token, email, and new password are required." });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters." });
        }

        // Step 1: Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.PASSWORD_RESET_KEY);

            if (decoded.purpose !== "password_reset") {
                return res.status(403).json({ message: "Invalid token purpose." });
            }

            if (decoded.email !== email) {
                return res.status(403).json({ message: "Token does not match this email." });
            }

        } catch (err) {
            console.error("Invalid or expired token:", err.message);
            return res.status(401).json({ message: "Invalid or expired token." });
        }

        // Step 2: Get DB connection
        connection = await pool.getConnection();

        // Step 3: Find the user
        const [rows] = await connection.execute(
            "SELECT user_id FROM Users WHERE email = ?",
            [email]
        );
        const user = rows[0];

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        // Step 4: Hash and update password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await connection.execute(
            "UPDATE Users SET password = ? WHERE user_id = ?",
            [hashedPassword, user.user_id]
        );

        return res.status(200).json({ message: "Password reset successful." });

    } catch (err) {
        console.error("Reset password error:", err);
        return res.status(500).json({ message: "Server error." });
    } finally {
        if (connection) connection.release();
    }


});


export { resetpassword }