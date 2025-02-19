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

// get one business idea details of an autheticated user. 
businessIdea.get('/:id', authenticate, async (req, res) => {
    const user_id = req.user.user_id;  // Extract authenticated user ID
    const business_idea_id = req.params.id;    // Extract business idea ID from URL

    try {
        // Query to fetch the specific business idea for the authenticated user
        const sql = 'SELECT * FROM Business_Ideas WHERE user_id = ? AND business_idea_id = ?';
        const [rows] = await connection.execute(sql, [user_id, business_idea_id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Business idea not found or unauthorized.' });
        }

        res.status(200).json({ 
            businessIdea: rows[0] 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving business idea details.' });
    }
});


export { businessIdea }