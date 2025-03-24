import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config(); 

// Create connection
const pool = mysql.createPool({
    host: process.env.DB_HOST, 
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_DATABASE, 
    port: process.env.DB_PORT, 
    connectTimeout: 10000, // Increase timeout
    waitForConnections: true,
    queueLimit: 0,
    multipleStatements: true,
    connectionLimit: 10, // Adjust based on your need, it limits the number of connections in the pool
    reconnect: true, // Ensure reconnection (this may not be directly supported, see alternative solutions below)
});

// Use the pool to get a connection
async function getConnection() {
    try {
        const connection = await pool.getConnection();
        return connection;
    } catch (error) {
        console.error('Failed to get connection:', error);
    }
}

// Export the connection
export { pool, getConnection };