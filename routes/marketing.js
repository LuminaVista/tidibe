import express from 'express';
import { pool } from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { businessIdea } from './businessIdea.js';


dotenv.config();
const marketing = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});


// marketing - ai - answers
marketing.get('/ai/answer/:business_idea_id/:marketing_cat_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { business_idea_id, marketing_cat_id } = req.params;
        const userId = req.user.user_id;
        marketing_cat_id = parseInt(req.params.marketing_cat_id, 10);

        // Get a connection from the pool
        connection = await pool.getConnection();

        // get the category name - marketing
        const [category_name] = await connection.execute(
            `SELECT category_name from Marketing_Categories where marketing_cat_id = ?`,
            [marketing_cat_id]
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

        // 2. Get the marketing_id for the given business_id
        const [marketings] = await connection.execute(
            `SELECT marketing_id FROM Marketing WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (marketings.length === 0) {
            return res.status(404).json({ message: 'No Marketing Content found for the given business_id' });
        }
        const marketingId = marketings[0].marketing_id;

        // 3. Check if answers already exist in the database
        const [existingAnswers] = await connection.execute(
            `SELECT mq.question, ma.answer, ma.marketing_question_id, ma.marketing_id, ma.marketing_cat_id, ma.marketing_answer_id
         FROM Marketing_Answers ma
         JOIN Marketing_Questions mq ON ma.marketing_question_id = mq.marketing_question_id
         WHERE ma.marketing_id = ? AND ma.marketing_cat_id = ?`,
            [marketingId, marketing_cat_id]
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
            `SELECT marketing_question_id, question FROM Marketing_Questions WHERE marketing_cat_id = ?`,
            [marketing_cat_id]
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
                marketing_question_id: q.marketing_question_id,
                marketing_id: marketingId,
                marketing_cat_id: marketing_cat_id,
                answer: response.choices[0].message.content,
                userId,
            });
        }

        // 6. Store the answers in the database
        for (let i = 0; i < answers.length; i++) {
            const [result] = await connection.execute(
                `INSERT INTO Marketing_Answers (marketing_question_id, marketing_id, marketing_cat_id, answer)
           VALUES (?, ?, ?, ?);`,
                [answers[i].marketing_question_id, answers[i].marketing_id, answers[i].marketing_cat_id, answers[i].answer]
            );
            answers[i].marketing_answer_id = result.insertId;
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

// AI Task generation
marketing.get('/ai/task/generate/:business_idea_id', authenticate, async (req, res) => {

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

        // Get the marketing_id for the given business_id
        const [marketings] = await connection.execute(
            `SELECT marketing_id FROM Marketing WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (marketings.length === 0) {
            return res.status(404).json({ message: 'No marketing data found for the given business_id' });
        }
        const marketingId = marketings[0].marketing_id;

        // Check if tasks already exist for this marketing
        const [existingTasks] = await connection.execute(
            `SELECT marketing_task_id, task_description, task_status FROM Marketing_Tasks WHERE marketing_id = ? AND business_idea_id = ?;`,
            [marketingId, business_idea_id]
        );

        if (existingTasks.length > 0) {
            // Return existing tasks in structured format
            return res.status(200).json({
                business_idea_id: business_idea_id,
                marketing_id: marketingId,
                tasks: existingTasks.map(task => ({
                    id: task.marketing_task_id,
                    task_description: task.task_description,
                    task_status: task.task_status
                }))
            });
        }

        // Get all questions and answers for the given marketingh_id  
        const [questionsAndAnswers] = await connection.execute(
            `SELECT mq.marketing_question_id, mq.question, ma.answer  
             FROM Marketing_Questions mq
             LEFT JOIN Marketing_Answers ma ON mq.marketing_question_id = ma.marketing_question_id  
             WHERE ma.marketing_id = ?;`,
            [marketingId]
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

        Along with the business idea, some business marketing-related questions and answers are provided:

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
                `INSERT INTO Marketing_Tasks (marketing_id, business_idea_id, task_description, task_status) 
                 VALUES (?, ?, ?, FALSE)`,
                [marketingId, business_idea_id, task]
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
            marketing_id: marketingId,
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

// user generated task: add task
marketing.post("/task/add/:business_idea_id", authenticate, async (req, res) => {

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

        // Fetch the marketing_id associated with the given business_idea_id
        const [marketings] = await connection.execute(
            `SELECT marketing_id FROM Marketing WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (marketings.length === 0) {
            return res.status(404).json({ message: "No marketing data found for the given business_idea_id." });
        }
        const marketingId = marketings[0].marketing_id;

        // Insert the user-generated task into the database
        const [result] = await connection.execute(
            `INSERT INTO Marketing_Tasks (marketing_id, business_idea_id, task_description, task_status) 
             VALUES (?, ?, ?, FALSE);`,
            [marketingId, business_idea_id, task_description]
        );

        // Return the newly added task
        return res.status(201).json({
            message: "Task added successfully.",
            task: {
                id: result.insertId,
                marketing_id: marketingId,
                business_idea_id: business_idea_id,
                task_description: task_description,
                task_status: 0 // Default status is 0 (incomplete)
            }
        });

    } catch (error) {
        console.error("Error adding user-generated task - Marketing:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// edit task status 
marketing.put('/task/edit/:business_idea_id/:task_id', authenticate, async (req, res) => {

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
            `SELECT * FROM Marketing_Tasks WHERE business_idea_id = ? AND marketing_task_id = ?;`,
            [business_idea_id, task_id]
        );

        if (task.length === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Update task status to 'complete' (1)
        await connection.execute(
            `UPDATE Marketing_Tasks SET task_status = 1 WHERE business_idea_id = ? AND marketing_task_id = ?;`,
            [business_idea_id, task_id]
        );

        // Get marketing_id from the task
        const marketing_id = task[0].marketing_id;
        // Update Marketing Progress
        await updateMarketingProgress(marketing_id);

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

// Single API: Edit and Approve ai answer
marketing.put('/ai/answer/edit/:marketing_answer_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { marketing_answer_id } = req.params;
        marketing_answer_id = parseInt(marketing_answer_id, 10);
        const { answer_content } = req.body; // This could be edited or original content

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Validate input
        if (!answer_content || answer_content.trim() === "") {
            return res.status(400).json({ message: "Answer content is required." });
        }

        // Update the answer and mark as approved
        await connection.execute(
            `UPDATE Marketing_Answers 
             SET answer = ?, answer_status = 'approved'
             WHERE marketing_answer_id = ?;`,
            [answer_content, marketing_answer_id]
        );

        return res.status(200).json({
            marketing_answer_id: marketing_answer_id,
            message: "Answer approved successfully",
            approved_answer: answer_content
        });

    } catch (error) {
        console.error("Answer Approve Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});


// get all the marketing categories
marketing.get('/marketing_categories/:business_idea_id', authenticate, async (req, res) => {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);


        const [categories] = await connection.query(
            `SELECT 
                    Marketing.marketing_id,
                    Marketing_Categories.marketing_cat_id, 
                    Marketing_Categories.category_name
                FROM Marketing
                JOIN Marketing_Categories_Connect ON Marketing.marketing_id = Marketing_Categories_Connect.marketing_id
                JOIN Marketing_Categories ON Marketing_Categories_Connect.marketing_cat_id = Marketing_Categories.marketing_cat_id
                WHERE Marketing.business_idea_id = ?;`, [business_idea_id]);

        const [progress] = await connection.query(
            `select progress from Marketing where business_idea_id = ?`, [business_idea_id]
        );
        return res.json({
            "progress": progress[0].progress,
            "categories": categories,
            business_idea_id: business_idea_id
        });


    } catch (error) {
        console.error("Error fetching Marketing categories:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});


// ******** Helper function to update progress **********
async function updateMarketingProgress(marketing_id) {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        const [[{ total_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS total_tasks FROM Marketing_Tasks WHERE marketing_id = ?;`,
            [marketing_id]
        );

        const [[{ completed_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS completed_tasks FROM Marketing_Tasks WHERE marketing_id = ? AND task_status = 1;`,
            [marketing_id]
        );

        const progress = total_tasks > 0 ? (completed_tasks / total_tasks) * 100 : 0;

        await connection.execute(
            `UPDATE Marketing SET progress = ? WHERE marketing_id = ?;`,
            [progress, marketing_id]
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

        const [marketings] = await connection.execute(
            `SELECT marketing_id FROM Marketing WHERE business_idea_id = ?;`,
            [business_idea_id]
        );

        if (marketings.length === 0) return;

        let totalProgress = 0;
        for (const marketing of marketings) {
            const [[{ progress }]] = await connection.execute(
                `SELECT progress FROM Marketing WHERE marketing_id = ?;`,
                [marketing.marketing_id]
            );
            totalProgress += progress;
        }

        const avgProgress = totalProgress / marketings.length;

        // Update Business_Stages table for stage_id = 4 (Marketing Stage)
        await connection.execute(
            `UPDATE Business_Stages SET progress = ? WHERE business_idea_id = ? AND stage_id = 4;`,
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

export { marketing }