import express from 'express';
import connection from '../connectiondb.js'; 
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';

dotenv.config();
const businessIdea = express.Router();

// procted - test
businessIdea.get('/test', authenticate, async(req, res)=>{
    // Extract user information from req.user
    const userId = req.user.user_id;
    const userEmail = req.user.email;

    // Send a response with the extracted information
    res.json({
        message: "GET API working",
        userId,
        userEmail
    });

});


// create the businessIdea
/*

todo: make active/inactice api
todo: make collaborators api

*/
businessIdea.post('/create', authenticate, async(req,res)=>{
    // Extract user information from req.user
    const userId = req.user.user_id;
    const userEmail = req.user.email;

    const { idea_name, idea_foundation, problem_statement, unique_solution, target_location } = req.body;

    try{

        // Insert the businessIdea into the database
        const sql = 'INSERT INTO Business_Ideas (user_id, idea_name, idea_foundation, problem_statement, unique_solution, target_location) VALUES (?, ?, ?, ?, ?, ?)';
        const values = [userId, idea_name, idea_foundation, problem_statement, unique_solution, target_location];
        await connection.execute(sql, values);

        res.status(201).json({ 
            message: 'BusinessIdea Created Successfully',
            success: true
        });
    }catch(error){
        console.error(error);
        res.status(500).json({ error: 'BusinessIdea Creation Failed.' });
        return
    }
});

// get all the businessIdeas (ACTIVE Only) for one specific user
businessIdea.get('/all', authenticate, async (req, res) => {
    // Extract user ID from authenticated request
    const userId = req.user.user_id;

    try {
        // Query to fetch business ideas for the given user
        const sql = 'SELECT * FROM Business_Ideas WHERE user_id = ?';
        const [rows] = await connection.execute(sql, [userId]);

        res.status(200).json({ 
            businessIdeas: rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving business ideas.' });
        return
    }
});


export { businessIdea }