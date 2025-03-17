import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config(); 

// Create connection
const connection = await mysql.createConnection({
    host: process.env.DB_HOST, 
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_DATABASE, 
    port: process.env.DB_PORT, 
    connectTimeout: 10000, // Increase timeout
    multipleStatements: true,
    waitForConnections: true,
    queueLimit: 0,
    reconnect: true, // Ensure reconnection
});

// Connect to the database
console.log('Connected to the RDS database!');

// Export the connection
export default connection;