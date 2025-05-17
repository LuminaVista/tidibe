import express from 'express';
import { pool } from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { businessIdea } from './businessIdea.js';


dotenv.config();
const brand = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});


// brand - AI answer generation
brand.get('/ai/answer/:business_idea_id/:brand_cat_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { business_idea_id, brand_cat_id } = req.params;
        const userId = req.user.user_id;
        brand_cat_id = parseInt(req.params.brand_cat_id, 10);

        // Get a connection from the pool
        connection = await pool.getConnection();

        // get the category name - brand
        const [category_name] = await connection.execute(
            `SELECT category_name from Brand_Categories where brand_cat_id = ?`,
            [brand_cat_id]
        );

        if (category_name.length === 0) {
            return res.status(404).json({ message: 'No Category Name found' });
        }

        let categoryName = category_name[0]["category_name"];

        // 1. Get the business idea details
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: 'No business idea found for the given business_id' });
        }
        const businessIdea = businessIdeas[0];

        // 2. Get the brand_id for the given business_id
        const [brands] = await connection.execute(
            `SELECT brand_id FROM Brand WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (brands.length === 0) {
            return res.status(404).json({ message: 'No Brand found for the given business_id' });
        }
        const brandId = brands[0].brand_id;

        // 3. Check if answers already exist in the database
        const [existingAnswers] = await connection.execute(
            `SELECT bq.question, ba.answer, ba.brand_question_id, ba.brand_id, ba.brand_cat_id
         FROM Brand_Answers ba
         JOIN Brand_Questions bq ON ba.brand_question_id = bq.brand_question_id
         WHERE ba.brand_id = ? AND ba.brand_cat_id = ?`,
            [brandId, brand_cat_id]
        );

        // If answers exist, return them
        if (existingAnswers.length > 0) {
            return res.json({
                message: 'Retrieved existing answers',
                category_name: categoryName,
                answers: existingAnswers
            });
        }

        // 4. If no answers exist, get questions and generate new answers
        const [questions] = await connection.execute(
            `SELECT brand_question_id, question FROM Brand_Questions WHERE brand_cat_id = ?`,
            [brand_cat_id]
        );
        if (questions.length === 0) {
            return res.status(404).json({ message: 'No questions found' });
        }

        // 5. Call OpenAI API for each question
        let answers = [];
        for (let q of questions) {
            const ai_prompt = `
          You are a Senior Business Consultant analyzing a business idea. Analyze the following business details:
          - Business Idea Name: ${businessIdea["idea_name"]}
          - Idea foundation: ${businessIdea["idea_foundation"]}
          - Problem statement: ${businessIdea["problem_statement"]}
          - Unique solution: ${businessIdea["unique_solution"]}
          - Target location: ${businessIdea["target_location"]}
          Question to answer: ${q.question}
          IMPORTANT INSTRUCTIONS:
          1. Respond ONLY with 4 bullet points
          2. Do not include any introduction, conclusion, or additional text
          3. Start each point with a dash (-)
          4. Keep each bullet point concise, direct, and professional
          5. Ensure all points directly address the question asked
        `;
            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: "user", content: ai_prompt }]
            });
            answers.push({
                question: q.question,
                brand_question_id: q.brand_question_id,
                brand_id: brandId,
                brand_cat_id: brand_cat_id,
                answer: response.choices[0].message.content,
                userId,
            });
        }

        // 6. Store the answers in the database
        for (let answer of answers) {
            await connection.execute(
                `INSERT INTO Brand_Answers (brand_question_id, brand_id, brand_cat_id, answer)
           VALUES (?, ?, ?, ?);`,
                [answer.brand_question_id, answer.brand_id, answer.brand_cat_id, answer.answer]
            );
        }

        return res.json({
            message: 'New answers generated and stored successfully',
            category_name: categoryName,
            answers: answers
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});


// brand - AI Task generation
brand.get('/ai/task/generate/:business_idea_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        const userId = req.user.user_id;

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Get the business idea details
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: 'No business idea found for the given business_id' });
        }
        const businessIdea = businessIdeas[0];

        // Get the brand_id for the given business_id
        const [brands] = await connection.execute(
            `SELECT brand_id FROM Brand WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (brands.length === 0) {
            return res.status(404).json({ message: 'No brands found for the given business_id' });
        }
        const brandId = brands[0].brand_id;

        // Check if tasks already exist for this brand
        const [existingTasks] = await connection.execute(
            `SELECT brand_task_id, task_description, task_status FROM Brand_Tasks WHERE brand_id = ? AND business_idea_id = ?;`,
            [brandId, business_idea_id]
        );

        if (existingTasks.length > 0) {
            // Return existing tasks in structured format
            return res.status(200).json({
                business_idea_id: business_idea_id,
                brand_id: brandId,
                tasks: existingTasks.map(task => ({
                    id: task.brand_task_id,
                    task_description: task.task_description,
                    task_status: task.task_status
                }))
            });
        }

        // Get all questions and answers for the given brand_id  
        const [questionsAndAnswers] = await connection.execute(
            `SELECT bq.brand_question_id, bq.question, ba.answer  
             FROM Brand_Questions bq
             LEFT JOIN Brand_Answers ba ON bq.brand_question_id = ba.brand_question_id  
             WHERE ba.brand_id = ?;`,
            [brandId]
        );

        if (questionsAndAnswers.length === 0) {
            return res.status(404).json({ message: 'AI-generated feedbacks are required for generating Actions' });
        }

        // AI Prompt for Task Generation
        let ai_prompt_task_generation = `
        You are a Senior Business Consultant. A business idea has been given to you below:

        - Business Idea Name: ${businessIdea["idea_name"]}
        - Idea foundation: ${businessIdea["idea_foundation"]}
        - Problem statement: ${businessIdea["problem_statement"]}
        - Unique solution: ${businessIdea["unique_solution"]}
        - Target location: ${businessIdea["target_location"]}

        Along with the business idea, some business branding-related questions and answers are provided:

        - ${questionsAndAnswers.map(q => `Q: ${q.question} A: ${q.answer}`).join("\n")}

        Analyze the idea and generate THREE TASKS.

        IMPORTANT INSTRUCTIONS:
        1. Respond ONLY with 3 TASKS in bullet points.
        2. Do not include any introduction, conclusion, or additional text.
        3. Start each task with a dash (-).
        4. Keep each task point concise, direct, and professional.
        5. Ensure all tasks directly address the business idea and provided Q&A.
        `;

        const ai_response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: "user", content: ai_prompt_task_generation }]
        });

        let generated_task = ai_response.choices[0].message.content;

        // Convert AI response into task list
        let taskList = generated_task.split("\n")
            .map(task => task.replace("- ", "").trim())
            .filter(task => task.length > 0);

        let insertedTasks = [];

        // Insert each task into the database and get back the task ID
        for (let task of taskList) {
            const [result] = await connection.execute(
                `INSERT INTO Brand_Tasks (brand_id, business_idea_id, task_description, task_status) 
                 VALUES (?, ?, ?, FALSE)`,
                [brandId, business_idea_id, task]
            );

            insertedTasks.push({
                id: result.insertId, // Get auto-generated ID
                task_description: task,
                task_status: false
            });
        }

        // updated response format
        return res.status(200).json({
            business_idea_id: business_idea_id,
            brand_id: brandId,
            tasks: insertedTasks.map(task => ({
                id: task.id,
                task_description: task.task_description,
                task_status: task.task_status ? 1 : 0 // Convert boolean to int (0 or 1)
            }))
        });

    } catch (error) {
        console.error("Error generating AI task:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// brand - user generated task: add task
brand.post("/task/add/:business_idea_id", authenticate, async (req, res) => {

    let connection;

    try {

        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        const { task_description } = req.body; // User provides only task_description
        const userId = req.user.user_id;

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Validate input
        if (!task_description || task_description.trim() === "") {
            return res.status(400).json({ message: "Task description is required." });
        }

        // Check if the business idea exists
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: "No business idea found for the given business_idea_id." });
        }

        // Fetch the brand_id associated with the given business_idea_id
        const [brands] = await connection.execute(
            `SELECT brand_id FROM Brand WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (brands.length === 0) {
            return res.status(404).json({ message: "No brands found for the given business_idea_id." });
        }
        const brandId = brands[0].brand_id;

        // Insert the user-generated task into the database
        const [result] = await connection.execute(
            `INSERT INTO Brand_Tasks (brand_id, business_idea_id, task_description, task_status) 
             VALUES (?, ?, ?, FALSE);`,
            [brandId, business_idea_id, task_description]
        );

        // Return the newly added task
        return res.status(201).json({
            message: "Task added successfully.",
            task: {
                id: result.insertId,
                brand_id: brandId,
                business_idea_id: business_idea_id,
                task_description: task_description,
                task_status: 0 // Default status is 0 (incomplete)
            }
        });

    } catch (error) {
        console.error("Error adding user-generated task - Brand:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// brand - edit task status 
brand.put('/task/edit/:business_idea_id/:task_id', authenticate, async (req, res) => {

    let connection;

    try {

        let { business_idea_id, task_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        task_id = parseInt(task_id, 10);
        const userId = req.user.user_id;

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Check if the task exists
        const [task] = await connection.execute(
            `SELECT * FROM Brand_Tasks WHERE business_idea_id = ? AND brand_task_id = ?;`,
            [business_idea_id, task_id]
        );

        if (task.length === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Update task status to 'complete' (1)
        await connection.execute(
            `UPDATE Brand_Tasks SET task_status = 1 WHERE business_idea_id = ? AND brand_task_id = ?;`,
            [business_idea_id, task_id]
        );

        // Get brand_id from the task
        const brand_id = task[0].brand_id;
        // Update Brand Progress
        await updateBrandProgress(brand_id);

        // Update Business Stage Progress
        await updateBusinessStageProgress(business_idea_id);
        // Update Business Idea Progress
        await updateBusinessIdeaProgress(business_idea_id);

        return res.status(200).json({
            task_id: task_id,
            message: "Task marked as complete successfully"
        });


    } catch (error) {
        console.error("Task Edit Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }

});

brand.get('/brand_categories/:business_idea_id', authenticate, async (req, res) => {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);


        const [categories] = await connection.query(
            `SELECT 
                    Brand.brand_id,
                    Brand_Categories.brand_cat_id, 
                    Brand_Categories.category_name
                FROM Brand
                JOIN Brand_Categories_Connect ON Brand.brand_id = Brand_Categories_Connect.brand_id
                JOIN Brand_Categories ON Brand_Categories_Connect.brand_cat_id = Brand_Categories.brand_cat_id
                WHERE Brand.business_idea_id = ?;`, [business_idea_id]);

        const [progress] = await connection.query(
            `select progress from Brand where business_idea_id = ?`, [business_idea_id]
        );
        return res.json({
            "progress": progress[0].progress,
            "categories": categories,
            business_idea_id: business_idea_id
        });


    } catch (error) {
        console.error("Error fetching Brand categories:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});




// ******** Helper function to update progress **********
async function updateBrandProgress(brand_id) {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        const [[{ total_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS total_tasks FROM Brand_Tasks WHERE brand_id = ?;`,
            [brand_id]
        );

        const [[{ completed_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS completed_tasks FROM Brand_Tasks WHERE brand_id = ? AND task_status = 1;`,
            [brand_id]
        );

        const progress = total_tasks > 0 ? (completed_tasks / total_tasks) * 100 : 0;

        await connection.execute(
            `UPDATE Brand SET progress = ? WHERE brand_id = ?;`,
            [progress, brand_id]
        );
    } catch (error) {
        throw error;
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
}


// Function to update Business Stage progress
async function updateBusinessStageProgress(business_idea_id) {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        const [brands] = await connection.execute(
            `SELECT brand_id FROM Brand WHERE business_idea_id = ?;`,
            [business_idea_id]
        );

        if (brands.length === 0) return;

        let totalProgress = 0;
        for (const brand of brands) {
            const [[{ progress }]] = await connection.execute(
                `SELECT progress FROM Brand WHERE brand_id = ?;`,
                [brand.brand_id]
            );
            totalProgress += progress;
        }

        const avgProgress = totalProgress / brands.length;

        // Update Business_Stages table for stage_id = 3 (Brand Stage)
        await connection.execute(
            `UPDATE Business_Stages SET progress = ? WHERE business_idea_id = ? AND stage_id = 3;`,
            [avgProgress, business_idea_id]
        );
    } catch (error) {
        throw error;
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
}


// Function to update Business Idea progress
async function updateBusinessIdeaProgress(business_idea_id) {

    let connection;

    try {
        // Get a connection from the pool
        connection = await pool.getConnection();

        const [[{ avg_stage_progress }]] = await connection.execute(
            `SELECT AVG(progress) AS avg_stage_progress FROM Business_Stages WHERE business_idea_id = ?;`,
            [business_idea_id]
        );

        await connection.execute(
            `UPDATE Business_Ideas SET idea_progress = ? WHERE business_idea_id = ?;`,
            [avg_stage_progress, business_idea_id]
        );
    } catch (error) {
        throw error;
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
}

export { brand }