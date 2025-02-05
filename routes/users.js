import express from 'express';
import connection from '../connectiondb.js'; 

const users = express.Router();

users.get('/test', async(req, res)=>{
    res.json({msg: "get api working"});
});

// get all the users - test purpose
users.get('/all', async(req, res)=>{
    const query = 'SELECT * FROM Users'; 

    connection.query(query, (err, results) => {
        if (err) {
          console.error('Error executing query:', err.message);
          return res.status(500).send('Database query failed');
        }
        res.status(200).json(results);
      });

});

// register user




export { users }


