import express from 'express';
import { pool } from '../connectiondb.js'; 
import authenticate from '../middlewares/authenticate.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';


dotenv.config();
const users = express.Router();

// procted
users.get('/test', async(req, res)=>{
    res.json({
        message: "GET API working"
    });

});

// get all the users - test purpose
// users.get('/all', async(req, res)=>{
//     const query = 'SELECT * FROM Users'; 

//     connection.query(query, (err, results) => {
//         if (err) {
//           console.error('Error executing query:', err.message);
//           return res.status(500).send('Database query failed');
//         }
//         res.status(200).json(results);
//       });
    
    

// });

// register user
users.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    let connection;

    try {

        if(password.length < 8){
            console.log("Password must be greater than 8 characters");
            return res.status(500).json({ error: 'Password must be greater than 8 characters.' });
        }

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Check if the email already exists
        const checkEmailSQL = 'SELECT * FROM Users WHERE email = ?';
        const [existingUsers] = await connection.execute(checkEmailSQL, [email]);

        if (existingUsers.length > 0) {
            return res.status(409).json({ error: 'Email is already registered.' }); // 409 Conflict
        }

        // Hash the password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);        

        // Insert the user into the database
        const sql = 'INSERT INTO Users (username, email, password) VALUES (?, ?, ?)';
        const values = [username, email, hashedPassword];
        await connection.execute(sql, values);

        res.status(201).json({ message: 'User registered successfully!' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error registering user.' });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// login user
users.post('/login', async(req, res)=>{
    const {email, password} = req.body;
    let connection;

    try{

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Check if the user exists in the database
        const sql = 'SELECT * FROM Users WHERE email = ?';
        const [rows] = await connection.execute(sql, [email]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const user = rows[0];

        // Compare the provided password with the stored hashed password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json(
                { 
                    message: 'Invalid credentials.',
                    token: 'None'
                }
            );
        }

        // Generate a JWT token
        const token = jwt.sign(
            { id: user.user_id, email: user.email }, // Payload
            process.env.SECRET_KEY, // Secret key
            { expiresIn: '30d' } // Token expiry
        );

        res.status(200).json({ message: 'Login successful', token });

    }catch(error){
        console.error(error);
        res.status(500).json({ error: 'Error logging in.' });
    }
    finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
})



export { users }


