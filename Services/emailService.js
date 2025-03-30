import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();


async function sendResetEmail(toEmail, resetLink) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    const mailOptions = {
        from: `"Tidibe Support" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject: "Reset your password",
        html: `
        <p>Hello,</p>
        <p>We received a request to reset your password. Click below to reset:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>This link will expire in 1 hour. If you didn’t request this, ignore this email.</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Reset email sent:", info.messageId);
};

export { sendResetEmail }