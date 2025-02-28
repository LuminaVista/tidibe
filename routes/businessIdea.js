import express from 'express';
import connection from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';

// services
import { createBusinessStages } from '../Services/stageService.js';
import { createConcept } from '../Services/conceptService.js';

dotenv.config();
const businessIdea = express.Router();

// procted - test
businessIdea.get('/test', authenticate, async (req, res) => {
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
businessIdea.post('/create', authenticate, async (req, res) => {
    // Extract user information from req.user
    const userId = req.user.user_id;
    const userEmail = req.user.email;

    const { idea_name, idea_foundation, problem_statement, unique_solution, target_location } = req.body;

    try {

        await connection.beginTransaction();

        // Insert the businessIdea into the database
        const sql = 'INSERT INTO Business_Ideas (user_id, idea_name, idea_foundation, problem_statement, unique_solution, target_location) VALUES (?, ?, ?, ?, ?, ?)';
        const values = [userId, idea_name, idea_foundation, problem_statement, unique_solution, target_location];
        const [result] = await connection.execute(sql, values);

        // get the business idea id
        const businessIdeaId = result.insertId;
        console.log(businessIdeaId)


        // we have to create the business stages and also Concept Table

        // Create stages using the separate function with the current connection
        try {
            await createBusinessStages(connection, businessIdeaId);
        } catch (stageError) {
            // Re-throw with more context
            throw new Error(`Failed to create business stages: ${stageError.message}`);
        }

        // create Concept Table 
        try {
            await createConcept(connection, businessIdeaId);
        } catch (conceptTableCreationError) {
            // Re-throw with more context
            throw new Error(`Failed to create Concept Stage: ${conceptTableCreationError.message}`);
        }

        // Commit the transaction
        await connection.commit();


        res.status(201).json({
            message: 'BusinessIdea Created Successfully',
            success: true
        });
    } catch (error) {
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
    const business_idea_id = req.params.id; // Extract business idea ID from URL

    try {
        // Query to fetch the specific business idea for the authenticated user
        const sql = 'SELECT * FROM Business_Ideas WHERE user_id = ? AND business_idea_id = ?';
        const [rows] = await connection.execute(sql, [user_id, business_idea_id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Business idea not found or unauthorized.' });
        }

        // Query to fetch associated stages with progress
        // Query to fetch associated stages with progress
        const stagesSql = `
            SELECT Stages.stage_id, Stages.stage_name, Business_Stages.progress, Business_Stages.completed, Stages.sub_stages
            FROM Business_Stages
            JOIN Stages ON Business_Stages.stage_id = Stages.stage_id
            WHERE Business_Stages.business_idea_id = ?
            ORDER BY Stages.stage_id;`;

        const [stagesRows] = await connection.execute(stagesSql, [business_idea_id]);

        res.status(200).json({
            businessIdea: rows[0],
            stages: stagesRows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving business idea details and stages.' });
    }
});




export { businessIdea }